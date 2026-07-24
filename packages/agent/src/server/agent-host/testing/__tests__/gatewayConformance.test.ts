import { describe, expect, it } from 'vitest'
import {
  AgentGatewayError,
  AgentGatewayErrorCode,
  type AgentGateway,
  type AgentGatewayErrorDTO,
  type AgentSessionActivity,
  type AgentSessionConnection,
  type AgentSessionEvent,
  type AgentSessionRef,
  type AgentSessionStateSnapshot,
  type AgentSessionSummary,
  type AuthorizedAgentScope,
  type IdempotentAgentSend,
  type JsonValue,
  type QueuedUserMessage,
  type VerifiedAgentScopeClaim,
} from '../../../../shared/index'
import {
  gatewayConformance,
  type GatewayConformanceFixture,
} from '../gatewayConformance'
import type {
  AgentRequestFailure,
  AgentRequestKey,
  AgentRequestLedger,
  AgentRequestLedgerRecord,
} from '../../types'

function keyIdentity(key: AgentRequestKey): string {
  const target = key.target.kind === 'agent'
    ? `agent:${key.target.agentTypeId}`
    : `session:${key.target.ref.agentTypeId}:${key.target.ref.sessionId}`
  return [key.workspaceScopeId, key.authSubjectId, key.operation, target, key.requestId].join('|')
}

class InMemoryAgentRequestLedger implements AgentRequestLedger {
  private readonly records = new Map<string, AgentRequestLedgerRecord>()
  private clock = 0

  async prepare(key: AgentRequestKey, digest: string): Promise<AgentRequestLedgerRecord> {
    this.validateTarget(key)
    const identity = keyIdentity(key)
    const current = this.records.get(identity)
    if (current !== undefined) {
      if (current.digest !== digest) {
        throw new AgentGatewayError('AGENT_REQUEST_CONFLICT', 'request id reused with a different payload')
      }
      return current
    }
    const record: AgentRequestLedgerRecord = {
      state: 'pending-admission',
      key,
      digest,
      updatedAt: this.tick(),
    }
    this.records.set(identity, record)
    return record
  }

  async acceptAdmission(key: AgentRequestKey, admissionReceipt: string): Promise<void> {
    const current = this.requireState(key, 'pending-admission')
    this.write(key, { ...current, state: 'admission-accepted', admissionReceipt, updatedAt: this.tick() })
  }

  async beginEffect(key: AgentRequestKey): Promise<void> {
    const current = this.requireState(key, 'admission-accepted')
    this.write(key, { ...current, state: 'in-flight', updatedAt: this.tick() })
  }

  async reject(key: AgentRequestKey, failure: AgentRequestFailure): Promise<void> {
    const expected = failure.kind === 'gateway' ? 'pending-admission' : 'in-flight'
    const current = this.requireState(key, expected)
    this.write(key, { ...current, state: 'rejected', failure, updatedAt: this.tick() })
  }

  async complete(key: AgentRequestKey, receipt: JsonValue): Promise<void> {
    const current = this.requireState(key, 'in-flight')
    this.write(key, { ...current, state: 'completed', receipt, updatedAt: this.tick() })
  }

  async markOutcomeUnknown(key: AgentRequestKey, error: AgentGatewayErrorDTO): Promise<void> {
    const current = this.requireState(key, 'in-flight')
    this.write(key, { ...current, state: 'outcome-unknown', error, updatedAt: this.tick() })
  }

  async read(key: AgentRequestKey): Promise<AgentRequestLedgerRecord | undefined> {
    return this.records.get(keyIdentity(key))
  }

  private validateTarget(key: AgentRequestKey): void {
    const valid = key.operation === 'session.create'
      ? key.target.kind === 'agent'
      : key.target.kind === 'session'
    if (!valid) throw new Error('ledger effect/target mismatch')
  }

  private requireState<S extends AgentRequestLedgerRecord['state']>(
    key: AgentRequestKey,
    expected: S,
  ): Extract<AgentRequestLedgerRecord, { state: S }> {
    const current = this.records.get(keyIdentity(key))
    if (current?.state !== expected) {
      throw new Error(`invalid ledger transition: ${current?.state ?? 'missing'} -> expected ${expected}`)
    }
    return current as Extract<AgentRequestLedgerRecord, { state: S }>
  }

