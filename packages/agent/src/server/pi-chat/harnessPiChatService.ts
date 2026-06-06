import type { AgentHarness, RunContext, SendMessageInput } from '../../shared/harness'
import type { SessionStore } from '../../shared/session'
import type { FollowUpPayload, FollowUpReceipt, InterruptPayload, PiChatEvent, PromptPayload, PromptReceipt, QueuedUserMessage, QueueClearPayload, QueueClearReceipt, StopPayload, StopReceipt } from '../../shared/chat'
import type { PiChatSessionService, PiChatEventSubscriber, PiChatEventStreamResult } from '../http/routes/piChat'
import type { PiSessionCreateInit, PiSessionRequestContext } from './piSessionIdentity'
import type { PiAgentPromptInput, PiAgentSessionAdapter } from './PiAgentSessionAdapter'
import { buildPiChatQueuedFollowUps, buildPiChatSnapshot } from './piChatSnapshot'
import { PiChatEventMapper } from './piChatEvents'
import { PiChatReplayBuffer } from './piChatReplayBuffer'
import { followUpSelector, hasFollowUpSelector, PiChatMessageMetadataReconciler } from './piChatMessageMetadataReconciler'

type PiNativeHarness = AgentHarness & {
  getPiSessionAdapter?: (input: SendMessageInput, ctx: RunContext) => Promise<PiAgentSessionAdapter>
}

