import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent'
import type { AgentCoreHarness, AgentHarnessFactoryInput, RunContext } from '../../shared/harness'
import type { AgentSendInput } from '../../shared/events'
import type { SessionCtx, SessionDetail, SessionStore, SessionSummary } from '../../shared/session'
import type {
  PiAgentPromptInput,
  PiAgentSessionAdapter,
  PiAgentSessionSnapshot,
} from '../pi-chat/PiAgentSessionAdapter'

export class DispatcherTestSessionStore implements SessionStore {
  readonly createContexts: SessionCtx[] = []
  private readonly records = new Map<string, SessionSummary>()
  private created = 0

  async list(ctx: SessionCtx): Promise<SessionSummary[]> {
    return [...this.records.values()].filter((record) => {
      const owner = (record as SessionSummary & { ctx: SessionCtx }).ctx
      return owner.workspaceId === ctx.workspaceId && owner.userId === ctx.userId
    })
  }

  async create(ctx: SessionCtx, init?: { title?: string }): Promise<SessionSummary> {
    this.createContexts.push(ctx)
    const now = '2026-07-10T00:00:00.000Z'
    const record = {
      id: `dispatcher-session-${++this.created}`,
      title: init?.title ?? 'New session',
      createdAt: now,
      updatedAt: now,
      turnCount: 0,
      ctx: { ...ctx },
    }
    this.records.set(record.id, record)
    return record
  }

  async load(ctx: SessionCtx, sessionId: string): Promise<SessionDetail> {
    const record = this.records.get(sessionId) as (SessionSummary & { ctx: SessionCtx }) | undefined
    if (!record || record.ctx.workspaceId !== ctx.workspaceId || record.ctx.userId !== ctx.userId) {
      throw new Error(`missing session ${sessionId}`)
    }
    return record
  }

  async rename(ctx: SessionCtx, sessionId: string, title: string): Promise<SessionSummary> {
    const record = await this.load(ctx, sessionId) as SessionSummary & { ctx: SessionCtx }
    const updated = { ...record, title, updatedAt: new Date().toISOString() }
    this.records.set(sessionId, updated)
    return updated
  }

  async delete(ctx: SessionCtx, sessionId: string): Promise<void> {
    await this.load(ctx, sessionId)
    this.records.delete(sessionId)
  }
}

export function createDispatcherTestHarness() {
  const sessions = new DispatcherTestSessionStore()
  const adapters = new Map<string, DispatcherTestAdapter>()
  const sendInputs: AgentSendInput[] = []
  const factoryInputs: AgentHarnessFactoryInput[] = []

  const factory = async (factoryInput: AgentHarnessFactoryInput): Promise<AgentCoreHarness> => {
    factoryInputs.push(factoryInput)
    return {
      id: 'workspace-dispatcher-test-harness',
      placement: 'server',
      sessions,
      async getPiSessionAdapter(input: AgentSendInput, _ctx: RunContext): Promise<PiAgentSessionAdapter> {
        if (!input.sessionId) throw new Error('session id required')
        sendInputs.push(input)
        let adapter = adapters.get(input.sessionId)
        if (!adapter) {
          adapter = new DispatcherTestAdapter(input.sessionId)
          adapters.set(input.sessionId, adapter)
        }
        return adapter
      },
    }
  }

  return { factory, factoryInputs, sessions, sendInputs, adapters }
}

class DispatcherTestAdapter implements PiAgentSessionAdapter {
  private readonly subscribers = new Set<(event: AgentSessionEvent) => void>()
  private streaming = false
  abortCount = 0

  constructor(private readonly sessionId: string) {}

  readSnapshot(): PiAgentSessionSnapshot {
    return {
      state: {},
      messages: [],
      isStreaming: this.streaming,
      isRetrying: false,
      retryAttempt: 0,
      pendingMessageCount: 0,
      steeringMessages: [],
      followUpMessages: [],
      followUpMode: 'one-at-a-time',
      sessionId: this.sessionId,
    }
  }

  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    this.subscribers.add(listener)
    return () => this.subscribers.delete(listener)
  }

  async prompt(_input: PiAgentPromptInput): Promise<void> {
    this.streaming = true
    const assistant = {
      id: 'assistant-dispatcher',
      role: 'assistant',
      content: [{ type: 'text', text: 'done' }],
      provider: 'test',
      model: 'gpt-5.5',
      stopReason: 'stop',
      usage: {
        input: 3,
        output: 2,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 5,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      timestamp: 0,
    }
    this.emit({ type: 'agent_start', turnId: 'turn-dispatcher' } as unknown as AgentSessionEvent)
    this.emit({
      type: 'message_update',
      message: assistant,
      assistantMessageEvent: { type: 'done', message: assistant },
    } as unknown as AgentSessionEvent)
    this.streaming = false
    this.emit({
      type: 'agent_end',
      messages: [assistant],
      willRetry: false,
    } as unknown as AgentSessionEvent)
  }

  async followUp(): Promise<void> {}

  clearFollowUp(): void {}

  async abort(): Promise<void> {
    this.abortCount += 1
    this.streaming = false
  }

  private emit(event: AgentSessionEvent): void {
    for (const subscriber of this.subscribers) subscriber(event)
  }
}