  private write(key: AgentRequestKey, record: AgentRequestLedgerRecord): void {
    this.records.set(keyIdentity(key), record)
  }

  private tick(): number {
    this.clock += 1
    return this.clock
  }
}

const agentTarget = { kind: 'agent', agentTypeId: 'alpha' } as const
const sessionTarget = {
  kind: 'session',
  ref: { agentTypeId: 'alpha', sessionId: 'session-1' },
} as const

function requestKey(
  operation: AgentRequestKey['operation'] = 'session.create',
  target: AgentRequestKey['target'] = agentTarget,
  overrides: Partial<AgentRequestKey> = {},
): AgentRequestKey {
  return {
    workspaceScopeId: 'workspace-a',
    authSubjectId: 'subject-a',
    operation,
    target,
    requestId: 'request-1',
    ...overrides,
  }
}

const LEGACY_ADMISSION_CODE = 'CUSTOM_DENIAL'

const gatewayFailure: AgentRequestFailure = {
  kind: 'gateway',
  error: { code: AgentGatewayErrorCode.AGENT_SCOPE_DENIED, message: 'denied' },
}
const legacyFailure: AgentRequestFailure = {
  kind: 'legacy-admission',
  code: LEGACY_ADMISSION_CODE,
  statusCode: 500,
  message: 'legacy denied',
  details: { reason: 'policy' },
}
const outcomeUnknown: AgentGatewayErrorDTO = {
  code: AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN,
  message: 'outcome unknown',
}

async function advanceToInFlight(ledger: AgentRequestLedger, key: AgentRequestKey): Promise<void> {
  await ledger.prepare(key, 'digest-a')
  await ledger.acceptAdmission(key, 'admission-a')
  await ledger.beginEffect(key)
}

async function ledgerAt(
  state: AgentRequestLedgerRecord['state'],
): Promise<{ ledger: InMemoryAgentRequestLedger; key: AgentRequestKey }> {
  const ledger = new InMemoryAgentRequestLedger()
  const key = requestKey()
  await ledger.prepare(key, 'digest-a')
  if (state === 'pending-admission') return { ledger, key }
  if (state === 'rejected') {
    await ledger.reject(key, gatewayFailure)
    return { ledger, key }
  }
  await ledger.acceptAdmission(key, 'admission-a')
  if (state === 'admission-accepted') return { ledger, key }
  await ledger.beginEffect(key)
  if (state === 'in-flight') return { ledger, key }
  if (state === 'completed') await ledger.complete(key, { accepted: true })
  if (state === 'outcome-unknown') await ledger.markOutcomeUnknown(key, outcomeUnknown)
  return { ledger, key }
}

