import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { AgentGatewayErrorCode } from '../../../shared/index'
import { InMemoryAgentRequestLedger } from '../requestLedger'
import { SqliteAgentRequestLedger } from '../sqliteRequestLedger'
import { AsyncSqliteLedgerWriter } from '../sqliteTurnLedgerWriter'
import type { AgentRequestKey } from '../types'

const require = createRequire(import.meta.url)

const key: AgentRequestKey = {
  workspaceScopeId: 'workspace-a',
  authSubjectId: 'subject-a',
  operation: 'session.create',
  target: { kind: 'agent', agentTypeId: 'alpha' },
  requestId: 'request-a',
}

const runKey: AgentRequestKey = {
  workspaceScopeId: 'workspace-a',
  authSubjectId: 'subject-a',
  operation: 'session.prompt',
  target: { kind: 'session', ref: { agentTypeId: 'alpha', sessionId: 'session-a' } },
  requestId: 'run-a',
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

  it('mirrors attention transition notifications and rejects new abandoned writes', async () => {
    const ledger = new InMemoryAgentRequestLedger()
    const now = Date.now()
    const changes: string[] = []
    ledger.attention.subscribe((change) => changes.push(change.reason))
    const record = {
      attentionId: 'question-memory',
      runRequestKey: runKey,
      toolCallId: 'tool-memory',
      workspaceScopeId: 'workspace-a',
      sessionRef: { agentTypeId: 'alpha', sessionId: 'session-a' },
      kind: 'question' as const,
      status: 'ready' as const,
      ownerPrincipalId: 'subject-a',
      payload: { questionId: 'question-memory' },
      resume: { state: 'pending' as const, resumeRequestId: 'attention:question-memory:resume' },
      transcriptEvents: [],
      createdAt: now,
      updatedAt: now,
    }
    await ledger.attention.create(record)
    await ledger.attention.transition(record.attentionId, ['ready'], (current) => ({ ...current, status: 'answered', updatedAt: Date.now() }))
    await ledger.attention.appendTranscriptEventIfMissing(record.attentionId, { type: 'answered' }, () => false)
    expect(changes).toEqual(['create', 'answer', 'transcript'])
    await expect(ledger.attention.create({ ...record, attentionId: 'legacy-write', status: 'abandoned' })).rejects.toMatchObject({
      code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT,
    })
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
  it('prioritizes authoritative writes ahead of the bounded observation backlog', async () => {
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
    const database = new DatabaseSync(':memory:')
    const writer = new AsyncSqliteLedgerWriter(database)
    const order: string[] = []
    const observations = Array.from({ length: 256 }, (_, index) => writer.observe(() => {
      order.push(`observation-${index}`)
    }))
    await expect(writer.observe(() => {})).rejects.toThrow('ledger write buffer is full')

    await writer.execute(() => { order.push('authoritative') })
    expect(order[0]).toBe('authoritative')
    await Promise.all(observations)
    await writer.close()
    database.close()
  })

  it('keeps ordered request, effect, and attention writes off the event loop under contention', async () => {
    const path = join(tmpdir(), `agent-request-ledger-${randomUUID()}.sqlite`)
    const ledger = new SqliteAgentRequestLedger(path)
    await ledger.claimIncarnation()
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
    const blocker = new DatabaseSync(path)
    blocker.exec('BEGIN IMMEDIATE')
    const now = Date.now()
    const startedAt = Date.now()

    const writes = [
      ledger.prepare(runKey, 'digest-run'),
      ledger.acceptAdmission(runKey, 'admission-run'),
      ledger.beginEffect(runKey),
      ledger.admitEffect({
        runRequestKey: runKey,
        effectId: 'tool-pause',
        effectClass: 'pause',
        idempotent: false,
      }),
      ledger.pauseChildEffect(runKey, 'tool-pause'),
      ledger.attention.create({
        attentionId: 'question-ready',
        runRequestKey: runKey,
        toolCallId: 'tool-pause',
        workspaceScopeId: 'workspace-a',
        sessionRef: { agentTypeId: 'alpha', sessionId: 'session-a' },
        kind: 'question',
        status: 'ready',
        ownerPrincipalId: 'subject-a',
        payload: { questionId: 'question-ready' },
        resume: { state: 'pending', resumeRequestId: 'attention:question-ready:resume' },
        transcriptEvents: [],
        createdAt: now,
        updatedAt: now,
      }),
    ]

    let timerElapsed = Number.POSITIVE_INFINITY
    await new Promise<void>((resolve) => setTimeout(() => {
      timerElapsed = Date.now() - startedAt
      blocker.exec('COMMIT')
      resolve()
    }, 50))
    expect(timerElapsed).toBeLessThan(150)
    await Promise.all(writes)

    expect(await ledger.read(runKey)).toMatchObject({ state: 'in-flight' })
    expect(await ledger.listNonTerminal({
      states: ['paused'],
      operations: ['session.prompt'],
    })).toEqual([
      expect.objectContaining({ kind: 'effect', record: expect.objectContaining({ effectId: 'tool-pause' }) }),
    ])
    expect(await ledger.attention.get('question-ready')).toMatchObject({ status: 'ready', toolCallId: 'tool-pause' })
    blocker.close()
    await ledger.close()
  })

  it('flushes an accepted authoritative write before closing under contention', async () => {
    const path = join(tmpdir(), `agent-request-ledger-${randomUUID()}.sqlite`)
    const ledger = new SqliteAgentRequestLedger(path)
    await ledger.claimIncarnation()
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
    const blocker = new DatabaseSync(path)
    blocker.exec('BEGIN IMMEDIATE')

    const write = ledger.prepare(runKey, 'digest-before-close')
    const close = ledger.close()
    await new Promise<void>((resolve) => setTimeout(() => {
      blocker.exec('COMMIT')
      resolve()
    }, 50))

    await expect(write).resolves.toMatchObject({ ownership: 'created' })
    await expect(close).resolves.toBeUndefined()
    blocker.close()

    const reopened = new SqliteAgentRequestLedger(path)
    expect(await reopened.read(runKey)).toMatchObject({ digest: 'digest-before-close', state: 'pending-admission' })
    await reopened.close()
  })

  it('keeps Turn writes off the event loop while another process holds the SQLite writer lock', async () => {
    const path = join(tmpdir(), `agent-request-ledger-${randomUUID()}.sqlite`)
    const ledger = new SqliteAgentRequestLedger(path)
    const incarnation = await ledger.claimIncarnation()
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
    const blocker = new DatabaseSync(path)
    blocker.exec('BEGIN IMMEDIATE')

    const calledAt = Date.now()
    const write = ledger.startTurn({
      runRequestKey: runKey,
      sessionRef: { agentTypeId: 'alpha', sessionId: 'session-a' },
      turnId: 'turn-a',
      incarnation,
      startedSeq: 1,
    })
    expect(Date.now() - calledAt).toBeLessThan(100)
    await new Promise((resolve) => setTimeout(resolve, 50))
    blocker.exec('COMMIT')

    await expect(write).resolves.toBeUndefined()
    expect(await ledger.listNonTerminal({
      states: ['started'],
      operations: ['session.prompt'],
    })).toEqual([
      expect.objectContaining({ kind: 'turn', record: expect.objectContaining({ turnId: 'turn-a' }) }),
    ])
    blocker.close()
    await ledger.close()
  })

  it('flushes queued Turn writes before closing the SQLite connection', async () => {
    const path = join(tmpdir(), `agent-request-ledger-${randomUUID()}.sqlite`)
    const ledger = new SqliteAgentRequestLedger(path)
    const incarnation = await ledger.claimIncarnation()
    const write = ledger.startTurn({
      runRequestKey: runKey,
      sessionRef: { agentTypeId: 'alpha', sessionId: 'session-a' },
      turnId: 'turn-before-close',
      incarnation,
      startedSeq: 1,
    })

    await ledger.close()
    await expect(write).resolves.toBeUndefined()

    const reopened = new SqliteAgentRequestLedger(path)
    expect(await reopened.listNonTerminal({
      states: ['started'],
      operations: ['session.prompt'],
    })).toEqual([
      expect.objectContaining({ kind: 'turn', record: expect.objectContaining({ turnId: 'turn-before-close' }) }),
    ])
    await reopened.close()
  })

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

  it('reconciles prior-incarnation in-flight requests and started turns with separate store instances', async () => {
    const path = join(tmpdir(), `agent-request-ledger-${randomUUID()}.sqlite`)
    const before = new SqliteAgentRequestLedger(path)
    const firstIncarnation = await before.claimIncarnation()
    await before.prepare(runKey, 'digest-a')
    await before.acceptAdmission(runKey, 'admission-a')
    await before.beginEffect(runKey)
    await before.startTurn({
      runRequestKey: runKey,
      sessionRef: { agentTypeId: 'alpha', sessionId: 'session-a' },
      turnId: 'turn-a',
      incarnation: firstIncarnation,
      startedSeq: 7,
    })
    before.close()

    const after = new SqliteAgentRequestLedger(path)
    const secondIncarnation = await after.claimIncarnation()
    const reconciled = await after.reconcileAfterRestart(secondIncarnation)
    expect(reconciled).toMatchObject({ requestsOutcomeUnknown: 1, turnsOutcomeUnknown: 1 })
    expect(await after.read(runKey)).toMatchObject({ state: 'outcome-unknown' })
    expect(await after.listNonTerminal({
      states: ['outcome-unknown'],
      operations: ['session.prompt'],
      workspaceScopeId: 'workspace-a',
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'request', record: expect.objectContaining({ state: 'outcome-unknown' }) }),
      expect.objectContaining({ kind: 'turn', record: expect.objectContaining({ state: 'outcome-unknown' }) }),
    ]))
    after.close()
  })

  it('parks an in-flight request held by a pause effect and ready attention', async () => {
    const path = join(tmpdir(), `agent-request-ledger-${randomUUID()}.sqlite`)
    const before = new SqliteAgentRequestLedger(path)
    await before.claimIncarnation()
    await before.prepare(runKey, 'digest-a')
    await before.acceptAdmission(runKey, 'admission-a')
    await before.beginEffect(runKey)
    await before.admitEffect({
      runRequestKey: runKey,
      effectId: 'tool-a',
      effectClass: 'pause',
      idempotent: false,
    })
    await before.pauseChildEffect(runKey, 'tool-a')
    await before.admitEffect({
      runRequestKey: runKey,
      effectId: 'tool-without-attention',
      effectClass: 'pause',
      idempotent: false,
    })
    await before.pauseChildEffect(runKey, 'tool-without-attention')
    const now = Date.now()
    await before.attention.create({
      attentionId: 'question-a',
      runRequestKey: runKey,
      toolCallId: 'tool-a',
      workspaceScopeId: 'workspace-a',
      sessionRef: { agentTypeId: 'alpha', sessionId: 'session-a' },
      kind: 'question',
      status: 'ready',
      ownerPrincipalId: 'subject-a',
      payload: { questionId: 'question-a' },
      resume: { state: 'pending', resumeRequestId: 'attention:question-a:resume' },
      transcriptEvents: [],
      createdAt: now,
      updatedAt: now,
    })
    before.close()

    const after = new SqliteAgentRequestLedger(path)
    const reconciled = await after.reconcileAfterRestart(await after.claimIncarnation())
    expect(reconciled).toMatchObject({ parked: 1, requestsOutcomeUnknown: 0, effectsOutcomeUnknown: 1 })
    expect(await after.read(runKey)).toMatchObject({ state: 'in-flight' })
    expect(await after.listNonTerminal({
      states: ['outcome-unknown'],
      operations: ['session.prompt'],
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'effect', record: expect.objectContaining({ effectId: 'tool-without-attention' }) }),
    ]))
    after.close()
  })

  it('replays a persisted follow-up before enqueue but never double-runs after enqueue begins', async () => {
    const path = join(tmpdir(), `agent-request-ledger-${randomUUID()}.sqlite`)
    const followUpKey: AgentRequestKey = { ...runKey, operation: 'session.followup', requestId: 'follow-up-a' }
    const payload = { kind: 'followup', requestId: 'follow-up-a', clientNonce: 'nonce-a', clientSeq: 1, content: 'next' } as const
    const first = new SqliteAgentRequestLedger(path)
    await first.claimIncarnation()
    await first.prepare(followUpKey, 'digest-follow-up', payload)
    await first.acceptAdmission(followUpKey, 'admission-follow-up')
    first.close()

    const beforeEnqueue = new SqliteAgentRequestLedger(path)
    await beforeEnqueue.reconcileAfterRestart(await beforeEnqueue.claimIncarnation())
    expect(await beforeEnqueue.read(followUpKey)).toMatchObject({ state: 'pending-admission' })
    expect(await beforeEnqueue.readReplayPayload(followUpKey)).toEqual(payload)
    await beforeEnqueue.acceptAdmission(followUpKey, 'admission-replay')
    await beforeEnqueue.beginEffect(followUpKey)
    beforeEnqueue.close()

    const afterEnqueue = new SqliteAgentRequestLedger(path)
    await afterEnqueue.reconcileAfterRestart(await afterEnqueue.claimIncarnation())
    expect(await afterEnqueue.read(followUpKey)).toMatchObject({ state: 'outcome-unknown' })
    expect(await afterEnqueue.listNonTerminal({
      states: ['pending-admission'],
      operations: ['session.followup'],
    })).toEqual([])
    afterEnqueue.close()
  })

  it('uses CAS attention transitions and digest-idempotent effect settlement', async () => {
    const ledger = new SqliteAgentRequestLedger(join(tmpdir(), `agent-request-ledger-${randomUUID()}.sqlite`))
    await ledger.claimIncarnation()
    await ledger.admitEffect({
      runRequestKey: runKey,
      effectId: 'tool-a',
      effectClass: 'mutate',
      idempotent: false,
    })
    await ledger.beginChildEffect(runKey, 'tool-a')
    await ledger.settleChildEffect(runKey, 'tool-a', 'outcome-a', { ok: true })
    await expect(ledger.settleChildEffect(runKey, 'tool-a', 'outcome-a', { ignored: true })).resolves.toBeUndefined()
    await expect(ledger.settleChildEffect(runKey, 'tool-a', 'outcome-b', { ok: false })).rejects.toMatchObject({
      code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT,
    })

    const now = Date.now()
    await ledger.attention.create({
      attentionId: 'question-a',
      runRequestKey: runKey,
      toolCallId: 'tool-a',
      workspaceScopeId: 'workspace-a',
      sessionRef: { agentTypeId: 'alpha', sessionId: 'session-a' },
      kind: 'question',
      status: 'ready',
      ownerPrincipalId: 'subject-a',
      payload: { questionId: 'question-a' },
      resume: { state: 'pending', resumeRequestId: 'attention:question-a:resume' },
      transcriptEvents: [],
      createdAt: now,
      updatedAt: now,
    })
    expect(await ledger.attention.transition('question-a', ['ready'], (record) => ({
      ...record,
      status: 'answered',
      updatedAt: Date.now(),
    }))).toBe(true)
    expect(await ledger.attention.transition('question-a', ['ready'], (record) => record)).toBe(false)
    ledger.close()
  })
})
