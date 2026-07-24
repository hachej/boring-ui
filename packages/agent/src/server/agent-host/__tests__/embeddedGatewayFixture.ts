import {
  AgentGatewayError,
  AgentGatewayErrorCode,
  type AgentSessionActivity,
  type AgentSessionRef,
  type AuthorizedAgentScope,
} from '../../../shared/index'
import type { PiChatEvent, PiChatSnapshot, QueuedUserMessage } from '../../../shared/chat'
import type { PiChatEventSubscriber, PiChatSessionService, PiSessionRequestContext } from '../../../core/piChatSessionService'
import { EmbeddedAgentGateway } from '../embeddedGateway'
import { InMemoryAgentRequestLedger } from '../requestLedger'
import { AgentSessionActivityIndex } from '../sessionInventory'
import type { AgentGatewayEffect, AgentHostAgentSpec } from '../types'
import type { GatewayConformanceFixture } from '../testing/gatewayConformance'

interface RecordValue {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  status: AgentSessionActivity
  seq: number
  queue: QueuedUserMessage[]
  events: PiChatEvent[]
  subscribers: Set<PiChatEventSubscriber>
}

let globalCreated = 0

class FakeService implements PiChatSessionService {
  readonly records = new Map<string, RecordValue>()

  async listSessions(_ctx: PiSessionRequestContext, options?: { includeId?: string }) {
    const rows = [...this.records.values()].map(this.summary)
    if (!options?.includeId || rows.some((row) => row.id === options.includeId)) return rows
    return rows
  }

  async createSession(_ctx: PiSessionRequestContext, init?: { title?: string }) {
    const created = ++globalCreated
    const id = `session-${created}`
    const now = new Date(1_000 + created).toISOString()
    const record: RecordValue = {
      id,
      title: init?.title ?? 'New session',
      createdAt: now,
      updatedAt: now,
      status: 'idle',
      seq: 0,
      queue: [],
      events: [],
      subscribers: new Set(),
    }
    this.records.set(id, record)
    return this.summary(record)
  }

  async deleteSession(_ctx: PiSessionRequestContext, sessionId: string) {
    this.records.delete(sessionId)
  }

  async readState(_ctx: PiSessionRequestContext, sessionId: string): Promise<PiChatSnapshot> {
    const record = this.get(sessionId)
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

  async subscribe(_ctx: PiSessionRequestContext, sessionId: string, cursor: number, subscriber: PiChatEventSubscriber) {
    const record = this.get(sessionId)
    const minReplaySeq = Math.max(0, record.seq - 4)
    if (cursor < minReplaySeq) return { type: 'replay_gap' as const, latestSeq: record.seq, minReplaySeq }
    if (cursor > record.seq) return { type: 'cursor_ahead' as const, latestSeq: record.seq, minReplaySeq }
    for (const event of record.events.filter((event) => event.seq > cursor)) subscriber(event)
    record.subscribers.add(subscriber)
    return { type: 'ok' as const, unsubscribe: () => record.subscribers.delete(subscriber) }
  }

  async prompt(_ctx: PiSessionRequestContext, sessionId: string, payload: { clientNonce: string }) {
    const record = this.get(sessionId)
    if (record.status === 'running' || record.status === 'aborting') {
      throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE, 'prompt is invalid while active')
    }
    record.status = 'running'
    const event = this.publish(record, { type: 'agent-start', seq: 0, turnId: `turn-${record.seq + 1}` })
    return { accepted: true as const, cursor: event.seq, clientNonce: payload.clientNonce }
  }

  async followUp(_ctx: PiSessionRequestContext, sessionId: string, payload: { clientNonce: string; clientSeq: number; message: string }) {
    const record = this.get(sessionId)
    record.queue.push({ id: `${payload.clientNonce}:${payload.clientSeq}`, kind: 'followup', clientNonce: payload.clientNonce, clientSeq: payload.clientSeq, displayText: payload.message })
    const event = this.publish(record, { type: 'queue-updated', seq: 0, queue: { followUps: [...record.queue] } })
    return { accepted: true as const, cursor: event.seq, clientNonce: payload.clientNonce, clientSeq: payload.clientSeq, queued: true as const }
  }