describe('AgentRequestLedger exact state machine (process-lifetime Level B fake)', () => {
  it('prepares missing records and returns the current record on same-digest retry', async () => {
    const ledger = new InMemoryAgentRequestLedger()
    const key = requestKey()
    const prepared = await ledger.prepare(key, 'digest-a')
    expect(prepared).toMatchObject({ state: 'pending-admission', key, digest: 'digest-a' })
    expect(await ledger.prepare(key, 'digest-a')).toBe(prepared)
    await expect(ledger.prepare(key, 'digest-b')).rejects.toMatchObject({
      code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT,
    })
  })

  it('coalesces concurrent same-digest preparation', async () => {
    const ledger = new InMemoryAgentRequestLedger()
    const key = requestKey()
    const records = await Promise.all([
      ledger.prepare(key, 'digest-a'),
      ledger.prepare(key, 'digest-a'),
      ledger.prepare(key, 'digest-a'),
    ])
    expect(records.every((record) => record === records[0])).toBe(true)
  })

  it('replays every current state for the same digest and conflicts every state for a different digest', async () => {
    for (const state of [
      'pending-admission',
      'admission-accepted',
      'in-flight',
      'rejected',
      'completed',
      'outcome-unknown',
    ] as const) {
      const { ledger, key } = await ledgerAt(state)
      await expect(ledger.prepare(key, 'digest-a')).resolves.toMatchObject({ state })
      await expect(ledger.prepare(key, 'digest-b')).rejects.toMatchObject({
        code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT,
      })
    }
  })

  it('accepts admission only from pending-admission', async () => {
    const { ledger, key } = await ledgerAt('pending-admission')
    await ledger.acceptAdmission(key, 'receipt')
    await expect(ledger.read(key)).resolves.toMatchObject({ state: 'admission-accepted', admissionReceipt: 'receipt' })
  })

  it('strongly rejects only from pending-admission and preserves the closed Gateway error', async () => {
    const { ledger, key } = await ledgerAt('pending-admission')
    await ledger.reject(key, gatewayFailure)
    await expect(ledger.read(key)).resolves.toMatchObject({ state: 'rejected', failure: gatewayFailure })
    expect(await ledger.prepare(key, 'digest-a')).toMatchObject({ state: 'rejected', failure: gatewayFailure })
  })

  it('begins an effect only after accepted admission', async () => {
    const { ledger, key } = await ledgerAt('admission-accepted')
    await ledger.beginEffect(key)
    await expect(ledger.read(key)).resolves.toMatchObject({ state: 'in-flight' })
  })

  it('records a legacy observed rejection only from in-flight without widening public errors', async () => {
    const { ledger, key } = await ledgerAt('in-flight')
    await ledger.reject(key, legacyFailure)
    await expect(ledger.read(key)).resolves.toMatchObject({ state: 'rejected', failure: legacyFailure })
  })

  it('completes only from in-flight and replays the typed JSON receipt', async () => {
    const { ledger, key } = await ledgerAt('in-flight')
    const receipt = { accepted: true, cursor: 7 }
    await ledger.complete(key, receipt)
    await expect(ledger.read(key)).resolves.toMatchObject({ state: 'completed', receipt })
    expect(await ledger.prepare(key, 'digest-a')).toMatchObject({ state: 'completed', receipt })
  })

  it('marks outcome unknown only from in-flight', async () => {
    const { ledger, key } = await ledgerAt('in-flight')
    await ledger.markOutcomeUnknown(key, outcomeUnknown)
    await expect(ledger.read(key)).resolves.toMatchObject({ state: 'outcome-unknown', error: outcomeUnknown })
  })

  it('rejects every invalid CAS predecessor', async () => {
    const states: AgentRequestLedgerRecord['state'][] = [
      'pending-admission',
      'admission-accepted',
      'in-flight',
      'rejected',
      'completed',
      'outcome-unknown',
    ]
    const operations = [
      ['acceptAdmission', (ledger: AgentRequestLedger, key: AgentRequestKey) => ledger.acceptAdmission(key, 'receipt'), 'pending-admission'],
      ['beginEffect', (ledger: AgentRequestLedger, key: AgentRequestKey) => ledger.beginEffect(key), 'admission-accepted'],
      ['strong reject', (ledger: AgentRequestLedger, key: AgentRequestKey) => ledger.reject(key, gatewayFailure), 'pending-admission'],
      ['legacy reject', (ledger: AgentRequestLedger, key: AgentRequestKey) => ledger.reject(key, legacyFailure), 'in-flight'],
      ['complete', (ledger: AgentRequestLedger, key: AgentRequestKey) => ledger.complete(key, { ok: true }), 'in-flight'],
      ['markOutcomeUnknown', (ledger: AgentRequestLedger, key: AgentRequestKey) => ledger.markOutcomeUnknown(key, outcomeUnknown), 'in-flight'],
    ] as const

    for (const [name, operation, validState] of operations) {
      for (const state of states) {
        if (state === validState) continue
        const { ledger, key } = await ledgerAt(state)
        await expect(operation(ledger, key), `${name} from ${state}`).rejects.toThrow('invalid ledger transition')
      }
      const ledger = new InMemoryAgentRequestLedger()
      await expect(operation(ledger, requestKey()), `${name} from missing`).rejects.toThrow('invalid ledger transition')
    }
  })

  it('validates create Agent targets and full session targets for all other effects', async () => {
    const ledger = new InMemoryAgentRequestLedger()
    await expect(ledger.prepare(requestKey('session.create', sessionTarget), 'digest')).rejects.toThrow('effect/target mismatch')
    for (const effect of [
      'session.rename',
      'session.delete',
      'session.prompt',
      'session.followup',
      'session.interrupt',
      'session.stop',
      'session.queue.clear',
    ] as const) {
      await expect(ledger.prepare(requestKey(effect, agentTarget, { requestId: effect }), 'digest')).rejects.toThrow('effect/target mismatch')
      await expect(ledger.prepare(requestKey(effect, sessionTarget, { requestId: effect }), 'digest')).resolves.toMatchObject({ state: 'pending-admission' })
    }
  })

  it('isolates equal request IDs across scope, subject, effect, Agent, and session targets', async () => {
    const ledger = new InMemoryAgentRequestLedger()
    const keys = [
      requestKey(),
      requestKey('session.create', { kind: 'agent', agentTypeId: 'beta' }),
      requestKey('session.create', agentTarget, { workspaceScopeId: 'workspace-b' }),
      requestKey('session.create', agentTarget, { authSubjectId: 'subject-b' }),
      requestKey('session.rename', sessionTarget),
      requestKey('session.rename', { kind: 'session', ref: { agentTypeId: 'alpha', sessionId: 'session-2' } }),
    ]
    for (const [index, key] of keys.entries()) {
      await expect(ledger.prepare(key, `digest-${index}`)).resolves.toMatchObject({ state: 'pending-admission' })
    }
  })

  it('leaves retryable strong admission pending and process lifetime does not imply durability', async () => {
    const ledger = new InMemoryAgentRequestLedger()
    const key = requestKey()
    await ledger.prepare(key, 'digest-a')
    // A retryable admission result performs no ledger transition.
    expect(await ledger.read(key)).toMatchObject({ state: 'pending-admission' })
    expect(await new InMemoryAgentRequestLedger().read(key)).toBeUndefined()
  })
})

