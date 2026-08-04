import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { AgentGatewayErrorCode } from '../../../shared/index'
import { InMemoryAgentRequestLedger } from '../requestLedger'
import { SqliteAgentRequestLedger } from '../sqliteRequestLedger'
import type { AgentRequestKey } from '../types'

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

  it('retains stable strong rejection while retryable admission leaves pending', async () => {
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
    const owner = prepared[0]?.ownership === 'created' ? first : second
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

  it('validates the effect target before claiming durable ownership', async () => {
    const ledger = new SqliteAgentRequestLedger(join(tmpdir(), `agent-request-ledger-${randomUUID()}.sqlite`))
    await expect(ledger.prepare({
      ...key,
      target: { kind: 'session', ref: { agentTypeId: 'alpha', sessionId: 'session-a' } },
    }, 'digest-a')).rejects.toThrow('request ledger effect/target mismatch')
    ledger.close()
  })
})
