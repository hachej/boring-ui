import type { AgentHarness, RunContext, SendMessageInput } from '../../shared/harness'
import type { SessionListOptions, SessionStore } from '../../shared/session'
import type { BoringChatMessage, BoringChatPart, ChatError, FollowUpPayload, FollowUpReceipt, InterruptPayload, PiChatEvent, PiChatSnapshot, PromptPayload, PromptReceipt, QueuedUserMessage, QueueClearPayload, QueueClearReceipt, StopPayload, StopReceipt } from '../../shared/chat'
import { ErrorCode } from '../../shared/error-codes'
import type { PiChatSessionService, PiChatEventSubscriber, PiChatEventStreamResult } from '../http/routes/piChat'
import type { PiSessionCreateInit, PiSessionRequestContext } from './piSessionIdentity'
import type { PiAgentPromptInput, PiAgentSessionAdapter } from './PiAgentSessionAdapter'
import { buildPiChatQueuedFollowUps, buildPiChatSnapshot } from './piChatSnapshot'
import { PiChatEventMapper } from './piChatEvents'
import { PiChatReplayBuffer } from './piChatReplayBuffer'
import { followUpSelector, hasFollowUpSelector, PiChatMessageMetadataReconciler } from './piChatMessageMetadataReconciler'
import { extractToolUiMetadata, sanitizeToolUiMetadata } from '../../shared/tool-ui'

type PiNativeHarness = AgentHarness & {
  getPiSessionAdapter?: (input: SendMessageInput, ctx: RunContext) => Promise<PiAgentSessionAdapter>
  hasPiSession?: (sessionId: string) => boolean
}

interface LiveSessionChannel {
  buffer: PiChatReplayBuffer
  adapter: PiAgentSessionAdapter
  unsubscribe: () => void
  mapper: PiChatEventMapper
  activeTurnId?: string
  messageTurnIds: Map<string, string>
}

interface SyntheticPromptFailure {
  message: BoringChatMessage
  error: ChatError
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
  private readonly syntheticPromptFailures = new Map<string, SyntheticPromptFailure[]>()
  private readonly activeSyntheticPromptErrors = new Map<string, ChatError>()

  constructor(options: HarnessPiChatServiceOptions) {
    this.harness = options.harness as PiNativeHarness
    this.sessionStore = options.sessionStore
    this.workdir = options.workdir
  }

  async listSessions(ctx: PiSessionRequestContext, options?: SessionListOptions) {
    return this.sessionStore.list(toSessionCtx(ctx), options)
  }

  async createSession(ctx: PiSessionRequestContext, init?: PiSessionCreateInit) {
    return this.sessionStore.create(toSessionCtx(ctx), init)
  }

  async deleteSession(ctx: PiSessionRequestContext, sessionId: string) {
    this.channels.get(sessionId)?.unsubscribe()
    this.channels.delete(sessionId)
    this.messageMetadata.clearSession(sessionId)
    this.syntheticPromptFailures.delete(sessionId)
    this.activeSyntheticPromptErrors.delete(sessionId)
    await this.sessionStore.delete(toSessionCtx(ctx), sessionId)
  }

  async readState(ctx: PiSessionRequestContext, sessionId: string) {
    const channel = this.channels.get(sessionId)
    if (!channel && !this.harnessMayHaveLiveSession(sessionId)) {
      const persisted = await this.readPersistedState(ctx, sessionId)
      if (persisted) return persisted
    }

    const adapter = await this.getAdapter(ctx, sessionId, '')
    const snapshot = this.messageMetadata.enrichSnapshot(sessionId, buildPiChatSnapshot(adapter, {
      seq: channel?.buffer.latestSeq ?? 0,
      sessionId,
      activeTurnId: channel?.activeTurnId,
      messageTurnIds: channel?.messageTurnIds,
    }))
    return this.enrichSyntheticPromptFailures(sessionId, snapshot)
  }

