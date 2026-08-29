import {
  AgentGatewayError,
  AgentGatewayErrorCode,
  type AgentSessionActivity,
  type AgentSessionRef,
  type AuthorizedAgentScope,
} from '../../../shared/index'
import type {
  PiChatAttachmentResult,
  PiChatEvent,
  PiChatSnapshot,
  QueuedUserMessage,
} from '../../../shared/chat'
import { ErrorCode } from '../../../shared/error-codes'
import { codedError } from '../../codedError'
import { EmbeddedAgentGateway } from '../embeddedGateway'
import type {
  AgentHarnessBackend,
  HarnessAgentScope,
  HarnessRequestContext,
  HarnessSessionAddress,
} from '../harnessBackend/types'
import { InMemoryAgentRequestLedger } from '../requestLedger'
import { AgentSessionActivityIndex } from '../sessionInventory'
import type { AgentGatewayEffect, AgentHostAgentSpec } from '../types'
import type { GatewayConformanceFixture } from '../testing/gatewayConformance'

interface EmbeddedGatewayFixture extends GatewayConformanceFixture {
  modelLoopStarts(ref: AgentSessionRef): number
  blockAdmission(operation: AgentGatewayEffect): {
    entered: Promise<void>
    release(): void
  }
  rejectNextPrompt(error: Error): void
  disableArchiveCapability(): void
}

interface RecordValue {
  id: string
  workspaceScopeId: string
  title: string
  createdAt: string
  updatedAt: string
  status: AgentSessionActivity
  archived: boolean
  seq: number
  queue: QueuedUserMessage[]
  events: PiChatEvent[]
  subscribers: Set<(event: PiChatEvent) => void>
}

let globalCreated = 0

export class FakeService implements AgentHarnessBackend {
  readonly id = 'in-memory'
  readonly records = new Map<string, RecordValue>()
  nextPromptError: Error | undefined
  private readonly createdByWorkspace = new Map<string, number>()
  private closed = false

  constructor(
    private readonly replayMaxEvents = 4,
    private readonly reuseIdsAcrossWorkspaces = false,
  ) {}

  async listSessions(scope: HarnessAgentScope, _ctx: HarnessRequestContext, options?: { includeId?: string; archived?: 'active' | 'archived' | 'all' }) {
    this.assertOpen()
    const rows = [...this.records.values()]
      .filter((record) => record.workspaceScopeId === scope.workspaceScopeId)
      .filter((record) => options?.archived === undefined
        || options.archived === 'all'
        || record.archived === (options.archived === 'archived'))
      .map(this.summary)
    if (!options?.includeId || rows.some((row) => row.id === options.includeId)) return rows
    return rows
  }

  async createSession(scope: HarnessAgentScope, _ctx: HarnessRequestContext, init?: { title?: string }) {
    this.assertOpen()
    const created = this.reuseIdsAcrossWorkspaces
      ? (this.createdByWorkspace.get(scope.workspaceScopeId) ?? 0) + 1
      : ++globalCreated
    if (this.reuseIdsAcrossWorkspaces) this.createdByWorkspace.set(scope.workspaceScopeId, created)
    const id = `session-${created}`
    const now = new Date(1_000 + created).toISOString()
    const record: RecordValue = {
      id,
      workspaceScopeId: scope.workspaceScopeId,
      title: init?.title ?? 'New session',
      createdAt: now,
      updatedAt: now,
      status: 'idle',
      archived: false,
      seq: 0,
      queue: [],
      events: [],
      subscribers: new Set(),
    }
    this.records.set(this.recordKey(scope.workspaceScopeId, id), record)
    return this.summary(record)
  }

  async deleteSession(address: HarnessSessionAddress, _ctx: HarnessRequestContext) {
    this.assertOpen()
    this.records.delete(this.recordKey(address.workspaceScopeId, address.ref.sessionId))
  }

  async readSnapshot(address: HarnessSessionAddress, _ctx: HarnessRequestContext): Promise<PiChatSnapshot> {
    this.assertOpen()
    const sessionId = address.ref.sessionId
    const record = this.get(address)
    return {
      protocolVersion: 1,
      sessionId,
      seq: record.seq,
      status: record.status === 'running' ? 'streaming' : record.status,
      messages: [],
      queue: { followUps: [...record.queue] },
      followUpMode: 'one-at-a-time',
    }
  }

