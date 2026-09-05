import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { AgentGatewayErrorCode } from '../../../shared/index'
import { InMemoryAgentRequestLedger } from '../requestLedger'
import { SqliteAgentRequestLedger } from '../sqliteRequestLedger'
import type { AgentRequestKey, AgentRequestLedger } from '../types'

const key: AgentRequestKey = {
  workspaceScopeId: 'workspace-a',
  authSubjectId: 'subject-a',
  operation: 'session.create',
  target: { kind: 'agent', agentTypeId: 'alpha' },
  requestId: 'request-a',
}

describe('InMemoryAgentRequestLedger', () => {
  it('implements pending → accepted → in-flight → completed and acknowledgement replay', async () => {
    const ledger = new InMemoryAgentRequestLedger()
    const [first, retry] = await Promise.all([
      ledger.prepare(key, 'digest-a'),
      ledger.prepare(key, 'digest-a'),
    ])
    expect(first).toMatchObject({ ownership: 'created', record: { state: 'pending-admission' } })
    expect(retry).toMatchObject({ ownership: 'existing', record: first.record })
    await ledger.acceptAdmission(key, 'admission-a')
    await ledger.beginEffect(key)
    await ledger.complete(key, { accepted: true })
    expect(await ledger.prepare(key, 'digest-a')).toMatchObject({
      ownership: 'existing',
      record: { state: 'completed', receipt: { accepted: true } },
    })
    await expect(ledger.prepare(key, 'digest-b')).rejects.toMatchObject({
      code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT,
    })
  })

  it('retains stable strong rejection', async () => {
    const ledger = new InMemoryAgentRequestLedger()
    await ledger.prepare(key, 'digest-a')
    expect((await ledger.read(key))?.state).toBe('pending-admission')
    await ledger.reject(key, {
      kind: 'gateway',
      error: { code: AgentGatewayErrorCode.AGENT_SCOPE_DENIED, message: 'denied' },
    })
    expect(await ledger.read(key)).toMatchObject({ state: 'rejected' })
  })

  it('permits outcome-unknown only from in-flight', async () => {
    const ledger = new InMemoryAgentRequestLedger()
    await ledger.prepare(key, 'digest-a')
    await expect(ledger.markOutcomeUnknown(key, {
      code: AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN,
      message: 'unknown',
    })).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
    await ledger.acceptAdmission(key, 'admission-a')
    await ledger.beginEffect(key)
    await ledger.markOutcomeUnknown(key, {
      code: AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN,
      message: 'unknown',
    })
    expect(await ledger.read(key)).toMatchObject({ state: 'outcome-unknown' })
  })
})

describe.each<{ name: string; create(): AgentRequestLedger }>([
  { name: 'in-memory', create: () => new InMemoryAgentRequestLedger() },
  { name: 'SQLite', create: () => new SqliteAgentRequestLedger(join(tmpdir(), `agent-request-ledger-${randomUUID()}.sqlite`)) },
])('$name admission retry ownership', ({ create }) => {
  it('retains the digest and elects one retry owner before allowing admission', async () => {
    const ledger = create()
    try {
      await ledger.prepare(key, 'digest-a')
      await ledger.markAdmissionRetryable(key)
      await expect(ledger.prepare(key, 'digest-b')).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
      await expect(ledger.acceptAdmission(key, 'unclaimed')).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
      const claims = await Promise.all([ledger.prepare(key, 'digest-a'), ledger.prepare(key, 'digest-a')])
      expect(claims.map(({ ownership }) => ownership)).toEqual(['reclaimed', 'existing'])
      expect(claims[0]?.record).not.toHaveProperty('retryable')
      await ledger.acceptAdmission(key, 'admitted')
      await ledger.beginEffect(key)
      await ledger.complete(key, { accepted: true })
      await expect(ledger.prepare(key, 'digest-a')).resolves.toMatchObject({
        ownership: 'existing', record: { state: 'completed', receipt: { accepted: true } },
      })
    } finally {
      await ledger.close?.()
    }
  })

  it('does not release accepted, in-flight, or unknown effects for another attempt', async () => {
    const ledger = create()
    try {
      await ledger.prepare(key, 'digest-a')
      await ledger.acceptAdmission(key, 'admitted')
      await expect(ledger.markAdmissionRetryable(key)).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
      await ledger.beginEffect(key)
      await expect(ledger.markAdmissionRetryable(key)).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
      await ledger.markOutcomeUnknown(key, { code: AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN, message: 'unknown' })
      await expect(ledger.markAdmissionRetryable(key)).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
      await expect(ledger.prepare(key, 'digest-a')).resolves.toMatchObject({ ownership: 'existing', record: { state: 'outcome-unknown' } })
    } finally {
      await ledger.close?.()
    }
  })
})