  private harnessMayHaveLiveSession(sessionId: string): boolean {
    return typeof this.harness.hasPiSession === 'function'
      ? this.harness.hasPiSession(sessionId)
      : true
  }

  private async readPersistedState(ctx: PiSessionRequestContext, sessionId: string): Promise<PiChatSnapshot | null> {
    try {
      const detail = await this.sessionStore.load(toSessionCtx(ctx), sessionId)
      return {
        protocolVersion: 1,
        sessionId: detail.id,
        seq: 0,
        status: 'idle',
        messages: detail.messages
          .map((message, index) => persistedUiMessageToBoringChatMessage(sessionId, message, index))
          .filter((message): message is BoringChatMessage => message !== null),
        queue: { followUps: [] },
        followUpMode: 'one-at-a-time',
      }
    } catch {
      return null
    }
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
    const channel = this.channels.get(sessionId)
    const receiptCursor = nextPromptReceiptCursor(channel)
    try {
      const run = this.trackActiveRun(sessionId, adapter.prompt(toPiPromptInput(payload)))
      run.catch((error) => {
        if (!this.messageMetadata.hasPrompt(sessionId, { clientNonce: payload.clientNonce, displayText: payload.displayMessage ?? payload.message })) return
        this.publishPromptRunError(sessionId, channel, payload, error)
      })
    } catch (err) {
      this.messageMetadata.removePrompt(sessionId, { clientNonce: payload.clientNonce })
      throw err
    }
    return { accepted: true, cursor: receiptCursor, clientNonce: payload.clientNonce }
  }

  async followUp(ctx: PiSessionRequestContext, sessionId: string, payload: FollowUpPayload): Promise<FollowUpReceipt> {
    const adapter = await this.getAdapter(ctx, sessionId, payload.message)
    await this.ensureChannel(ctx, sessionId, adapter)
    this.messageMetadata.recordFollowUp(sessionId, payload)
    try {
      await adapter.followUp(payload.message, {
        displayText: payload.displayMessage ?? payload.message,
        clientNonce: payload.clientNonce,
        clientSeq: payload.clientSeq,
      })
    } catch (err) {
      this.messageMetadata.removeFollowUp(sessionId, payload)
      throw err
    }
    return { accepted: true, queued: true, cursor: this.channels.get(sessionId)?.buffer.latestSeq ?? 0, clientNonce: payload.clientNonce, clientSeq: payload.clientSeq }
  }