  async watchEvents(address: HarnessSessionAddress, _ctx: HarnessRequestContext, cursor: number, subscriber: (event: PiChatEvent) => void) {
    this.assertOpen()
    const record = this.get(address)
    const minReplaySeq = Math.max(0, record.seq - this.replayMaxEvents)
    if (cursor < minReplaySeq) return { type: 'replay_gap' as const, latestSeq: record.seq, minReplaySeq }
    if (cursor > record.seq) return { type: 'cursor_ahead' as const, latestSeq: record.seq, minReplaySeq }
    for (const event of record.events.filter((event) => event.seq > cursor)) subscriber(event)
    record.subscribers.add(subscriber)
    return { type: 'ok' as const, unsubscribe: () => record.subscribers.delete(subscriber) }
  }

  async submitPrompt(address: HarnessSessionAddress, _ctx: HarnessRequestContext, payload: { clientNonce: string }) {
    this.assertOpen()
    if (this.nextPromptError) {
      const error = this.nextPromptError
      this.nextPromptError = undefined
      throw error
    }
    const record = this.get(address)
    if (record.status === 'running' || record.status === 'aborting') {
      throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE, 'prompt is invalid while active')
    }
    record.status = 'running'
    const event = this.publish(record, { type: 'agent-start', seq: 0, turnId: `turn-${record.seq + 1}` })
    return { accepted: true as const, cursor: event.seq, clientNonce: payload.clientNonce }
  }

  async submitFollowUp(address: HarnessSessionAddress, _ctx: HarnessRequestContext, payload: { clientNonce: string; clientSeq: number; message: string }) {
    this.assertOpen()
    const record = this.get(address)
    record.queue.push({ id: `${payload.clientNonce}:${payload.clientSeq}`, kind: 'followup', clientNonce: payload.clientNonce, clientSeq: payload.clientSeq, displayText: payload.message })
    const event = this.publish(record, { type: 'queue-updated', seq: 0, queue: { followUps: [...record.queue] } })
    return { accepted: true as const, cursor: event.seq, clientNonce: payload.clientNonce, clientSeq: payload.clientSeq, queued: true as const }
  }

  async clearQueue(address: HarnessSessionAddress, _ctx: HarnessRequestContext, payload: { clientNonce?: string; clientSeq?: number }) {
    this.assertOpen()
    const record = this.get(address)
    if (payload.clientNonce !== undefined && payload.clientSeq !== undefined) {
      const byNonce = record.queue.find((item) => item.clientNonce === payload.clientNonce)
      const bySeq = record.queue.find((item) => item.clientSeq === payload.clientSeq)
      if (!byNonce || byNonce !== bySeq) {
        throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT, 'queue selectors disagree')
      }
    }
    const before = record.queue.length
    if (payload.clientNonce !== undefined || payload.clientSeq !== undefined) {
      record.queue = record.queue.filter((item) => (
        payload.clientNonce !== undefined ? item.clientNonce !== payload.clientNonce : item.clientSeq !== payload.clientSeq
      ))
    } else record.queue = []
    const event = this.publish(record, { type: 'queue-updated', seq: 0, queue: { followUps: [...record.queue] } })
    return { accepted: true as const, cursor: event.seq, cleared: before - record.queue.length }
  }

  async interrupt(address: HarnessSessionAddress, _ctx: HarnessRequestContext, payload: { queueAction?: 'hold' | 'resume' }) {
    this.assertOpen()
    const record = this.get(address)
    if (payload.queueAction !== 'resume' && record.status === 'running') record.status = 'aborting'
    return { accepted: true as const, cursor: record.seq }
  }

  async stop(address: HarnessSessionAddress, _ctx: HarnessRequestContext) {
    this.assertOpen()
    const record = this.get(address)
    const stopped = record.status === 'running' || record.status === 'aborting'
    const clearedQueue = [...record.queue]
    record.status = 'idle'
    record.queue = []
    return { accepted: true as const, cursor: record.seq, stopped, clearedQueue }
  }

  async renameSession(address: HarnessSessionAddress, _ctx: HarnessRequestContext, title: string) {
    this.assertOpen()
    return this.rename(address, title)
  }

  async readAttachment(
    address: HarnessSessionAddress,
    _ctx: HarnessRequestContext,
    _messageId: string,
    _index: number,
  ): Promise<PiChatAttachmentResult> {
    this.assertOpen()
    this.get(address)
    throw codedError('attachment not found', ErrorCode.enum.SESSION_NOT_FOUND, 404)
  }

  async close() {
    this.closed = true
  }

  async setArchived(address: HarnessSessionAddress, archived: boolean) {
    const record = this.get(address)
    record.archived = archived
    return this.summary(record)
  }

  async rename(address: HarnessSessionAddress, title: string) {
    const record = this.get(address)
    record.title = title
    record.updatedAt = new Date(Date.parse(record.updatedAt) + 1).toISOString()
    return this.summary(record)
  }

  hasSession(workspaceScopeId: string, sessionId: string) {
    return this.records.has(this.recordKey(workspaceScopeId, sessionId))
  }

  setActivity(workspaceScopeId: string, sessionId: string, activity: AgentSessionActivity) {
    this.get({ workspaceScopeId, ref: { agentTypeId: 'fixture', sessionId } }).status = activity
  }

  move(workspaceScopeId: string, sessionId: string, updatedAt: number) {
    this.get({ workspaceScopeId, ref: { agentTypeId: 'fixture', sessionId } }).updatedAt = new Date(updatedAt).toISOString()
  }

  private publish(record: RecordValue, event: PiChatEvent): PiChatEvent {
    const published = { ...event, seq: ++record.seq } as PiChatEvent
    record.events.push(published)
    if (record.events.length > this.replayMaxEvents) record.events.shift()
    for (const subscriber of record.subscribers) subscriber(published)
    return published
  }

  private get(address: HarnessSessionAddress) {
    const record = this.records.get(this.recordKey(address.workspaceScopeId, address.ref.sessionId))
    if (!record) throw codedError('session not found', ErrorCode.enum.SESSION_NOT_FOUND, 404)
    return record
  }

  private recordKey(workspaceScopeId: string, sessionId: string) {
    return JSON.stringify([workspaceScopeId, sessionId])
  }

  private assertOpen() {
    if (this.closed) {
      throw codedError(
        'Pi chat service has been disposed.',
        ErrorCode.enum.AGENT_BINDING_DISPOSED,
      )
    }
  }

  private summary = (record: RecordValue) => ({
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    turnCount: 0,
    ...(record.archived ? { archived: true as const } : {}),
  })
}