interface FakeSession {
  readonly workspaceScopeId: string
  readonly ref: AgentSessionRef
  title: string
  activity: AgentSessionActivity
  readonly createdAt: number
  updatedAt: number
  seq: number
  readonly events: AgentSessionEvent[]
  readonly queue: QueuedUserMessage[]
}

interface RecordedRequest {
  readonly digest: string
  readonly receipt: unknown
}

class FakeGatewayFixture implements GatewayConformanceFixture {
  readonly gateway: AgentGateway
  private readonly primaryScopes = new WeakSet<object>()
  private readonly foreignScopes = new WeakSet<object>()
  private readonly revokedScopes = new WeakSet<object>()
  private readonly sessions = new Map<string, FakeSession>()
  private readonly requests = new Map<string, RecordedRequest>()
  private readonly connections = new Set<{
    closed: boolean
    resolveClose?: () => void
  }>()
  private now = 1_000
  private nextSessionId = 0
  private closed = false

  constructor() {
    this.gateway = {
      listAgents: async ({ scope }) => {
        this.assertOpen()
        this.verify(scope)
        return [
          { agentTypeId: 'alpha', label: 'Alpha' },
          { agentTypeId: 'beta', label: 'Beta' },
        ]
      },
      listSessions: async (input) => this.listSessions(input),
      createSession: async (input) => {
        this.assertOpen()
        const claim = this.verify(input.scope)
        if (input.agentTypeId !== 'alpha' && input.agentTypeId !== 'beta') {
          throw this.error(AgentGatewayErrorCode.AGENT_TYPE_UNKNOWN, 'unknown Agent type')
        }
        const target = `agent:${input.agentTypeId}`
        const requestKey = this.requestIdentity(claim, 'session.create', target, input.requestId)
        const digest = JSON.stringify({ agentTypeId: input.agentTypeId, title: input.title })
        const replay = this.replayRequest<AgentSessionRef>(requestKey, digest)
        if (replay !== undefined) return replay
        this.nextSessionId += 1
        const ref = { agentTypeId: input.agentTypeId, sessionId: `session-${this.nextSessionId}` }
        const timestamp = this.tick()
        this.sessions.set(this.sessionIdentity(claim.workspaceScopeId, ref), {
          workspaceScopeId: claim.workspaceScopeId,
          ref,
          title: input.title ?? 'Untitled',
          activity: 'idle',
          createdAt: timestamp,
          updatedAt: timestamp,
          seq: 0,
          events: [],
          queue: [],
        })
        this.requests.set(requestKey, { digest, receipt: ref })
        return ref
      },
      connectSession: async (input) => {
        this.assertOpen()
        const claim = this.verify(input.scope)
        const session = this.requireSession(claim, input.ref)
        const cursor = input.cursor ?? session.seq
        const firstReplaySeq = session.events[0]?.seq
        if (cursor > session.seq) {
          throw this.error(AgentGatewayErrorCode.AGENT_SESSION_CURSOR_AHEAD, 'cursor is ahead')
        }
        if (firstReplaySeq !== undefined && cursor < firstReplaySeq - 1) {
          throw this.error(AgentGatewayErrorCode.AGENT_SESSION_REPLAY_GAP, 'cursor was evicted')
        }
        return this.connection(input.scope, session, cursor)
      },
      readSessionState: async (input) => {
        this.assertOpen()
        const claim = this.verify(input.scope)
        return this.snapshot(this.requireSession(claim, input.ref))
      },
      renameSession: async (input) => {
        this.assertOpen()
        const claim = this.verify(input.scope)
        const target = this.targetIdentity(input.ref)
        const key = this.requestIdentity(claim, 'session.rename', target, input.requestId)
        const digest = JSON.stringify({ title: input.title })
        const replay = this.replayRequest<AgentSessionSummary>(key, digest)
        if (replay !== undefined) return replay
        const session = this.requireSession(claim, input.ref)
        session.title = input.title
        session.updatedAt = this.tick()
        const summary = this.summary(session)
        this.requests.set(key, { digest, receipt: summary })
        return summary
      },
      deleteSession: async (input) => {
        this.assertOpen()
        const claim = this.verify(input.scope)
        const target = this.targetIdentity(input.ref)
        const key = this.requestIdentity(claim, 'session.delete', target, input.requestId)
        const digest = '{}'
        if (this.requests.has(key)) {
          this.replayRequest<void>(key, digest)
          return
        }
        this.requireSession(claim, input.ref)
        this.sessions.delete(this.sessionIdentity(claim.workspaceScopeId, input.ref))
        this.requests.set(key, { digest, receipt: undefined })
      },
      close: async () => {
        this.closed = true
        for (const connection of this.connections) {
          connection.closed = true
          connection.resolveClose?.()
        }
      },
    }
  }