interface LiveSessionChannel {
  buffer: PiChatReplayBuffer
  adapter: PiAgentSessionAdapter
  unsubscribe: () => void
  activeTurnId?: string
  messageTurnIds: Map<string, string>
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
  private readonly messageMetadata = new PiChatMessageMetadataReconciler()
  private readonly activePromptRuns = new Map<string, Promise<void>>()

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
    this.messageMetadata.clearSession(sessionId)
    await this.sessionStore.delete(toSessionCtx(ctx), sessionId)
  }

  async readState(ctx: PiSessionRequestContext, sessionId: string) {
    const adapter = await this.getAdapter(ctx, sessionId, '')
    const channel = this.channels.get(sessionId)
    return this.messageMetadata.enrichSnapshot(sessionId, buildPiChatSnapshot(adapter, {
      seq: channel?.buffer.latestSeq ?? 0,
      sessionId,
      activeTurnId: channel?.activeTurnId,
      messageTurnIds: channel?.messageTurnIds,
    }))
  }

  async subscribe(ctx: PiSessionRequestContext, sessionId: string, cursor: number, subscriber: PiChatEventSubscriber): Promise<PiChatEventStreamResult> {
    const channel = await this.getChannel(ctx, sessionId)
    const result = channel.buffer.subscribe(cursor, subscriber)
    if (result.type !== 'ok') return result
    return { type: 'ok', unsubscribe: result.unsubscribe }
  }

  async prompt(ctx: PiSessionRequestContext, sessionId: string, payload: PromptPayload): Promise<PromptReceipt> {
    const adapter = await this.getAdapter(ctx, sessionId, payload)
    await this.ensureChannel(ctx, sessionId, adapter)
    this.messageMetadata.recordPrompt(sessionId, payload)
    try {
      await this.runPrompt(sessionId, adapter, toPiPromptInput(payload))
    } catch (err) {
      this.messageMetadata.removePrompt(sessionId, { clientNonce: payload.clientNonce })
      throw err
    }
    return { accepted: true, cursor: this.channels.get(sessionId)?.buffer.latestSeq ?? 0, clientNonce: payload.clientNonce }
  }

  async followUp(ctx: PiSessionRequestContext, sessionId: string, payload: FollowUpPayload): Promise<FollowUpReceipt> {
    const adapter = await this.getAdapter(ctx, sessionId, payload.message)
    await this.ensureChannel(ctx, sessionId, adapter)
    this.messageMetadata.recordFollowUp(sessionId, payload)
    try {
      if (this.harness.followUp) {
        await this.harness.followUp(sessionId, payload.message, undefined, payload.displayMessage ?? payload.message, { clientNonce: payload.clientNonce, clientSeq: payload.clientSeq })
      } else {
        await adapter.followUp(payload.message)
      }
    } catch (err) {
      this.messageMetadata.removeFollowUp(sessionId, payload)
      throw err
    }
    return { accepted: true, queued: true, cursor: this.channels.get(sessionId)?.buffer.latestSeq ?? 0, clientNonce: payload.clientNonce, clientSeq: payload.clientSeq }
  }

  async clearQueue(ctx: PiSessionRequestContext, sessionId: string, payload: QueueClearPayload): Promise<QueueClearReceipt> {
    const adapter = await this.getAdapter(ctx, sessionId, '')
    if (hasFollowUpSelector(payload)) {
      if (!this.harness.clearFollowUp) {
        return { accepted: true, cursor: this.channels.get(sessionId)?.buffer.latestSeq ?? 0, cleared: 0 }
      }
      const before = adapter.readSnapshot().followUpMessages.length
      this.harness.clearFollowUp(sessionId, payload)
      const after = adapter.readSnapshot().followUpMessages.length
      if (after < before) this.messageMetadata.removeFollowUp(sessionId, payload)
      return { accepted: true, cursor: this.channels.get(sessionId)?.buffer.latestSeq ?? 0, cleared: Math.max(0, before - after) }
    }
    const clearedQueue = this.clearAllFollowUps(adapter, sessionId)
    return { accepted: true, cursor: this.channels.get(sessionId)?.buffer.latestSeq ?? 0, cleared: clearedQueue.length }
  }

  async interrupt(ctx: PiSessionRequestContext, sessionId: string, _payload: InterruptPayload): Promise<{ accepted: true; cursor: number }> {
    const adapter = await this.getAdapter(ctx, sessionId, '')
    const snapshot = adapter.readSnapshot()
    const wasActive = snapshot.isStreaming || snapshot.isRetrying
    const nextFollowUp = wasActive ? this.nextFollowUpForInterrupt(sessionId, adapter) : undefined
    const activeRun = this.activePromptRuns.get(sessionId)
    adapter.abortRetry?.()
    if (wasActive) await adapter.abort()
    await activeRun?.catch(() => {})
    if (nextFollowUp) await this.autoPostInterruptedFollowUp(sessionId, adapter, nextFollowUp)
    return { accepted: true, cursor: this.channels.get(sessionId)?.buffer.latestSeq ?? 0 }
  }

  async stop(ctx: PiSessionRequestContext, sessionId: string, _payload: StopPayload): Promise<StopReceipt> {
    const adapter = await this.getAdapter(ctx, sessionId, '')
    const clearedQueue = this.clearAllFollowUps(adapter, sessionId)
    await adapter.abort()
    return { accepted: true, stopped: true, cursor: this.channels.get(sessionId)?.buffer.latestSeq ?? 0, clearedQueue: buildPiChatQueuedFollowUps(sessionId, clearedQueue) }
  }

  private clearAllFollowUps(adapter: PiAgentSessionAdapter, sessionId: string): string[] {
    if (!this.harness.clearFollowUp) {
      const cleared = adapter.clearQueue().followUp
      this.messageMetadata.clearFollowUps(sessionId)
      return cleared
    }
    const before = [...adapter.readSnapshot().followUpMessages]
    this.harness.clearFollowUp(sessionId)
    const after = adapter.readSnapshot().followUpMessages
    this.messageMetadata.syncFromTexts(sessionId, after)
    return removedFollowUps(before, after)
  }

  private nextFollowUpForInterrupt(sessionId: string, adapter: PiAgentSessionAdapter): QueuedUserMessage | undefined {
    const followUps = this.messageMetadata.enrichQueuedFollowUps(
      sessionId,
      buildPiChatQueuedFollowUps(sessionId, adapter.readSnapshot().followUpMessages),
    )
    return followUps[0]
  }

  private async autoPostInterruptedFollowUp(
    sessionId: string,
    adapter: PiAgentSessionAdapter,
    followUp: QueuedUserMessage,
  ): Promise<void> {
    const metadata = this.messageMetadata.findFollowUpForQueueItem(sessionId, followUp)
    this.messageMetadata.recordConsumingFollowUp(sessionId, followUp, metadata?.serverText)
    if (adapter.continueQueuedFollowUp) {
      await this.trackActiveRun(sessionId, adapter.continueQueuedFollowUp())
      return
    }
    if (!this.canClearAutoPostedFollowUpForFallback(adapter, followUp)) {
      throw new AutoPostFollowUpError('Cannot auto-post queued follow-up because this runtime cannot safely remove only the consumed queued item.')
    }
    await this.runPrompt(sessionId, adapter, metadata?.serverText ?? followUp.displayText)
    this.clearAutoPostedFollowUpForFallback(sessionId, adapter, followUp)
  }

  private async runPrompt(sessionId: string, adapter: PiAgentSessionAdapter, input: PiAgentPromptInput): Promise<void> {
    await this.trackActiveRun(sessionId, adapter.prompt(input))
  }

  private async trackActiveRun(sessionId: string, run: Promise<void>): Promise<void> {
    this.activePromptRuns.set(sessionId, run)
    try {
      await run
    } finally {
      if (this.activePromptRuns.get(sessionId) === run) this.activePromptRuns.delete(sessionId)
    }
  }

  private clearAutoPostedFollowUpForFallback(
    sessionId: string,
    adapter: PiAgentSessionAdapter,
    followUp: QueuedUserMessage,
  ): boolean {
    if (this.harness.clearFollowUp && hasFollowUpSelector(followUp)) {
      const selector = followUpSelector(followUp)
      this.harness.clearFollowUp(sessionId, selector)
      return true
    }
    if (adapter.readSnapshot().followUpMessages.length <= 1) {
      this.clearAllFollowUps(adapter, sessionId)
      return true
    }
    return false
  }

  private canClearAutoPostedFollowUpForFallback(adapter: PiAgentSessionAdapter, followUp: QueuedUserMessage): boolean {
    return Boolean(this.harness.clearFollowUp && hasFollowUpSelector(followUp)) || adapter.readSnapshot().followUpMessages.length <= 1
  }

  private async getAdapter(ctx: PiSessionRequestContext, sessionId: string, input: string | PromptPayload): Promise<PiAgentSessionAdapter> {
    if (!this.harness.getPiSessionAdapter) throw new Error('pi-native harness adapter unavailable')
    const message = typeof input === 'string' ? input : input.message
    const sendInput: SendMessageInput = {
      sessionId,
      message,
      ...(typeof input !== 'string' && input.model ? { model: input.model } : {}),
      ...(typeof input !== 'string' && input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
      ...(typeof input !== 'string' && input.attachments ? { attachments: input.attachments } : {}),
    }
    return this.harness.getPiSessionAdapter(sendInput, {
      abortSignal: new AbortController().signal,
      workdir: this.workdir,
      userId: ctx.authSubject,
    })
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
    const mapper = new PiChatEventMapper({ sessionId, initialSeq: buffer.latestSeq })
    const channel: LiveSessionChannel = { buffer, adapter, unsubscribe: () => {}, messageTurnIds: new Map() }
    const unsubscribe = adapter.subscribe((event) => {
      for (const mapped of mapper.map(event)) {
        const enriched = this.messageMetadata.enrichEvent(sessionId, mapped)
        if (enriched.type === 'agent-start') channel.activeTurnId = enriched.turnId
        if (enriched.type === 'message-start' && channel.activeTurnId) {
          channel.messageTurnIds.set(enriched.messageId, channel.activeTurnId)
        }
        if (enriched.type === 'message-end' && channel.activeTurnId) {
          channel.messageTurnIds.set(enriched.messageId, channel.activeTurnId)
          channel.messageTurnIds.set(enriched.final.id, channel.activeTurnId)
        }
        if (enriched.type === 'agent-end' && channel.activeTurnId === enriched.turnId) channel.activeTurnId = undefined
        this.messageMetadata.consumeEvent(sessionId, enriched)
        buffer.publish(enriched)
      }
    })
    channel.unsubscribe = unsubscribe
    this.channels.set(sessionId, channel)
    return channel
  }

}