export async function createEmbeddedGatewayFixture(): Promise<EmbeddedGatewayFixture> {
  const issued = new WeakSet<object>()
  const revoked = new WeakSet<object>()
  const backends = new Map<string, FakeService>()
  type AdmissionDisposition = 'strong-reject' | 'retryable' | {
    entered(): void
    wait: Promise<void>
  }
  const admission = new Map<AgentGatewayEffect, AdmissionDisposition[]>()
  const agents: readonly AgentHostAgentSpec[] = [
    { agentTypeId: 'alpha', definition: { instructions: 'alpha', label: 'Alpha' } },
    { agentTypeId: 'beta', definition: { instructions: 'beta', label: 'Beta' } },
  ]
  const backendFor = (workspaceScopeId: string, agentTypeId: string) => {
    const key = `${workspaceScopeId}:${agentTypeId}`
    let backend = backends.get(key)
    if (!backend) {
      backend = new FakeService()
      backends.set(key, backend)
    }
    return backend
  }
  const activity = new AgentSessionActivityIndex()
  const runtime = {
    options: {},
    compiledAgents: agents,
    compiledById: new Map(agents.map((agent) => [agent.agentTypeId, agent])),
    ledger: new InMemoryAgentRequestLedger(),
    activity,
    async listSessionSummaries(agentTypeId: string, _scope: AuthorizedAgentScope, claim: { workspaceScopeId: string }, options?: { archived?: 'active' | 'archived' | 'all' }) {
      return await backendFor(claim.workspaceScopeId, agentTypeId).listSessions({
        workspaceScopeId: claim.workspaceScopeId,
        agentTypeId,
      }, {
        authSubjectId: 'inventory',
        requestId: 'inventory-list',
      }, options)
    },
    async setSessionArchived(agentTypeId: string, _scope: AuthorizedAgentScope, claim: { workspaceScopeId: string }, sessionId: string, archived: boolean) {
      return await backendFor(claim.workspaceScopeId, agentTypeId).setArchived({
        workspaceScopeId: claim.workspaceScopeId,
        ref: { agentTypeId, sessionId },
      }, archived)
    },
    effectAdmission: {
      async admit({ operation }: { operation: AgentGatewayEffect }) {
        const disposition = admission.get(operation)?.shift()
        if (typeof disposition === 'object') {
          disposition.entered()
          await disposition.wait
        }
        if (disposition === 'strong-reject') return {
          type: 'rejected' as const,
          error: new AgentGatewayError(AgentGatewayErrorCode.AGENT_SCOPE_DENIED, 'denied').toJSON(),
        }
        if (disposition === 'retryable') return {
          type: 'retryable' as const,
          error: new AgentGatewayError(AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED, 'retry').toJSON(),
        }
        return { type: 'accepted' as const, admissionReceipt: 'accepted' }
      },
    },
    isDraining: () => false,
    assertOpen() {},
    async verify(scope: AuthorizedAgentScope) {
      if (!issued.has(scope as object) || revoked.has(scope as object)) {
        throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_SCOPE_DENIED, 'denied')
      }
      return { workspaceScopeId: scope.workspaceScopeId, authSubjectId: scope.authSubjectId }
    },
    async resolveSessionRuntime(agentTypeId: string, _scope: AuthorizedAgentScope, claim: { workspaceScopeId: string }, sessionId: string) {
      return backendFor(claim.workspaceScopeId, agentTypeId).hasSession(claim.workspaceScopeId, sessionId)
        ? { identity: 'shared-runtime' }
        : undefined
    },
    async resolveAgentRuntimeScope() {
      return { identity: 'shared-runtime' }
    },
    async resolveBinding(agentTypeId: string, _scope: AuthorizedAgentScope, claim: { workspaceScopeId: string }) {
      const backend = backendFor(claim.workspaceScopeId, agentTypeId)
      return {
        key: `${claim.workspaceScopeId}:${agentTypeId}`,
        scope: { identity: 'shared-runtime' },
        environmentLease: { bundle: {}, release() {} },
        composition: {
          backend,
        },
      }
    },
    startDrain() {},
    registerSubscription() { return () => {} },
    startPreparedEffect<T>(_key: import('../types').AgentRequestKey, effect: () => Promise<T>) { return effect() },
    runBindingOperation<T>(_bindingKey: string, operation: () => Promise<T>) { return operation() },
    async closeRuntime() {},
  }
  const embedded = new EmbeddedAgentGateway(runtime as never)

  function issueScope(input: { workspaceScopeId?: string; authSubjectId?: string; issuer?: 'primary' | 'foreign' } = {}) {
    const scope = {
      workspaceScopeId: input.workspaceScopeId ?? 'workspace',
      authSubjectId: input.authSubjectId ?? 'subject',
    } as AuthorizedAgentScope
    if (input.issuer !== 'foreign') issued.add(scope as object)
    return scope
  }

  return {
    gateway: embedded,
    issueScope,
    revoke(scope) { revoked.add(scope as object) },
    setActivity(ref: AgentSessionRef, activity: AgentSessionActivity) {
      for (const [key, backend] of backends) {
        if (!key.endsWith(`:${ref.agentTypeId}`)) continue
        const workspaceScopeId = key.slice(0, -(ref.agentTypeId.length + 1))
        if (!backend.hasSession(workspaceScopeId, ref.sessionId)) continue
        backend.setActivity(workspaceScopeId, ref.sessionId, activity)
        embedded.setActivityForTesting(workspaceScopeId, ref, activity)
      }
    },
    moveSession(ref, updatedAt) {
      for (const [key, backend] of backends) {
        if (!key.endsWith(`:${ref.agentTypeId}`)) continue
        const workspaceScopeId = key.slice(0, -(ref.agentTypeId.length + 1))
        if (backend.hasSession(workspaceScopeId, ref.sessionId)) backend.move(workspaceScopeId, ref.sessionId, updatedAt)
      }
    },
    rejectNextPrompt(error) {
      for (const backend of backends.values()) backend.nextPromptError = error
    },
    disableArchiveCapability() {
      Reflect.deleteProperty(runtime, 'setSessionArchived')
    },
    modelLoopStarts(ref) {
      for (const backend of backends.values()) {
        const record = [...backend.records.values()].find((candidate) => candidate.id === ref.sessionId)
        if (record) return record.events.filter((event) => event.type === 'agent-start').length
      }
      return 0
    },
    queueAdmission(operation, disposition) {
      const queue = admission.get(operation) ?? []
      queue.push(disposition)
      admission.set(operation, queue)
    },
    blockAdmission(operation) {
      let release!: () => void
      let markEntered!: () => void
      const wait = new Promise<void>((resolve) => { release = resolve })
      const entered = new Promise<void>((resolve) => { markEntered = resolve })
      const queue = admission.get(operation) ?? []
      queue.push({ entered: markEntered, wait })
      admission.set(operation, queue)
      return { entered, release }
    },
  }
}