  issueScope(input: {
    readonly workspaceScopeId?: string
    readonly authSubjectId?: string
    readonly issuer?: 'primary' | 'foreign'
  } = {}): AuthorizedAgentScope {
    const scope = Object.freeze({
      workspaceScopeId: input.workspaceScopeId ?? 'workspace-a',
      authSubjectId: input.authSubjectId ?? 'subject-a',
    }) as AuthorizedAgentScope
    ;(input.issuer === 'foreign' ? this.foreignScopes : this.primaryScopes).add(scope)
    return scope
  }

  revoke(scope: AuthorizedAgentScope): void {
    this.revokedScopes.add(scope)
  }

  setActivity(ref: AgentSessionRef, activity: AgentSessionActivity): void {
    this.findSession(ref).activity = activity
  }

  moveSession(ref: AgentSessionRef, updatedAt: number): void {
    this.findSession(ref).updatedAt = updatedAt
  }

  private async listSessions(input: Parameters<AgentGateway['listSessions']>[0]) {
    this.assertOpen()
    const claim = this.verify(input.scope)
    const limit = input.limit ?? 50
    const filter = input.agentTypeId ?? ''
    let after: readonly [number, string, string] | undefined
    if (input.cursor !== undefined) {
      const parsed = this.parseCursor(input.cursor)
      if (
        parsed.workspaceScopeId !== claim.workspaceScopeId
        || parsed.filter !== filter
        || parsed.limit !== limit
      ) {
        throw this.error(AgentGatewayErrorCode.AGENT_SESSION_CURSOR_INVALID, 'cursor binding is invalid')
      }
      after = parsed.after
    }
    const ordered = [...this.sessions.values()]
      .filter((session) => session.workspaceScopeId === claim.workspaceScopeId)
      .filter((session) => filter === '' || session.ref.agentTypeId === filter)
      .sort((left, right) => this.compareSessions(left, right))
      .filter((session) => after === undefined || this.compareTuple(session, after) > 0)
    const sessions = ordered.slice(0, limit).map((session) => this.summary(session))
    if (ordered.length <= limit || sessions.length === 0) return { sessions }
    const last = sessions[sessions.length - 1]
    return {
      sessions,
      nextCursor: this.createCursor({
        workspaceScopeId: claim.workspaceScopeId,
        filter,
        limit,
        after: [last.updatedAt, last.ref.agentTypeId, last.ref.sessionId],
      }),
    }
  }

