import type { AgentSessionActivity } from '../../../shared/index'
import type {
  PiChatAttachmentResult,
  PiChatEvent,
  PiChatSnapshot,
  QueuedUserMessage,
} from '../../../shared/chat'
import { ErrorCode } from '../../../shared/error-codes'
import { codedError } from '../../codedError'
import type {
  AgentHarnessBackend,
  HarnessAgentScope,
  HarnessRequestContext,
  HarnessSessionAddress,
} from '../harnessBackend/types'

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

export class InMemoryHarnessBackend implements AgentHarnessBackend {
  readonly records = new Map<string, RecordValue>()
  nextPromptError: Error | undefined
  nextFollowUpError: Error | undefined
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
      throw codedError('prompt is invalid while active', ErrorCode.enum.BRIDGE_COMMAND_INVALID, 409)
    }
    record.status = 'running'
    const event = this.publish(record, { type: 'agent-start', seq: 0, turnId: `turn-${record.seq + 1}` })
    return { accepted: true as const, cursor: event.seq, clientNonce: payload.clientNonce }
  }

  async submitFollowUp(address: HarnessSessionAddress, _ctx: HarnessRequestContext, payload: { clientNonce: string; clientSeq: number; message: string }) {
    this.assertOpen()
    if (this.nextFollowUpError) {
      const error = this.nextFollowUpError
      this.nextFollowUpError = undefined
      throw error
    }
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
        throw codedError('queue selectors disagree', ErrorCode.enum.BRIDGE_COMMAND_INVALID, 409)
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
        503,
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
