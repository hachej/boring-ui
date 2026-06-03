import type { AgentHarness, RunContext, SendMessageInput } from '../../shared/harness'
import type { SessionStore } from '../../shared/session'
import type { FollowUpPayload, FollowUpReceipt, InterruptPayload, PromptPayload, PromptReceipt, QueueClearPayload, QueueClearReceipt, StopPayload, StopReceipt } from '../../shared/chat'
import type { PiChatSessionService, PiChatEventSubscriber, PiChatEventStreamResult } from '../http/routes/piChat'
import type { PiSessionCreateInit, PiSessionRequestContext } from './piSessionIdentity'
import type { PiAgentSessionAdapter } from './PiAgentSessionAdapter'
import { buildPiChatQueuedFollowUps, buildPiChatSnapshot } from './piChatSnapshot'
import { mapPiAgentSessionEvent } from './piChatEvents'
import { PiChatReplayBuffer } from './piChatReplayBuffer'

type PiNativeHarness = AgentHarness & {
  getPiSessionAdapter?: (input: SendMessageInput, ctx: RunContext) => Promise<unknown>
}

interface LiveSessionChannel {
  buffer: PiChatReplayBuffer
  adapter: PiAgentSessionAdapter
  unsubscribe: () => void
}

export interface HarnessPiChatServiceOptions {
  harness: AgentHarness
  sessionStore: SessionStore
  workdir: string
}

export class HarnessPiChatService implements PiChatSessionService {
  private readonly harness: PiNativeHarness
  private readonly sessionStore: SessionStore
  private readonly workdir: string
  private readonly channels = new Map<string, LiveSessionChannel>()

  constructor(options: HarnessPiChatServiceOptions) {
    this.harness = options.harness as PiNativeHarness
    this.sessionStore = options.sessionStore
    this.workdir = options.workdir
  }

  async listSessions(ctx: PiSessionRequestContext) {
    return this.sessionStore.list(toSessionCtx(ctx))
  }

  async createSession(ctx: PiSessionRequestContext, init?: PiSessionCreateInit) {
    return this.sessionStore.create(toSessionCtx(ctx), init)
  }

  async deleteSession(ctx: PiSessionRequestContext, sessionId: string) {
    this.channels.get(sessionId)?.unsubscribe()
    this.channels.delete(sessionId)
    await this.sessionStore.delete(toSessionCtx(ctx), sessionId)
  }

  async readState(ctx: PiSessionRequestContext, sessionId: string) {
    const adapter = await this.getAdapter(ctx, sessionId, '')
    return buildPiChatSnapshot(adapter, { seq: this.channels.get(sessionId)?.buffer.latestSeq ?? 0 })
  }

  async subscribe(ctx: PiSessionRequestContext, sessionId: string, cursor: number, subscriber: PiChatEventSubscriber): Promise<PiChatEventStreamResult> {
    const channel = await this.getChannel(ctx, sessionId)
    const result = channel.buffer.subscribe(cursor, subscriber)
    if (result.type !== 'ok') return result
    return { type: 'ok', unsubscribe: result.unsubscribe }
  }

  async prompt(ctx: PiSessionRequestContext, sessionId: string, payload: PromptPayload): Promise<PromptReceipt> {
    const adapter = await this.getAdapter(ctx, sessionId, payload.message)
    await this.ensureChannel(ctx, sessionId, adapter)
    await adapter.prompt(payload.message)
    return { accepted: true, cursor: this.channels.get(sessionId)?.buffer.latestSeq ?? 0, clientNonce: payload.clientNonce }
  }

  async followUp(ctx: PiSessionRequestContext, sessionId: string, payload: FollowUpPayload): Promise<FollowUpReceipt> {
    const adapter = await this.getAdapter(ctx, sessionId, payload.message)
    await this.ensureChannel(ctx, sessionId, adapter)
    await adapter.followUp(payload.message)
    return { accepted: true, queued: true, cursor: this.channels.get(sessionId)?.buffer.latestSeq ?? 0, clientNonce: payload.clientNonce, clientSeq: payload.clientSeq }
  }

  async clearQueue(ctx: PiSessionRequestContext, sessionId: string, _payload: QueueClearPayload): Promise<QueueClearReceipt> {
    const adapter = await this.getAdapter(ctx, sessionId, '')
    const cleared = adapter.clearQueue().followUp.length
    return { accepted: true, cursor: this.channels.get(sessionId)?.buffer.latestSeq ?? 0, cleared }
  }

  async interrupt(ctx: PiSessionRequestContext, sessionId: string, _payload: InterruptPayload): Promise<{ accepted: true; cursor: number }> {
    const adapter = await this.getAdapter(ctx, sessionId, '')
    adapter.abortRetry?.()
    return { accepted: true, cursor: this.channels.get(sessionId)?.buffer.latestSeq ?? 0 }
  }

  async stop(ctx: PiSessionRequestContext, sessionId: string, _payload: StopPayload): Promise<StopReceipt> {
    const adapter = await this.getAdapter(ctx, sessionId, '')
    const clearedQueue = adapter.clearQueue().followUp
    await adapter.abort()
    return { accepted: true, stopped: true, cursor: this.channels.get(sessionId)?.buffer.latestSeq ?? 0, clearedQueue: buildPiChatQueuedFollowUps(sessionId, clearedQueue) }
  }

  private async getAdapter(ctx: PiSessionRequestContext, sessionId: string, message: string): Promise<PiAgentSessionAdapter> {
    if (!this.harness.getPiSessionAdapter) throw new Error('pi-native harness adapter unavailable')
    return await this.harness.getPiSessionAdapter({ sessionId, message }, {
      abortSignal: new AbortController().signal,
      workdir: this.workdir,
      userId: ctx.authSubject,
    }) as PiAgentSessionAdapter
  }

  private async getChannel(ctx: PiSessionRequestContext, sessionId: string): Promise<LiveSessionChannel> {
    const existing = this.channels.get(sessionId)
    if (existing) return existing
    const adapter = await this.getAdapter(ctx, sessionId, '')
    return this.ensureChannel(ctx, sessionId, adapter)
  }

  private async ensureChannel(ctx: PiSessionRequestContext, sessionId: string, adapter: PiAgentSessionAdapter): Promise<LiveSessionChannel> {
    const existing = this.channels.get(sessionId)
    if (existing) return existing
    const buffer = new PiChatReplayBuffer()
    const unsubscribe = adapter.subscribe((event) => {
      for (const mapped of mapPiAgentSessionEvent(event, { sessionId, initialSeq: buffer.latestSeq })) {
        buffer.publish(mapped)
      }
    })
    const channel = { buffer, adapter, unsubscribe }
    this.channels.set(sessionId, channel)
    return channel
  }
}

function toSessionCtx(ctx: PiSessionRequestContext) {
  return { workspaceId: ctx.workspaceId, userId: ctx.authSubject }
}