class AutoPostFollowUpError extends Error {}

function toPiPromptInput(payload: PromptPayload): PiAgentPromptInput {
  const images = promptImagesFromAttachments(payload.attachments)
  if (images.length === 0) return payload.message
  return { text: payload.message, options: { images } }
}

function promptImagesFromAttachments(attachments: PromptPayload['attachments']): Array<{ type: 'image'; mimeType: string; data: string }> {
  const images: Array<{ type: 'image'; mimeType: string; data: string }> = []
  for (const attachment of attachments ?? []) {
    const match = attachment.url.match(/^data:(image\/[^;]+);base64,(.+)$/)
    if (!match) continue
    const [, mimeType, data] = match
    images.push({ type: 'image', mimeType, data })
  }
  return images
}

function removedFollowUps(before: readonly string[], after: readonly string[]): string[] {
  const afterCounts = new Map<string, number>()
  for (const text of after) afterCounts.set(text, (afterCounts.get(text) ?? 0) + 1)
  const removed: string[] = []
  for (const text of before) {
    const count = afterCounts.get(text) ?? 0
    if (count > 0) {
      afterCounts.set(text, count - 1)
      continue
    }
    removed.push(text)
  }
  return removed
}

function toSessionCtx(ctx: PiSessionRequestContext) {
  return { workspaceId: ctx.workspaceId, userId: ctx.authSubject }
}