  async clearQueue(ctx: PiSessionRequestContext, sessionId: string, payload: QueueClearPayload): Promise<QueueClearReceipt> {
    const adapter = await this.getAdapter(ctx, sessionId, '')
    if (hasFollowUpSelector(payload)) {
      const before = adapter.readSnapshot().followUpMessages.length
      adapter.clearFollowUp(payload)
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
    const before = [...adapter.readSnapshot().followUpMessages]
    adapter.clearFollowUp()
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
    if (hasFollowUpSelector(followUp)) {
      adapter.clearFollowUp(followUpSelector(followUp))
      return true
    }
    if (adapter.readSnapshot().followUpMessages.length <= 1) {
      this.clearAllFollowUps(adapter, sessionId)
      return true
    }
    return false
  }

  private canClearAutoPostedFollowUpForFallback(adapter: PiAgentSessionAdapter, followUp: QueuedUserMessage): boolean {
    return hasFollowUpSelector(followUp) || adapter.readSnapshot().followUpMessages.length <= 1
  }

  private enrichSyntheticPromptFailures(sessionId: string, snapshot: PiChatSnapshot): PiChatSnapshot {
    const failures = this.syntheticPromptFailures.get(sessionId)
    if (!failures || failures.length === 0) return snapshot
    const activeError = this.activeSyntheticPromptErrors.get(sessionId)
    return {
      ...snapshot,
      status: activeError ? 'error' : snapshot.status,
      error: activeError ?? snapshot.error,
      messages: mergeSyntheticMessages(snapshot.messages, failures.map((failure) => failure.message)),
    }
  }

  private publishChannelEvent(sessionId: string, channel: LiveSessionChannel, event: PiChatEvent): void {
    if (event.type === 'agent-start') {
      channel.activeTurnId = event.turnId
      this.activeSyntheticPromptErrors.delete(sessionId)
    }
    if (event.type === 'message-start' && channel.activeTurnId) {
      channel.messageTurnIds.set(event.messageId, channel.activeTurnId)
    }
    if (event.type === 'message-end' && channel.activeTurnId) {
      channel.messageTurnIds.set(event.messageId, channel.activeTurnId)
      channel.messageTurnIds.set(event.final.id, channel.activeTurnId)
    }
    if (event.type === 'agent-end' && channel.activeTurnId === event.turnId) channel.activeTurnId = undefined
    this.messageMetadata.consumeEvent(sessionId, event)
    channel.buffer.publish(event)
  }

  private publishPromptRunError(sessionId: string, channel: LiveSessionChannel | undefined, payload: PromptPayload, error: unknown): void {
    if (!channel) return
    const createdAt = new Date().toISOString()
    const messageId = `prompt-error:${payload.clientNonce}:user`
    const message = promptPayloadMessage(payload, messageId, createdAt, channel.activeTurnId)
    this.publishChannelEvent(sessionId, channel, channel.mapper.mapSynthetic({
      type: 'message-start',
      messageId,
      role: 'user',
      clientNonce: payload.clientNonce,
      text: payload.displayMessage ?? payload.message,
      files: promptPayloadFileParts(payload, messageId),
      createdAt,
    }))
    const promptError: ChatError = {
      code: ErrorCode.enum.INTERNAL_ERROR,
      message: error instanceof Error && error.message ? error.message : 'Prompt failed before the agent run completed.',
      retryable: false,
    }
    const errorEvent = channel.mapper.mapSynthetic({
      type: 'error',
      turnId: channel.activeTurnId,
      retryable: false,
      error: promptError,
    })
    this.publishChannelEvent(sessionId, channel, errorEvent)
    const failures = this.syntheticPromptFailures.get(sessionId) ?? []
    failures.push({ message, error: promptError })
    this.syntheticPromptFailures.set(sessionId, failures)
    this.activeSyntheticPromptErrors.set(sessionId, promptError)
    channel.activeTurnId = undefined
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
    const channel: LiveSessionChannel = { buffer, adapter, unsubscribe: () => {}, mapper, messageTurnIds: new Map() }
    const unsubscribe = adapter.subscribe((event) => {
      for (const mapped of mapper.map(event)) {
        const enriched = this.messageMetadata.enrichEvent(sessionId, mapped)
        this.publishChannelEvent(sessionId, channel, enriched)
      }
    })
    channel.unsubscribe = unsubscribe
    this.channels.set(sessionId, channel)
    return channel
  }

}

class AutoPostFollowUpError extends Error {}

function nextPromptReceiptCursor(channel: LiveSessionChannel | undefined): number {
  return (channel?.buffer.latestSeq ?? 0) + 1
}

function promptPayloadFileParts(payload: PromptPayload, messageId: string): BoringChatPart[] | undefined {
  if (!payload.attachments || payload.attachments.length === 0) return undefined
  return payload.attachments.map((attachment, index) => ({
    type: 'file',
    id: `${messageId}:file:${index}`,
    filename: attachment.filename,
    mediaType: attachment.mediaType,
    url: attachment.url,
  }))
}

function promptPayloadMessage(payload: PromptPayload, messageId: string, createdAt: string, turnId: string | undefined): BoringChatMessage {
  const displayText = payload.displayMessage ?? payload.message
  return {
    id: messageId,
    role: 'user',
    status: 'done',
    clientNonce: payload.clientNonce,
    createdAt,
    turnId,
    parts: [
      ...(displayText ? [{ type: 'text' as const, id: `${messageId}:text:0`, text: displayText }] : []),
      ...(promptPayloadFileParts(payload, messageId) ?? []),
    ],
  }
}

function persistedUiMessageToBoringChatMessage(sessionId: string, rawMessage: unknown, index: number): BoringChatMessage | null {
  if (!isRecord(rawMessage)) return null
  const role = rawMessage.role
  if (role !== 'user' && role !== 'assistant' && role !== 'system') return null
  const id = optionalString(rawMessage.id) ?? `persisted:${sessionId}:${index}:${role}`
  const parts = Array.isArray(rawMessage.parts)
    ? rawMessage.parts.flatMap((part, partIndex) => persistedUiPartToBoringChatPart(part, id, partIndex))
    : []
  return {
    id,
    role,
    status: 'done',
    createdAt: optionalString(rawMessage.createdAt),
    piEntryId: optionalString(rawMessage.piEntryId),
    turnId: optionalString(rawMessage.turnId),
    parts,
  }
}

function persistedUiPartToBoringChatPart(part: unknown, messageId: string, index: number): BoringChatPart[] {
  if (!isRecord(part)) return []
  if (part.type === 'text' && typeof part.text === 'string') {
    return [{ type: 'text', id: optionalString(part.id) ?? `${messageId}:text:${index}`, text: part.text }]
  }
  if (part.type === 'reasoning' && typeof part.text === 'string') {
    return [{
      type: 'reasoning',
      id: optionalString(part.id) ?? `${messageId}:reasoning:${index}`,
      text: part.text,
      state: part.state === 'streaming' ? 'streaming' : 'done',
    }]
  }
  if (part.type === 'file') {
    return [{
      type: 'file',
      id: optionalString(part.id) ?? `${messageId}:file:${index}`,
      filename: optionalString(part.filename),
      mediaType: optionalString(part.mediaType),
      url: optionalString(part.url),
    }]
  }
  if (part.type === 'notice') {
    const level = part.level === 'warning' || part.level === 'error' ? part.level : 'info'
    return [{
      type: 'notice',
      id: optionalString(part.id) ?? `${messageId}:notice:${index}`,
      level,
      text: optionalString(part.text) ?? '',
    }]
  }
  if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
    const toolName = optionalString(part.toolName) ?? (part.type.slice('tool-'.length) || 'unknown')
    const ui = sanitizeToolUiMetadata(part.ui) ?? extractToolUiMetadata(part.output)
    return [{
      type: 'tool-call',
      id: optionalString(part.toolCallId) ?? optionalString(part.id) ?? `${messageId}:tool:${index}`,
      toolName,
      input: part.input,
      state: persistedToolState(part.state),
      output: part.output,
      errorText: optionalString(part.errorText),
      ...(ui ? { ui } : {}),
    }]
  }
  return []
}

function persistedToolState(value: unknown): Extract<BoringChatPart, { type: 'tool-call' }>['state'] {
  switch (value) {
    case 'input-streaming':
    case 'input-available':
    case 'output-available':
    case 'output-error':
    case 'aborted':
      return value
    default:
      return 'input-available'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function mergeSyntheticMessages(messages: BoringChatMessage[], syntheticMessages: BoringChatMessage[]): BoringChatMessage[] {
  const existingIds = new Set(messages.map((message) => message.id))
  const merged = [...messages]
  for (const synthetic of syntheticMessages) {
    if (existingIds.has(synthetic.id)) continue
    const syntheticTime = messageTime(synthetic)
    const insertAt = syntheticTime === undefined ? -1 : merged.findIndex((message) => {
      const timestamp = messageTime(message)
      return timestamp !== undefined && timestamp > syntheticTime
    })
    if (insertAt < 0) merged.push(synthetic)
    else merged.splice(insertAt, 0, synthetic)
  }
  return merged
}

function messageTime(message: BoringChatMessage): number | undefined {
  if (!message.createdAt) return undefined
  const timestamp = Date.parse(message.createdAt)
  return Number.isFinite(timestamp) ? timestamp : undefined
}

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