  async clearQueue(_ctx: PiSessionRequestContext, sessionId: string, payload: { clientNonce?: string; clientSeq?: number }) {
    const record = this.get(sessionId)
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

  async interrupt(_ctx: PiSessionRequestContext, sessionId: string) {
    const record = this.get(sessionId)
    if (record.status === 'running') record.status = 'aborting'
    return { accepted: true as const, cursor: record.seq }
  }

  async stop(_ctx: PiSessionRequestContext, sessionId: string) {
    const record = this.get(sessionId)
    const stopped = record.status === 'running' || record.status === 'aborting'
    const clearedQueue = [...record.queue]
    record.status = 'idle'
    record.queue = []
    return { accepted: true as const, cursor: record.seq, stopped, clearedQueue }
  }

  async rename(sessionId: string, title: string) {
    const record = this.get(sessionId)
    record.title = title
    record.updatedAt = new Date(Date.parse(record.updatedAt) + 1).toISOString()
    return this.summary(record)
  }

  setActivity(sessionId: string, activity: AgentSessionActivity) {
    this.get(sessionId).status = activity
  }

  move(sessionId: string, updatedAt: number) {
    this.get(sessionId).updatedAt = new Date(updatedAt).toISOString()
  }

  private publish(record: RecordValue, event: PiChatEvent): PiChatEvent {
    const published = { ...event, seq: ++record.seq } as PiChatEvent
    record.events.push(published)
    if (record.events.length > 4) record.events.shift()
    for (const subscriber of record.subscribers) subscriber(published)
    return published
  }

  private get(sessionId: string) {
    const record = this.records.get(sessionId)
    if (!record) throw new Error('not found')
    return record
  }

  private summary = (record: RecordValue) => ({
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    turnCount: 0,
  })
}

export async function createEmbeddedGatewayFixture(): Promise<GatewayConformanceFixture> {
  const issued = new WeakSet<object>()
  const revoked = new WeakSet<object>()
  const services = new Map<string, FakeService>()
  const admission = new Map<AgentGatewayEffect, Array<'strong-reject' | 'retryable'>>()
  const agents: readonly AgentHostAgentSpec[] = [
    { agentTypeId: 'alpha', definition: { instructions: 'alpha', label: 'Alpha' } },
    { agentTypeId: 'beta', definition: { instructions: 'beta', label: 'Beta' } },
  ]
  const serviceFor = (workspaceScopeId: string, agentTypeId: string) => {
    const key = `${workspaceScopeId}:${agentTypeId}`
    let service = services.get(key)
    if (!service) {
      service = new FakeService()
      services.set(key, service)
    }
    return service
  }
  const activity = new AgentSessionActivityIndex()
  const runtime = {
    options: {},
    compiledAgents: agents,
    compiledById: new Map(agents.map((agent) => [agent.agentTypeId, agent])),
    ledger: new InMemoryAgentRequestLedger(),
    activity,
    async listSessionSummaries(agentTypeId: string, _scope: AuthorizedAgentScope, claim: { workspaceScopeId: string }) {
      return await serviceFor(claim.workspaceScopeId, agentTypeId).listSessions({
        workspaceId: claim.workspaceScopeId,
        requestId: 'inventory-list',
      })
    },
    effectAdmission: {
      async admit({ operation }: { operation: AgentGatewayEffect }) {
        const disposition = admission.get(operation)?.shift()
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
    async resolveBinding(agentTypeId: string, _scope: AuthorizedAgentScope, claim: { workspaceScopeId: string }) {
      const service = serviceFor(claim.workspaceScopeId, agentTypeId)
      return {
        key: `${claim.workspaceScopeId}:${agentTypeId}`,
        scope: { identity: 'shared-runtime' },
        environmentLease: { bundle: {}, release() {} },
        composition: {
          service,
          sessionStore: {
            rename: async (_ctx: unknown, sessionId: string, title: string) => service.rename(sessionId, title),
          },
        },
      }
    },
    startDrain() {},
    registerSubscription() { return () => {} },
    trackEffect<T>(effect: Promise<T>) { return effect },
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
      for (const [key, service] of services) {
        if (!key.endsWith(`:${ref.agentTypeId}`) || !service.records.has(ref.sessionId)) continue
        const workspaceScopeId = key.slice(0, -(ref.agentTypeId.length + 1))
        service.setActivity(ref.sessionId, activity)
        embedded.setActivityForTesting(workspaceScopeId, ref, activity)
      }
    },
    moveSession(ref, updatedAt) {
      for (const service of services.values()) if (service.records.has(ref.sessionId)) service.move(ref.sessionId, updatedAt)
    },
    queueAdmission(operation, disposition) {
      const queue = admission.get(operation) ?? []
      queue.push(disposition)
      admission.set(operation, queue)
    },
  }
}