  private connection(
    scope: AuthorizedAgentScope,
    session: FakeSession,
    cursor: number,
  ): AgentSessionConnection {
    const state: {
      closed: boolean
      resolveClose?: () => void
    } = { closed: false }
    this.connections.add(state)
    let eventIndex = session.events.findIndex((event) => event.seq > cursor)
    if (eventIndex < 0) eventIndex = session.events.length
    const events: AsyncIterable<AgentSessionEvent> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          if (state.closed) return { done: true, value: undefined }
          const event = session.events[eventIndex]
          if (event === undefined) {
            return new Promise((resolve) => {
              state.resolveClose = () => resolve({ done: true, value: undefined })
            })
          }
          eventIndex += 1
          return { done: false, value: event }
        },
      }),
    }
    return {
      ref: session.ref,
      events,
      send: async (input) => {
        this.assertConnection(scope, state)
        const claim = this.verify(scope)
        const operation = input.kind === 'prompt' ? 'session.prompt' : 'session.followup'
        const key = this.requestIdentity(claim, operation, this.targetIdentity(session.ref), input.requestId)
        const digest = JSON.stringify(input)
        const replay = this.replayRequest<Awaited<ReturnType<AgentSessionConnection['send']>>>(key, digest)
        if (replay !== undefined) return { ...replay, duplicate: true }
        if (input.kind === 'prompt' && session.activity !== 'idle' && session.activity !== 'error') {
          throw this.error(AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE, 'prompt is invalid in current state')
        }
        if (input.kind === 'prompt') {
          session.activity = 'running'
        } else {
          session.queue.push({
            id: `queue-${session.queue.length + 1}`,
            kind: 'followup',
            clientNonce: input.clientNonce,
            clientSeq: input.clientSeq,
            displayText: input.displayContent ?? input.content,
          })
        }
        const event = this.appendEvent(session)
        const receipt = {
          accepted: true as const,
          cursor: event.seq,
          disposition: input.kind,
          clientNonce: input.clientNonce,
          ...(input.kind === 'followup' ? { clientSeq: input.clientSeq } : {}),
        }
        this.requests.set(key, { digest, receipt })
        return receipt
      },
      interrupt: async (input) => {
        this.assertConnection(scope, state)
        const claim = this.verify(scope)
        return this.control(claim, session, 'session.interrupt', input.requestId, () => {
          if (session.activity === 'running') session.activity = 'aborting'
          return { accepted: true as const, cursor: this.appendEvent(session).seq }
        })
      },
      stop: async (input) => {
        this.assertConnection(scope, state)
        const claim = this.verify(scope)
        return this.control(claim, session, 'session.stop', input.requestId, () => {
          const clearedQueue = session.queue.splice(0)
          const stopped = session.activity === 'running' || session.activity === 'aborting'
          session.activity = 'idle'
          return { accepted: true as const, cursor: this.appendEvent(session).seq, stopped, clearedQueue }
        })
      },
      clearQueue: async (input) => {
        this.assertConnection(scope, state)
        const claim = this.verify(scope)
        const key = this.requestIdentity(claim, 'session.queue.clear', this.targetIdentity(session.ref), input.requestId)
        const digest = JSON.stringify({ clientNonce: input.clientNonce, clientSeq: input.clientSeq })
        const replay = this.replayRequest<Awaited<ReturnType<AgentSessionConnection['clearQueue']>>>(key, digest)
        if (replay !== undefined) return replay
        if (input.clientNonce !== undefined && input.clientSeq !== undefined) {
          const selected = session.queue.find((queued) =>
            queued.clientNonce === input.clientNonce || queued.clientSeq === input.clientSeq,
          )
          if (selected !== undefined && (selected.clientNonce !== input.clientNonce || selected.clientSeq !== input.clientSeq)) {
            throw this.error(AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT, 'queue selectors disagree')
          }
        }
        const before = session.queue.length
        const retained = session.queue.filter((queued) => {
          if (input.clientNonce !== undefined && queued.clientNonce !== input.clientNonce) return true
          if (input.clientSeq !== undefined && queued.clientSeq !== input.clientSeq) return true
          return input.clientNonce === undefined && input.clientSeq === undefined ? false : false
        })
        session.queue.splice(0, session.queue.length, ...retained)
        const receipt = { accepted: true as const, cursor: this.appendEvent(session).seq, cleared: before - retained.length }
        this.requests.set(key, { digest, receipt })
        return receipt
      },
      close: async () => {
        state.closed = true
        state.resolveClose?.()
        this.connections.delete(state)
      },
    }
  }

  private control<T>(
    claim: VerifiedAgentScopeClaim,
    session: FakeSession,
    operation: AgentRequestKey['operation'],
    requestId: string,
    effect: () => T,
  ): T {
    const key = this.requestIdentity(claim, operation, this.targetIdentity(session.ref), requestId)
    const replay = this.replayRequest<T>(key, '{}')
    if (replay !== undefined) return replay
    const receipt = effect()
    this.requests.set(key, { digest: '{}', receipt })
    return receipt
  }

  private appendEvent(session: FakeSession): AgentSessionEvent {
    session.seq += 1
    session.updatedAt = this.tick()
    const event: AgentSessionEvent = {
      ref: session.ref,
      seq: session.seq,
      event: {
        type: 'queue-updated',
        seq: session.seq,
        queue: { followUps: session.queue.map((queued) => ({ ...queued })) },
      },
    }
    session.events.push(event)
    if (session.events.length > 4) session.events.shift()
    return event
  }

  private snapshot(session: FakeSession): AgentSessionStateSnapshot {
    return {
      ref: session.ref,
      seq: session.seq,
      summary: this.summary(session),
      state: {
        protocolVersion: 1,
        sessionId: session.ref.sessionId,
        seq: session.seq,
        status: session.activity === 'running'
          ? 'streaming'
          : session.activity === 'aborting'
            ? 'aborting'
            : session.activity,
        messages: [],
        queue: { followUps: session.queue.map((queued) => ({ ...queued })) },
        followUpMode: 'one-at-a-time',
      },
    }
  }

  private summary(session: FakeSession): AgentSessionSummary {
    return {
      ref: session.ref,
      title: session.title,
      status: session.activity,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    }
  }

  private replayRequest<T>(key: string, digest: string): T | undefined {
    const recorded = this.requests.get(key)
    if (recorded === undefined) return undefined
    if (recorded.digest !== digest) {
      throw this.error(AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT, 'request id reused with different payload')
    }
    return recorded.receipt as T
  }

  private verify(scope: AuthorizedAgentScope): VerifiedAgentScopeClaim {
    if (!this.primaryScopes.has(scope) || this.foreignScopes.has(scope) || this.revokedScopes.has(scope)) {
      throw this.error(AgentGatewayErrorCode.AGENT_SCOPE_DENIED, 'scope denied')
    }
    return { workspaceScopeId: scope.workspaceScopeId, authSubjectId: scope.authSubjectId }
  }

  private requireSession(claim: VerifiedAgentScopeClaim, ref: AgentSessionRef): FakeSession {
    const session = this.sessions.get(this.sessionIdentity(claim.workspaceScopeId, ref))
    if (session === undefined) {
      throw this.error(AgentGatewayErrorCode.AGENT_SESSION_NOT_FOUND, 'session not found')
    }
    return session
  }

  private findSession(ref: AgentSessionRef): FakeSession {
    const session = [...this.sessions.values()].find((candidate) =>
      candidate.ref.agentTypeId === ref.agentTypeId && candidate.ref.sessionId === ref.sessionId,
    )
    if (session === undefined) throw new Error('test session not found')
    return session
  }

  private assertConnection(scope: AuthorizedAgentScope, state: { closed: boolean }): void {
    this.assertOpen()
    if (state.closed) throw this.error(AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED, 'connection closed')
    this.verify(scope)
  }

  private assertOpen(): void {
    if (this.closed) throw this.error(AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED, 'gateway closed')
  }

  private error(code: AgentGatewayErrorDTO['code'], message: string): AgentGatewayError {
    return new AgentGatewayError(code, message)
  }

  private requestIdentity(
    claim: VerifiedAgentScopeClaim,
    operation: AgentRequestKey['operation'],
    target: string,
    requestId: string,
  ): string {
    return [claim.workspaceScopeId, claim.authSubjectId, operation, target, requestId].join('|')
  }

  private targetIdentity(ref: AgentSessionRef): string {
    return `session:${ref.agentTypeId}:${ref.sessionId}`
  }

  private sessionIdentity(workspaceScopeId: string, ref: AgentSessionRef): string {
    return `${workspaceScopeId}|${ref.agentTypeId}|${ref.sessionId}`
  }

  private compareSessions(left: FakeSession, right: FakeSession): number {
    return right.updatedAt - left.updatedAt
      || left.ref.agentTypeId.localeCompare(right.ref.agentTypeId)
      || left.ref.sessionId.localeCompare(right.ref.sessionId)
  }

  private compareTuple(session: FakeSession, tuple: readonly [number, string, string]): number {
    return tuple[0] - session.updatedAt
      || session.ref.agentTypeId.localeCompare(tuple[1])
      || session.ref.sessionId.localeCompare(tuple[2])
  }

  private createCursor(payload: {
    readonly workspaceScopeId: string
    readonly filter: string
    readonly limit: number
    readonly after: readonly [number, string, string]
  }): string {
    const body = encodeURIComponent(JSON.stringify(payload))
    return `${body}.${this.cursorChecksum(body)}`
  }

  private parseCursor(cursor: string): {
    readonly workspaceScopeId: string
    readonly filter: string
    readonly limit: number
    readonly after: readonly [number, string, string]
  } {
    const separator = cursor.lastIndexOf('.')
    const body = cursor.slice(0, separator)
    const checksum = cursor.slice(separator + 1)
    if (separator < 0 || checksum !== this.cursorChecksum(body)) {
      throw this.error(AgentGatewayErrorCode.AGENT_SESSION_CURSOR_INVALID, 'cursor is invalid')
    }
    try {
      const parsed = JSON.parse(decodeURIComponent(body)) as {
        workspaceScopeId?: unknown
        filter?: unknown
        limit?: unknown
        after?: unknown
      }
      if (
        typeof parsed.workspaceScopeId !== 'string'
        || typeof parsed.filter !== 'string'
        || typeof parsed.limit !== 'number'
        || !Array.isArray(parsed.after)
        || parsed.after.length !== 3
        || typeof parsed.after[0] !== 'number'
        || typeof parsed.after[1] !== 'string'
        || typeof parsed.after[2] !== 'string'
      ) throw new Error('invalid shape')
      return parsed as {
        workspaceScopeId: string
        filter: string
        limit: number
        after: [number, string, string]
      }
    } catch {
      throw this.error(AgentGatewayErrorCode.AGENT_SESSION_CURSOR_INVALID, 'cursor is invalid')
    }
  }

  private cursorChecksum(value: string): string {
    let checksum = 17
    for (const character of value) checksum = (checksum * 31 + character.charCodeAt(0)) >>> 0
    return checksum.toString(36)
  }

  private tick(): number {
    this.now += 1
    return this.now
  }
}

gatewayConformance({
  createFixture: async () => new FakeGatewayFixture(),
  replayLevel: 'B',
  paginationLevel: 'keyset',
})