describe('SqliteAgentRequestLedger', () => {
  it('atomically elects one owner across instances and durably replays the terminal record', async () => {
    const path = join(tmpdir(), `agent-request-ledger-${randomUUID()}.sqlite`)
    const first = new SqliteAgentRequestLedger(path)
    const second = new SqliteAgentRequestLedger(path)
    const prepared = await Promise.all([
      first.prepare(key, 'digest-a'),
      second.prepare(key, 'digest-a'),
    ])

    expect(prepared.filter(({ ownership }) => ownership === 'created')).toHaveLength(1)
    expect(prepared.filter(({ ownership }) => ownership === 'existing')).toHaveLength(1)
    const initialOwner = prepared[0]?.ownership === 'created' ? first : second
    await initialOwner.markAdmissionRetryable(key)
    const retried = await Promise.all([first.prepare(key, 'digest-a'), second.prepare(key, 'digest-a')])
    expect(retried.filter(({ ownership }) => ownership === 'reclaimed')).toHaveLength(1)
    expect(retried.filter(({ ownership }) => ownership === 'existing')).toHaveLength(1)
    const owner = retried[0]?.ownership === 'reclaimed' ? first : second
    await owner.acceptAdmission(key, 'admission-a')
    await owner.beginEffect(key)
    await owner.complete(key, { accepted: true })
    first.close()
    second.close()

    const reopened = new SqliteAgentRequestLedger(path)
    await expect(reopened.prepare(key, 'digest-a')).resolves.toMatchObject({
      ownership: 'existing',
      record: { state: 'completed', receipt: { accepted: true } },
    })
    await expect(reopened.prepare(key, 'digest-b')).rejects.toMatchObject({
      code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT,
    })
    reopened.close()
  })

  it.each(['pending-admission', 'admission-accepted', 'in-flight', 'outcome-unknown'] as const)(
    'does not reclaim %s after reopen without a proven safe release',
    async (state) => {
      const path = join(tmpdir(), `agent-request-ledger-${randomUUID()}.sqlite`)
      const initial = new SqliteAgentRequestLedger(path)
      try {
        await initial.prepare(key, 'digest-a')
        if (state !== 'pending-admission') await initial.acceptAdmission(key, 'admitted')
        if (state === 'in-flight' || state === 'outcome-unknown') await initial.beginEffect(key)
        if (state === 'outcome-unknown') await initial.markOutcomeUnknown(key, {
          code: AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN, message: 'unknown',
        })
      } finally {
        initial.close()
      }
      const reopened = new SqliteAgentRequestLedger(path)
      try {
        await expect(reopened.prepare(key, 'digest-a')).resolves.toMatchObject({ ownership: 'existing', record: { state } })
        await expect(reopened.prepare(key, 'digest-b')).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
      } finally {
        reopened.close()
      }
    },
  )

  it('validates the effect target before claiming durable ownership', async () => {
    const ledger = new SqliteAgentRequestLedger(join(tmpdir(), `agent-request-ledger-${randomUUID()}.sqlite`))
    await expect(ledger.prepare({
      ...key,
      target: { kind: 'session', ref: { agentTypeId: 'alpha', sessionId: 'session-a' } },
    }, 'digest-a')).rejects.toThrow('request ledger effect/target mismatch')
    ledger.close()
  })
})
