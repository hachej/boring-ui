import type { AgentHarness, RunContext, AgentSendInput } from '../../shared/harness'
import type { SessionCtx, SessionListOptions, SessionStore, SessionSummary } from '../../shared/session'
import type { Workspace } from '../../shared/workspace'
import type { BoringChatMessage, BoringChatPart, ChatError, FollowUpPayload, FollowUpReceipt, InterruptPayload, PiChatEvent, PiChatSnapshot, PromptPayload, PromptReceipt, QueuedUserMessage, QueueClearPayload, QueueClearReceipt, StopPayload, StopReceipt } from '../../shared/chat'
import { sessionStreamPath, type AgentEvent } from '../../shared/events'
import { ErrorCode } from '../../shared/error-codes'
import { formatOffset, parseOffset, type EventStreamIdempotencyKey, type EventStreamMeta, type EventStreamReplacementEvent, type EventStreamStore } from '../events/eventStreamStore'
import type {
  PiChatEventStreamResult,
  PiChatEventSubscriber,
  PiChatSessionService,
  PiSessionCreateInit,
  PiSessionRequestContext,
} from '../../core/piChatSessionService'
import type { PiAgentPromptInput, PiAgentSessionAdapter } from './PiAgentSessionAdapter'
import { buildPiChatQueuedFollowUps, buildPiChatSnapshot } from './piChatSnapshot'
import { PiChatEventMapper } from './piChatEvents'
import { PiChatReplayBuffer } from './piChatReplayBuffer'
import { followUpSelector, hasFollowUpSelector, PiChatMessageMetadataReconciler } from './piChatMessageMetadataReconciler'
import { buildPiChatHistory } from './piChatHistory'
import { PiChatMeteringCoordinator, type AgentMeteringSink, type MeteringErrorLogger } from './metering'
import { HarnessPiChatServiceLifecycle } from './piChatServiceLifecycle'
import { normalizeSessionTitle } from '../sessionTitle'

type PiNativeHarness = AgentHarness & {
  browserDraftNative?: boolean
  getPiSessionAdapter?: (input: AgentSendInput, ctx: RunContext) => Promise<PiAgentSessionAdapter>
  hasPiSession?: (sessionId: string, ctx?: SessionCtx) => boolean
  renameLivePendingPiSession?: (sessionId: string, ctx: SessionCtx, title: string) => boolean | Promise<boolean>
}

const MAX_PROMPT_IMAGE_BYTES = 10 * 1024 * 1024
const PROMPT_IMAGE_EXTENSIONS = new Set(['.avif', '.gif', '.jpg', '.jpeg', '.png', '.webp'])
const BROWSER_DRAFT_ADMISSION_TTL_MS = 10 * 60 * 1000
const MAX_DEFERRED_DURABLE_EVENTS = 10_000
const SAFE_BROWSER_DRAFT_NATIVE_ID = /^brdraft_[A-Za-z0-9_-]{16,96}$/
const SAFE_BROWSER_DRAFT_REQUEST_ID = /^brreq_[A-Za-z0-9_-]{16,96}$/

/** Pi session stores additionally expose the raw persisted message entries so
 * the cold-load path can run them through the same buildPiChatHistory mapping
 * as the live event path. */
type PiSessionStoreLike = SessionStore & {
  loadEntries?: (ctx: SessionCtx, sessionId: string) => Promise<{ id: string; messages: unknown[] }>
  recordLivePendingTitle?: (ctx: SessionCtx, sessionId: string, title: string) => Promise<SessionSummary>
  hasSessionId?: (sessionId: string) => Promise<boolean>
}

interface LiveSessionChannel {
  sessionKey: string
  sessionCtx: SessionCtx
  streamPath: string
  buffer: PiChatReplayBuffer
  adapter: PiAgentSessionAdapter
  unsubscribe: () => void
  mapper: PiChatEventMapper
  publishQueue: Promise<void>
  closed: Promise<void>
  resolveClosed: () => void
  rejectClosed: (error: unknown) => void
  activeTurnId?: string
  messageTurnIds: Map<string, string>
  capabilities: { materialized: boolean; canRename: boolean }
  durableEventsEnabled: boolean
  durableEventBacklog: PiChatEvent[]
  durableEnableInFlight?: Promise<void>
}

interface SyntheticPromptFailure {
  message: BoringChatMessage
  error: ChatError
}

interface BrowserDraftPromptAdmission {
  ownerKey: string
  requestId: string
  fingerprint: string
  receipt: Promise<PromptReceipt>
  expired?: boolean
  evictionTimer?: ReturnType<typeof setTimeout>
}

export interface HarnessPiChatServiceOptions {
  harness: AgentHarness
  sessionStore: SessionStore
  workdir: string
  workspace?: Workspace
  eventStore?: EventStreamStore
  /**
   * Optional host billing sink. When set, accepted prompts/follow-ups reserve
   * before execution (a rejecting sink blocks the request), native assistant
   * usage is recorded per message, and every run settles or releases from
   * native terminal lifecycle.
   */
  metering?: AgentMeteringSink
  /** Receives non-fatal metering pipeline failures (default: console.warn). */
  meteringLogger?: MeteringErrorLogger
}

export class HarnessPiChatService implements PiChatSessionService {
  private readonly harness: PiNativeHarness
  private readonly sessionStore: PiSessionStoreLike
  private readonly workdir: string
  private readonly workspace?: Workspace
  private readonly eventStore?: EventStreamStore
  private readonly channels = new Map<string, LiveSessionChannel>()
  // Coalesce cold callers so only one adapter subscription owns the channel.
  private readonly channelCreations = new Map<string, Promise<LiveSessionChannel>>()
  private readonly durableStreamMigrations = new Map<string, Promise<void>>()
  private readonly messageMetadata = new PiChatMessageMetadataReconciler()
  private readonly activePromptRuns = new Map<string, Promise<void>>()
  private readonly syntheticPromptFailures = new Map<string, SyntheticPromptFailure[]>()
  private readonly activeSyntheticPromptErrors = new Map<string, ChatError>()
  private readonly browserDraftPromptAdmissions = new Map<string, BrowserDraftPromptAdmission>()
  private readonly lifecycle = new HarnessPiChatServiceLifecycle()
  private readonly metering?: PiChatMeteringCoordinator
  private disposePromise?: Promise<void>

  constructor(options: HarnessPiChatServiceOptions) {
    this.harness = options.harness as PiNativeHarness
    this.sessionStore = options.sessionStore
    this.workdir = options.workdir
    this.workspace = options.workspace
    this.eventStore = options.eventStore
    this.metering = options.metering
      ? new PiChatMeteringCoordinator(options.metering, options.meteringLogger)
      : undefined
  }

  /** Test/diagnostic hook: resolves once queued metering sink calls settle. */
  async flushMetering(): Promise<void> {
    return this.lifecycle.run(async () => this.metering?.flush())
  }

  dispose(): Promise<void> {
    this.lifecycle.beginClosing()
    this.disposePromise ??= this.disposeService()
    return this.disposePromise
  }

  private async disposeService(): Promise<void> {
    await this.lifecycle.drain()
    await Promise.allSettled([...this.channelCreations.values()])
    const errors: unknown[] = []
    errors.push(...this.lifecycle.takeCleanupErrors())
    const channels = [...this.channels.values()]
    const abortChannels: LiveSessionChannel[] = []
    for (const channel of channels) {
      for (const cleanup of [() => channel.adapter.abortRetry?.(), () => channel.adapter.clearFollowUp()]) {
        try { cleanup() } catch (error) { errors.push(error) }
      }
      try {
        const snapshot = channel.adapter.readSnapshot()
        if (snapshot.isStreaming || snapshot.isRetrying || this.activePromptRuns.has(channel.sessionKey)) {
          abortChannels.push(channel)
        }
      } catch (error) {
        errors.push(error)
        abortChannels.push(channel)
      }
    }
    const aborts = await Promise.allSettled(abortChannels.map(async (channel) => channel.adapter.abort()))
    errors.push(...rejectedReasons(aborts))
    await Promise.allSettled([...this.activePromptRuns.values()])
    for (const channel of channels) {
      try {
        channel.unsubscribe()
      } catch (error) {
        errors.push(error)
      }
    }
    const publishes = await Promise.allSettled(channels.map((channel) => channel.publishQueue))
    errors.push(...rejectedReasons(publishes))
    for (const channel of channels) {
      channel.buffer.clearSubscribers()
      channel.resolveClosed()
      this.messageMetadata.clearSession(channel.sessionKey)
      try {
        this.metering?.releaseSession(channel.sessionKey)
      } catch (error) {
        errors.push(error)
      }
    }
    try {
      await this.metering?.flush()
    } catch (error) {
      errors.push(error)
    }
    this.channels.clear()
    this.channelCreations.clear()
    this.activePromptRuns.clear()
    this.syntheticPromptFailures.clear()
    this.activeSyntheticPromptErrors.clear()
    for (const admission of this.browserDraftPromptAdmissions.values()) {
      if (admission.evictionTimer) clearTimeout(admission.evictionTimer)
    }
    this.browserDraftPromptAdmissions.clear()
    if (errors.length > 0) throw errors[0]
  }

  async listSessions(ctx: PiSessionRequestContext, options?: SessionListOptions) {
    return this.lifecycle.run(() => this.sessionStore.list(toSessionCtx(ctx), options))
  }

  async createSession(ctx: PiSessionRequestContext, init?: PiSessionCreateInit): Promise<SessionSummary> {
    if (ctx.browserDraftNative === true) {
      throw browserDraftNativeCreateUnsupportedError()
    }
    if (ctx.requestId === 'agent-core' || (ctx.workspaceId && ctx.authSubject)) {
      return this.lifecycle.run(() => this.sessionStore.create(toSessionCtx(ctx), init))
    }
    throw Object.assign(new Error('server-created Pi sessions require authenticated owner context'), {
      statusCode: 401,
      code: ErrorCode.enum.UNAUTHORIZED,
      retryable: false,
    })
  }

  async renameSession(ctx: PiSessionRequestContext, sessionId: string, title: string) {
    return this.lifecycle.run(async () => {
      const sessionCtx = toSessionCtx(ctx)
      try {
        // Normalize before either writer observes the title: Pi's live
        // SessionManager and the restart-pending wrapper must receive the
        // exact same validated value.
        const normalizedTitle = normalizeSessionTitle(title)
        // Pi postpones creating its native JSONL until the first assistant
        // message. For authenticated non-browser-draft sessions with a live
        // Pi manager, queue the accepted title through Pi before the async
        // wrapper append so a materializing first turn cannot miss it.
        const canQueueLivePendingTitle = Boolean(ctx.authSubject) && !SAFE_BROWSER_DRAFT_NATIVE_ID.test(sessionId) && this.sessionStore.recordLivePendingTitle
        const queuedInLivePi = canQueueLivePendingTitle
          ? await this.harness.renameLivePendingPiSession?.(sessionId, sessionCtx, normalizedTitle) === true
          : false
        if (queuedInLivePi && this.sessionStore.recordLivePendingTitle) {
          const summary = await this.sessionStore.recordLivePendingTitle(sessionCtx, sessionId, normalizedTitle)
          return summary.title === normalizedTitle ? summary : { ...summary, title: normalizedTitle }
        }
        await this.assertSessionCanRename(ctx, sessionId)
        return await this.sessionStore.rename(sessionCtx, sessionId, normalizedTitle)
      } catch (error) {
        throw normalizeSessionAccessError(error, sessionId)
      }
    })
  }

  async deleteSession(ctx: PiSessionRequestContext, sessionId: string): Promise<void> {
    return this.lifecycle.run(() => this.deleteSessionBeforeDispose(ctx, sessionId))
  }

  private async deleteSessionBeforeDispose(ctx: PiSessionRequestContext, sessionId: string): Promise<void> {
    const sessionCtx = toSessionCtx(ctx)
    const sessionKey = sessionCacheKey(sessionId, sessionCtx)
    try {
      await this.sessionStore.load(sessionCtx, sessionId)
    } catch (error) {
      throw normalizeSessionAccessError(error, sessionId)
    }
    const channel = this.channels.get(sessionKey)
    if (channel) {
      // Keep the native listener through abort/run drain so terminal usage is metered.
      const activeRun = this.activePromptRuns.get(sessionKey)
      await channel.adapter.abort()
      await activeRun?.catch(() => {})
    }
    let teardownError: unknown
    if (channel) {
      try { channel.unsubscribe() } catch (error) { teardownError = error }
      try { await channel.publishQueue } catch (error) { teardownError ??= error }
      channel.buffer.clearSubscribers()
      channel.resolveClosed()
    }
    this.channels.delete(sessionKey)
    try { this.metering?.releaseSession(sessionKey) } catch (error) { teardownError ??= error }
    this.messageMetadata.clearSession(sessionKey)
    this.syntheticPromptFailures.delete(sessionKey)
    this.activeSyntheticPromptErrors.delete(sessionKey)
    try { await this.sessionStore.delete(sessionCtx, sessionId) } catch (error) { teardownError ??= error }
    if (teardownError) throw teardownError
  }

  async readState(ctx: PiSessionRequestContext, sessionId: string): Promise<PiChatSnapshot> {
    return this.lifecycle.run(() => this.readStateBeforeDispose(ctx, sessionId))
  }

  private async readStateBeforeDispose(ctx: PiSessionRequestContext, sessionId: string): Promise<PiChatSnapshot> {
    const sessionKey = this.sessionKey(ctx, sessionId)
    const channel = this.channels.get(sessionKey)
    if (!channel && !this.harnessMayHaveLiveSession(ctx, sessionId)) {
      const persisted = await this.readPersistedState(ctx, sessionId)
      if (persisted) return persisted
    }

    const adapter = await this.getAdapter(ctx, sessionId, '')
    const snapshot = this.messageMetadata.enrichSnapshot(sessionKey, buildPiChatSnapshot(adapter, {
      seq: channel?.buffer.latestSeq ?? 0,
      sessionId,
      activeTurnId: channel?.activeTurnId,
      messageTurnIds: channel?.messageTurnIds,
      capabilities: channel?.capabilities ?? { materialized: false, canRename: false },
    }))
    return this.enrichSyntheticPromptFailures(sessionKey, snapshot)
  }

  private harnessMayHaveLiveSession(ctx: PiSessionRequestContext, sessionId: string): boolean {
    return typeof this.harness.hasPiSession === 'function'
      ? this.harness.hasPiSession(sessionId, toSessionCtx(ctx))
      : true
  }

  private async readPersistedState(ctx: PiSessionRequestContext, sessionId: string): Promise<PiChatSnapshot | null> {
    if (!this.sessionStore.loadEntries) return null
    try {
      const sessionCtx = toSessionCtx(ctx)
      const [{ id, messages }, detail] = await Promise.all([
        this.sessionStore.loadEntries(sessionCtx, sessionId),
        this.sessionStore.load(sessionCtx, sessionId),
      ])
      const streamPath = sessionStreamPath(this.sessionKey(ctx, id))
      await this.ensureDurableStream(streamPath, legacySessionStreamPaths(id, sessionCtx))
      return {
        protocolVersion: 1,
        sessionId: id,
        seq: await this.readDurableLatestPiChatSeq(streamPath),
        status: 'idle',
        messages: buildPiChatHistory(messages, { sessionId: id }),
        queue: { followUps: [] },
        followUpMode: 'one-at-a-time',
        capabilities: { materialized: detail.materialized === true, canRename: detail.canRename === true },
      }
    } catch {
      return null
    }
  }

  async subscribe(ctx: PiSessionRequestContext, sessionId: string, cursor: number, subscriber: PiChatEventSubscriber): Promise<PiChatEventStreamResult> {
    return this.lifecycle.run(() => this.subscribeBeforeDispose(ctx, sessionId, cursor, subscriber))
  }

  private async subscribeBeforeDispose(ctx: PiSessionRequestContext, sessionId: string, cursor: number, subscriber: PiChatEventSubscriber): Promise<PiChatEventStreamResult> {
    const channel = await this.getChannel(ctx, sessionId)
    this.lifecycle.assertOpen()
    const result = channel.buffer.subscribe(cursor, subscriber)
    if (result.type !== 'ok') return result
    return { type: 'ok', unsubscribe: result.unsubscribe, closed: channel.closed }
  }

  async prompt(ctx: PiSessionRequestContext, sessionId: string, payload: PromptPayload): Promise<PromptReceipt> {
    return this.lifecycle.run(() => this.promptBeforeDispose(ctx, sessionId, payload))
  }

  private async promptBeforeDispose(ctx: PiSessionRequestContext, sessionId: string, payload: PromptPayload): Promise<PromptReceipt> {
    const browserDraft = this.validatedBrowserDraftSignal(sessionId, payload)
    if (!browserDraft) return this.acceptPrompt(ctx, sessionId, payload)

    this.assertTrustedBrowserDraftOwner(ctx)
    const ownerKey = this.sessionKey(ctx, sessionId)
    const key = browserDraftAdmissionKey(sessionId)
    const fingerprint = browserDraftPromptFingerprint(payload)
    const existing = this.browserDraftPromptAdmissions.get(key)
    if (existing) {
      if (existing.ownerKey !== ownerKey) throw browserDraftSessionCollisionError()
      if (existing.requestId !== browserDraft.requestId) throw browserDraftRequestConflictError()
      if (existing.fingerprint !== fingerprint) throw browserDraftRequestConflictError()
      if (existing.expired) throw browserDraftOutcomeUnknownError()
      return existing.receipt
    }
    if (browserDraft.attempted === true) {
      await this.assertBrowserDraftSessionAbsentForUnknownRetry(ctx, sessionId)
      throw browserDraftOutcomeUnknownError()
    }

    const receipt = (async () => {
      await this.assertBrowserDraftSessionUnusedForFirstSend(ctx, sessionId)
      return this.acceptPrompt(ctx, sessionId, payload, { authorize: false, deferDurableEventsUntilMaterialized: true })
    })()
    const admission: BrowserDraftPromptAdmission = { ownerKey, requestId: browserDraft.requestId, fingerprint, receipt }
    this.browserDraftPromptAdmissions.set(key, admission)
    try {
      const accepted = await receipt
      this.scheduleBrowserDraftAdmissionEviction(key, admission)
      return accepted
    } catch (error) {
      const current = this.browserDraftPromptAdmissions.get(key)
      if (current?.receipt === receipt) this.browserDraftPromptAdmissions.delete(key)
      throw error
    }
  }

  private async acceptPrompt(
    ctx: PiSessionRequestContext,
    sessionId: string,
    payload: PromptPayload,
    options?: { authorize?: boolean; deferDurableEventsUntilMaterialized?: boolean },
  ): Promise<PromptReceipt> {
    const sessionKey = this.sessionKey(ctx, sessionId)
    const adapter = await this.getAdapter(ctx, sessionId, payload, options)
    const channel = await this.ensureChannel(ctx, sessionId, adapter, {
      deferDurableEvents: options?.deferDurableEventsUntilMaterialized === true,
    })
    // Reservation is the dedup authority and must settle before model execution.
    const outcome = (await this.metering?.reservePrompt({
      workspaceId: ctx.workspaceId,
      userId: ctx.authSubject,
      userEmail: ctx.authEmail,
      userEmailVerified: ctx.authEmailVerified,
      sessionId,
      stateKey: sessionKey,
      clientNonce: payload.clientNonce,
      message: payload.message,
      model: adapter.currentModel?.() ?? payload.model,
    })) ?? 'created'
    if (outcome === 'duplicate') {
      return {
        accepted: true,
        cursor: this.channels.get(sessionKey)?.buffer.latestSeq ?? 0,
        clientNonce: payload.clientNonce,
        duplicate: true,
      }
    }
    if (outcome === 'cancelled') throw promptCancelledError()
    this.messageMetadata.recordPrompt(sessionKey, payload)
    const receiptCursor = nextPromptReceiptCursor(channel)
    try {
      const input = await toPiPromptInput(payload, this.workspace)
      this.lifecycle.assertOpen()
      const run = this.trackActiveRun(sessionKey, this.runPromptAndMaybeEnableDeferredDurability(
        ctx,
        sessionId,
        channel,
        adapter.prompt(input),
        options?.deferDurableEventsUntilMaterialized === true,
      ))
      run.catch((error) => {
        this.metering?.failPromptRun(sessionId, payload.clientNonce, sessionKey)
        if (!this.messageMetadata.hasPrompt(sessionKey, { clientNonce: payload.clientNonce, displayText: payload.displayMessage ?? payload.message })) return
        this.publishPromptRunError(sessionKey, sessionId, channel, payload, error)
      })
    } catch (err) {
      this.metering?.failPromptRun(sessionId, payload.clientNonce, sessionKey)
      this.messageMetadata.removePrompt(sessionKey, { clientNonce: payload.clientNonce })
      throw err
    }
    return { accepted: true, cursor: receiptCursor, clientNonce: payload.clientNonce }
  }

  async followUp(ctx: PiSessionRequestContext, sessionId: string, payload: FollowUpPayload): Promise<FollowUpReceipt> {
    return this.lifecycle.run(() => this.followUpBeforeDispose(ctx, sessionId, payload))
  }

  private async followUpBeforeDispose(ctx: PiSessionRequestContext, sessionId: string, payload: FollowUpPayload): Promise<FollowUpReceipt> {
    const sessionKey = this.sessionKey(ctx, sessionId)
    const adapter = await this.getAdapter(ctx, sessionId, payload.message)
    const channel = await this.ensureChannel(ctx, sessionId, adapter)
    // Reserve before enqueueing so duplicates cannot take a second hold.
    const outcome = (await this.metering?.reserveFollowUp({
      workspaceId: ctx.workspaceId,
      userId: ctx.authSubject,
      userEmail: ctx.authEmail,
      userEmailVerified: ctx.authEmailVerified,
      sessionId,
      stateKey: sessionKey,
      clientNonce: payload.clientNonce,
      clientSeq: payload.clientSeq,
      message: payload.message,
      model: adapter.currentModel?.(),
    })) ?? 'created'
    if (outcome === 'duplicate') {
      return {
        accepted: true,
        queued: true,
        cursor: this.channels.get(sessionKey)?.buffer.latestSeq ?? 0,
        clientNonce: payload.clientNonce,
        clientSeq: payload.clientSeq,
        duplicate: true,
      }
    }
    if (outcome === 'cancelled') throw promptCancelledError()
    this.messageMetadata.recordFollowUp(sessionKey, payload)
    try {
      this.lifecycle.assertOpen()
      await adapter.followUp(payload.message, {
        displayText: payload.displayMessage ?? payload.message,
        clientNonce: payload.clientNonce,
        clientSeq: payload.clientSeq,
      })
    } catch (err) {
      this.metering?.failFollowUpRun(sessionKey, payload)
      this.messageMetadata.removeFollowUp(sessionKey, payload)
      throw err
    }
    await this.drainPublishQueue(channel)
    return { accepted: true, queued: true, cursor: this.channels.get(sessionKey)?.buffer.latestSeq ?? 0, clientNonce: payload.clientNonce, clientSeq: payload.clientSeq }
  }

  async clearQueue(ctx: PiSessionRequestContext, sessionId: string, payload: QueueClearPayload): Promise<QueueClearReceipt> {
    return this.lifecycle.run(() => this.clearQueueBeforeDispose(ctx, sessionId, payload))
  }

  private async clearQueueBeforeDispose(ctx: PiSessionRequestContext, sessionId: string, payload: QueueClearPayload): Promise<QueueClearReceipt> {
    const sessionKey = this.sessionKey(ctx, sessionId)
    const adapter = await this.getAdapter(ctx, sessionId, '')
    if (hasFollowUpSelector(payload)) {
      const before = adapter.readSnapshot().followUpMessages.length
      adapter.clearFollowUp(payload)
      await this.drainPublishQueue(this.channels.get(sessionKey))
      const after = adapter.readSnapshot().followUpMessages.length
      if (after < before) {
        this.messageMetadata.removeFollowUp(sessionKey, payload)
        this.metering?.releaseQueued(sessionKey, payload)
      }
      return { accepted: true, cursor: this.channels.get(sessionKey)?.buffer.latestSeq ?? 0, cleared: Math.max(0, before - after) }
    }
    const clearedQueue = this.clearAllFollowUps(adapter, sessionId, sessionKey)
    await this.drainPublishQueue(this.channels.get(sessionKey))
    this.metering?.releaseQueued(sessionKey)
    return { accepted: true, cursor: this.channels.get(sessionKey)?.buffer.latestSeq ?? 0, cleared: clearedQueue.length }
  }

  async interrupt(ctx: PiSessionRequestContext, sessionId: string, _payload: InterruptPayload): Promise<{ accepted: true; cursor: number }> {
    return this.lifecycle.run(() => this.interruptBeforeDispose(ctx, sessionId))
  }

  private async interruptBeforeDispose(ctx: PiSessionRequestContext, sessionId: string): Promise<{ accepted: true; cursor: number }> {
    const sessionKey = this.sessionKey(ctx, sessionId)
    const adapter = await this.getAdapter(ctx, sessionId, '')
    const snapshot = adapter.readSnapshot()
    const wasActive = snapshot.isStreaming || snapshot.isRetrying
    const nextFollowUp = wasActive ? this.nextFollowUpForInterrupt(sessionId, sessionKey, adapter) : undefined
    const activeRun = this.activePromptRuns.get(sessionKey)
    adapter.abortRetry?.()
    if (wasActive) await adapter.abort()
    await this.drainPublishQueue(this.channels.get(sessionKey))
    await activeRun?.catch(() => {})
    // Release prompt reservations stranded before agent-start.
    this.metering?.releasePending(sessionKey)
    if (nextFollowUp) {
      this.lifecycle.assertOpen()
      await this.autoPostInterruptedFollowUp(sessionId, sessionKey, adapter, nextFollowUp)
    }
    return { accepted: true, cursor: this.channels.get(sessionKey)?.buffer.latestSeq ?? 0 }
  }

  async stop(ctx: PiSessionRequestContext, sessionId: string, _payload: StopPayload): Promise<StopReceipt> {
    return this.lifecycle.run(() => this.stopBeforeDispose(ctx, sessionId))
  }

  private async stopBeforeDispose(ctx: PiSessionRequestContext, sessionId: string): Promise<StopReceipt> {
    const sessionKey = this.sessionKey(ctx, sessionId)
    const adapter = await this.getAdapter(ctx, sessionId, '')
    const clearedQueue = this.clearAllFollowUps(adapter, sessionId, sessionKey)
    // The active run settles/releases via the native aborted agent-end; queued
    // and not-yet-started prompt reservations are released here so they don't
    // hold the user's balance until TTL.
    this.metering?.releaseQueued(sessionKey)
    this.metering?.releasePending(sessionKey)
    await adapter.abort()
    await this.drainPublishQueue(this.channels.get(sessionKey))
    return { accepted: true, stopped: true, cursor: this.channels.get(sessionKey)?.buffer.latestSeq ?? 0, clearedQueue: buildPiChatQueuedFollowUps(sessionId, clearedQueue) }
  }

  private clearAllFollowUps(adapter: PiAgentSessionAdapter, sessionId: string, sessionKey: string): string[] {
    const before = [...adapter.readSnapshot().followUpMessages]
    adapter.clearFollowUp()
    const after = adapter.readSnapshot().followUpMessages
    this.messageMetadata.syncFromTexts(sessionKey, after)
    return removedFollowUps(before, after)
  }

  private nextFollowUpForInterrupt(sessionId: string, sessionKey: string, adapter: PiAgentSessionAdapter): QueuedUserMessage | undefined {
    const followUps = this.messageMetadata.enrichQueuedFollowUps(
      sessionKey,
      buildPiChatQueuedFollowUps(sessionId, adapter.readSnapshot().followUpMessages),
    )
    return followUps[0]
  }

  private async autoPostInterruptedFollowUp(
    sessionId: string,
    sessionKey: string,
    adapter: PiAgentSessionAdapter,
    followUp: QueuedUserMessage,
  ): Promise<void> {
    const metadata = this.messageMetadata.findFollowUpForQueueItem(sessionKey, followUp)
    this.messageMetadata.recordConsumingFollowUp(sessionKey, followUp, metadata?.serverText)
    if (adapter.continueQueuedFollowUp) {
      try {
        await Promise.race([
          this.trackActiveRun(sessionKey, this.runAndDrainPublishQueue(this.channels.get(sessionKey), adapter.continueQueuedFollowUp())),
          this.lifecycle.closingPromise,
        ])
      } catch (err) {
        // Rejected before Pi consumed the follow-up; release its reservation.
        // A no-op if it was already consumed (the run left the queue).
        this.metering?.failFollowUpRun(sessionKey, followUp)
        throw err
      }
      return
    }
    if (!this.canClearAutoPostedFollowUpForFallback(adapter, followUp)) {
      throw new AutoPostFollowUpError('Cannot auto-post queued follow-up because this runtime cannot safely remove only the consumed queued item.')
    }
    // Fallback re-posts the follow-up as a plain prompt; no followup-consumed
    // event will fire, so remove it from Pi's native follow-up queue before
    // prompting. Pi 0.80 drains native follow-ups during prompt/continue, so
    // clearing after the repost would duplicate the queued user turn.
    this.clearAutoPostedFollowUpForFallback(sessionId, sessionKey, adapter, followUp)
    this.metering?.promoteQueuedToPrompt(sessionKey, followUp)
    try {
      await this.runPrompt(sessionKey, adapter, metadata?.serverText ?? followUp.displayText)
    } catch (err) {
      // The repost rejected before agent-start; release the promoted hold so
      // it doesn't strand in pendingPrompts and misattribute later usage, then
      // restore the queue item because fallback reposting never consumed it.
      this.metering?.failPromotedFollowUp(sessionId, followUp, sessionKey)
      this.lifecycle.assertOpen()
      await adapter.followUp(metadata?.serverText ?? followUp.displayText, {
        displayText: followUp.displayText,
        clientNonce: followUp.clientNonce,
        clientSeq: followUp.clientSeq,
      })
      if (followUp.clientNonce && followUp.clientSeq !== undefined) {
        this.messageMetadata.recordFollowUp(sessionKey, {
          message: metadata?.serverText ?? followUp.displayText,
          displayMessage: followUp.displayText,
          clientNonce: followUp.clientNonce,
          clientSeq: followUp.clientSeq,
        })
      }
      throw err
    }
  }

  private async runPrompt(sessionKey: string, adapter: PiAgentSessionAdapter, input: PiAgentPromptInput): Promise<void> {
    await Promise.race([
      this.trackActiveRun(sessionKey, this.runAndDrainPublishQueue(this.channels.get(sessionKey), adapter.prompt(input))),
      this.lifecycle.closingPromise,
    ])
  }

  private async trackActiveRun(sessionKey: string, run: Promise<void>): Promise<void> {
    this.activePromptRuns.set(sessionKey, run)
    try {
      await run
    } finally {
      if (this.activePromptRuns.get(sessionKey) === run) this.activePromptRuns.delete(sessionKey)
    }
  }

  private clearAutoPostedFollowUpForFallback(
    sessionId: string,
    sessionKey: string,
    adapter: PiAgentSessionAdapter,
    followUp: QueuedUserMessage,
  ): boolean {
    if (adapter.readSnapshot().followUpMessages.length <= 1) {
      this.clearAllFollowUps(adapter, sessionId, sessionKey)
      return true
    }
    if (hasFollowUpSelector(followUp)) {
      adapter.clearFollowUp(followUpSelector(followUp))
      return true
    }
    return false
  }

  private canClearAutoPostedFollowUpForFallback(adapter: PiAgentSessionAdapter, followUp: QueuedUserMessage): boolean {
    return hasFollowUpSelector(followUp) || adapter.readSnapshot().followUpMessages.length <= 1
  }

  private enrichSyntheticPromptFailures(sessionKey: string, snapshot: PiChatSnapshot): PiChatSnapshot {
    const failures = this.syntheticPromptFailures.get(sessionKey)
    if (!failures || failures.length === 0) return snapshot
    const activeError = this.activeSyntheticPromptErrors.get(sessionKey)
    return {
      ...snapshot,
      status: activeError ? 'error' : snapshot.status,
      error: activeError ?? snapshot.error,
      messages: mergeSyntheticMessages(snapshot.messages, failures.map((failure) => failure.message)),
    }
  }

  private publishChannelEvents(
    sessionId: string,
    channel: LiveSessionChannel,
    events: PiChatEvent[],
    afterPublish?: (publishedEvents: PiChatEvent[]) => void,
  ): void {
    if (!this.eventStore || !channel.durableEventsEnabled) {
      const publishedEvents: PiChatEvent[] = []
      for (const event of events) {
        const enriched = this.messageMetadata.enrichEvent(channel.sessionKey, event)
        publishedEvents.push(enriched)
        this.publishChannelEventSync(channel, enriched)
      }
      if (this.eventStore && !channel.durableEventsEnabled) {
        channel.durableEventBacklog.push(...publishedEvents)
        if (channel.durableEventBacklog.length > MAX_DEFERRED_DURABLE_EVENTS) {
          const error = new Error('deferred browser draft event backlog exceeded before materialization')
          channel.rejectClosed(error)
          throw error
        }
        if (publishedEvents.some(isAssistantMessageEndEvent)) {
          this.scheduleDeferredDurabilityEnable(sessionId, channel)
        }
      }
      afterPublish?.(publishedEvents)
      return
    }

    const next = channel.publishQueue.then(async () => {
      const publishedEvents: PiChatEvent[] = []
      for (const event of events) {
        const enriched = this.messageMetadata.enrichEvent(channel.sessionKey, event)
        publishedEvents.push(enriched)
        await this.eventStore?.appendAgentEvent(sessionId, enriched, { idempotencyKey: String(enriched.seq), streamPath: channel.streamPath })
        this.publishChannelEventSync(channel, enriched)
      }
      afterPublish?.(publishedEvents)
    }).catch((error) => {
      channel.rejectClosed(error)
      throw error
    })
    // A failed durable append intentionally poisons this live channel: later
    // chunks cannot skip the failed PiChatEvent seq and still satisfy replay
    // authority, so callers that await the queue must see the same failure.
    channel.publishQueue = next
    next.catch(() => {})
  }

  private publishChannelEventSync(channel: LiveSessionChannel, event: PiChatEvent): void {
    const sessionKey = channel.sessionKey
    if (event.type === 'agent-start') {
      channel.activeTurnId = event.turnId
      this.activeSyntheticPromptErrors.delete(sessionKey)
    }
    if (event.type === 'message-start' && channel.activeTurnId) {
      channel.messageTurnIds.set(event.messageId, channel.activeTurnId)
    }
    if (event.type === 'message-end' && channel.activeTurnId) {
      channel.messageTurnIds.set(event.messageId, channel.activeTurnId)
      channel.messageTurnIds.set(event.final.id, channel.activeTurnId)
    }
    if (event.type === 'agent-end' && channel.activeTurnId === event.turnId) channel.activeTurnId = undefined
    this.messageMetadata.consumeEvent(sessionKey, event)
    channel.buffer.publish(event)
  }

  private publishPromptRunError(sessionKey: string, sessionId: string, channel: LiveSessionChannel | undefined, payload: PromptPayload, error: unknown): void {
    if (!channel) return
    const createdAt = new Date().toISOString()
    const messageId = `prompt-error:${payload.clientNonce}:user`
    const message = promptPayloadMessage(payload, messageId, createdAt, channel.activeTurnId)
    const messageEvent = channel.mapper.mapSynthetic({
      type: 'message-start',
      messageId,
      role: 'user' as const,
      clientNonce: payload.clientNonce,
      text: payload.displayMessage ?? payload.message,
      files: promptPayloadFileParts(payload, messageId),
      createdAt,
    })
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
    this.publishChannelEvents(sessionId, channel, [messageEvent, errorEvent], () => {
      const failures = this.syntheticPromptFailures.get(sessionKey) ?? []
      failures.push({ message, error: promptError })
      this.syntheticPromptFailures.set(sessionKey, failures)
      this.activeSyntheticPromptErrors.set(sessionKey, promptError)
      channel.activeTurnId = undefined
    })
  }

  private scheduleDeferredDurabilityEnable(sessionId: string, channel: LiveSessionChannel): void {
    if (channel.durableEnableInFlight || channel.durableEventsEnabled) return
    const enable = this.enableDeferredDurableEventsWhenMaterialized(channel.sessionCtx, sessionId, channel)
      .finally(() => {
        if (channel.durableEnableInFlight === enable) channel.durableEnableInFlight = undefined
      })
    channel.durableEnableInFlight = enable
    enable.catch(() => {})
  }

  private async runPromptAndMaybeEnableDeferredDurability(
    ctx: PiSessionRequestContext,
    sessionId: string,
    channel: LiveSessionChannel,
    run: Promise<void>,
    enableAfterMaterialization: boolean,
  ): Promise<void> {
    let runError: unknown
    try {
      await this.runAndDrainPublishQueue(channel, run)
    } catch (error) {
      runError = error
    }

    let durabilityError: unknown
    if (enableAfterMaterialization || !channel.durableEventsEnabled) {
      try {
        await this.enableDeferredDurableEventsWhenMaterialized(toSessionCtx(ctx), sessionId, channel)
      } catch (error) {
        durabilityError = error
      }
    }

    if (runError !== undefined) throw runError
    if (durabilityError !== undefined) throw durabilityError
  }

  private async enableDeferredDurableEventsWhenMaterialized(
    sessionCtx: SessionCtx,
    sessionId: string,
    channel: LiveSessionChannel,
  ): Promise<void> {
    let detail: SessionSummary
    try {
      detail = await this.sessionStore.load(sessionCtx, sessionId)
    } catch (error) {
      if (isSessionNotFoundError(error, sessionId)) return
      throw error
    }
    if (detail.materialized !== true || detail.canRename !== true) return

    const wasMaterialized = channel.capabilities.materialized === true && channel.capabilities.canRename === true
    if (this.eventStore && !channel.durableEventsEnabled) {
      const backlog = [...channel.durableEventBacklog]
      channel.durableEventBacklog = []
      channel.durableEventsEnabled = true
      const next = channel.publishQueue.then(async () => {
        await this.eventStore?.createStream(channel.streamPath)
        for (const event of backlog) {
          await this.eventStore?.appendAgentEvent(sessionId, event, { idempotencyKey: String(event.seq), streamPath: channel.streamPath })
        }
      }).catch((error) => {
        channel.rejectClosed(error)
        throw error
      })
      channel.publishQueue = next
      await next
    }

    if (wasMaterialized) return
    channel.capabilities = { materialized: true, canRename: true }
    this.publishChannelEvents(sessionId, channel, [channel.mapper.mapSynthetic({
      type: 'capabilities-updated',
      capabilities: channel.capabilities,
    })])
    await this.drainPublishQueue(channel)
  }

  private async runAndDrainPublishQueue(channel: LiveSessionChannel | undefined, run: Promise<void>): Promise<void> {
    let runError: unknown
    try {
      await run
    } catch (error) {
      runError = error
    }

    try {
      await this.drainPublishQueue(channel)
    } catch (error) {
      if (runError === undefined) throw error
    }

    if (runError !== undefined) throw runError
  }

  private async drainPublishQueue(channel: LiveSessionChannel | undefined): Promise<void> {
    await channel?.publishQueue
  }

  private async getAdapter(
    ctx: PiSessionRequestContext,
    sessionId: string,
    input: string | PromptPayload,
    options?: { authorize?: boolean },
  ): Promise<PiAgentSessionAdapter> {
    this.lifecycle.assertOpen()
    if (!this.harness.getPiSessionAdapter) throw new Error('pi-native harness adapter unavailable')
    if (options?.authorize !== false) await this.assertCanAccessSession(ctx, sessionId)
    this.lifecycle.assertOpen()
    const message = typeof input === 'string' ? input : input.message
    const sendInput: AgentSendInput = {
      sessionId,
      content: message,
      message,
      ctx: toSessionCtx(ctx),
      ...(typeof input !== 'string' && input.model ? { model: input.model } : {}),
      ...(typeof input !== 'string' && input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
      ...(typeof input !== 'string' && input.attachments ? { attachments: input.attachments } : {}),
      ...(typeof input !== 'string' && input.browserDraft ? { browserDraft: input.browserDraft } : {}),
    }
    const adapter = await this.harness.getPiSessionAdapter(sendInput, {
      abortSignal: new AbortController().signal,
      workdir: this.workdir,
      workspaceId: ctx.workspaceId,
      storageScope: ctx.storageScope,
      requestId: ctx.requestId,
      userId: ctx.authSubject,
      userEmail: ctx.authEmail,
      userEmailVerified: ctx.authEmailVerified,
    })
    await this.lifecycle.assertAdapterOwned(adapter)
    return adapter
  }

  private async getChannel(ctx: PiSessionRequestContext, sessionId: string): Promise<LiveSessionChannel> {
    await this.assertCanAccessSession(ctx, sessionId)
    const sessionKey = this.sessionKey(ctx, sessionId)
    const existing = this.channels.get(sessionKey)
    if (existing) return existing
    return this.createChannelOnce(sessionKey, sessionId, toSessionCtx(ctx), () => this.getAdapter(ctx, sessionId, '', { authorize: false }), {
      deferDurableEvents: await this.shouldDeferDurableEventsForUnmaterializedNativeSession(ctx, sessionId),
    })
  }

  private async ensureChannel(
    ctx: PiSessionRequestContext,
    sessionId: string,
    adapter: PiAgentSessionAdapter,
    options?: { deferDurableEvents?: boolean },
  ): Promise<LiveSessionChannel> {
    const sessionKey = this.sessionKey(ctx, sessionId)
    const existing = this.channels.get(sessionKey)
    if (existing) return existing
    return this.createChannelOnce(sessionKey, sessionId, toSessionCtx(ctx), async () => adapter, options)
  }

  /** Coalesce concurrent cold callers so only one adapter subscription wins. */
  private async createChannelOnce(
    sessionKey: string,
    sessionId: string,
    sessionCtx: SessionCtx,
    resolveAdapter: () => Promise<PiAgentSessionAdapter>,
    options?: { deferDurableEvents?: boolean },
  ): Promise<LiveSessionChannel> {
    const inFlight = this.channelCreations.get(sessionKey)
    if (inFlight) return inFlight
    const creation = (async () => {
      const existing = this.channels.get(sessionKey)
      if (existing) return existing
      const adapter = await resolveAdapter()
      await this.lifecycle.assertAdapterOwned(adapter)
      return this.buildChannel(sessionKey, sessionId, sessionCtx, adapter, options)
    })()
    this.channelCreations.set(sessionKey, creation)
    try {
      return await creation
    } finally {
      if (this.channelCreations.get(sessionKey) === creation) this.channelCreations.delete(sessionKey)
    }
  }

  private async buildChannel(
    sessionKey: string,
    sessionId: string,
    sessionCtx: SessionCtx,
    adapter: PiAgentSessionAdapter,
    options?: { deferDurableEvents?: boolean },
  ): Promise<LiveSessionChannel> {
    const existing = this.channels.get(sessionKey)
    if (existing) return existing
    const streamPath = sessionStreamPath(sessionKey)
    const durableEventsEnabled = !(this.eventStore && options?.deferDurableEvents === true)
    let initialSeq: number
    try {
      if (durableEventsEnabled) await this.ensureDurableStream(streamPath, legacySessionStreamPaths(sessionId, sessionCtx))
      initialSeq = durableEventsEnabled ? await this.readDurableLatestPiChatSeq(streamPath) : 0
    } catch (error) {
      if (this.lifecycle.isClosing) await this.lifecycle.rejectLateAdapter(adapter, error)
      throw error
    }
    await this.lifecycle.assertAdapterOwned(adapter)
    const buffer = new PiChatReplayBuffer({ initialLatestSeq: initialSeq })
    const mapper = new PiChatEventMapper({ sessionId, initialSeq: buffer.latestSeq })
    const closed = deferred<void>()
    closed.promise.catch(() => {})
    const channel: LiveSessionChannel = {
      sessionKey,
      sessionCtx,
      streamPath,
      buffer,
      adapter,
      unsubscribe: () => {},
      mapper,
      publishQueue: Promise.resolve(),
      closed: closed.promise,
      resolveClosed: () => closed.resolve(),
      rejectClosed: closed.reject,
      messageTurnIds: new Map(),
      capabilities: options?.deferDurableEvents === true
        ? { materialized: false, canRename: false }
        : { materialized: true, canRename: true },
      durableEventsEnabled,
      durableEventBacklog: [],
    }
    const unsubscribe = adapter.subscribe((event) => {
      const mappedEvents = mapper.map(event)
      // Metering observes the ENRICHED events: in production the native Pi
      // message for a consumed follow-up carries no clientNonce/clientSeq —
      // those selectors are recovered here by enrichEvent, and the metering
      // coordinator needs them to attribute the follow-up's usage correctly.
      this.publishChannelEvents(sessionId, channel, mappedEvents, (enrichedEvents) => {
        this.metering?.observe(sessionKey, event, enrichedEvents)
      })
    })
    channel.unsubscribe = unsubscribe
    this.channels.set(sessionKey, channel)
    return channel
  }

  private async ensureDurableStream(streamPath: string, legacyStreamPaths: readonly string[]): Promise<void> {
    if (!this.eventStore) return
    const inFlight = this.durableStreamMigrations.get(streamPath)
    if (inFlight) return inFlight
    const migration = this.ensureDurableStreamUncoalesced(streamPath, legacyStreamPaths)
    this.durableStreamMigrations.set(streamPath, migration)
    try {
      await migration
    } finally {
      if (this.durableStreamMigrations.get(streamPath) === migration) this.durableStreamMigrations.delete(streamPath)
    }
  }

  private async ensureDurableStreamUncoalesced(streamPath: string, legacyStreamPaths: readonly string[]): Promise<void> {
    if (!this.eventStore) return
    await this.migrateDurableStream(streamPath, legacyStreamPaths)
  }

  private async migrateDurableStream(streamPath: string, legacyStreamPaths: readonly string[], retriesRemaining = 3): Promise<void> {
    if (!this.eventStore) return
    const legacyPath = await this.findLegacyStreamPath(streamPath, legacyStreamPaths)
    await this.eventStore.createStream(streamPath)
    if (!legacyPath) return

    const legacyMeta = await this.eventStore.getStreamMeta(legacyPath)
    if (!legacyMeta) return
    const completionKey = legacyMigrationCompletionKey(streamPath, legacyPath)
    const expectedCompletionValue = legacyMigrationCompletionValue(legacyMeta)
    if (await this.eventStore.getMetaValue?.(completionKey) === expectedCompletionValue) return

    const legacy = await this.readAllStreamEvents(legacyPath)
    const scoped = await this.readAllStreamEvents(streamPath)
    const legacyEvents = legacy.events
    const scopedEvents = scoped.events

    const commonPrefixLength = eventCommonPrefixLength(scopedEvents, legacyEvents)
    if (scopedEvents.length > 0 && commonPrefixLength === 0) {
      await this.eventStore.setMetaValue?.(completionKey, legacyMigrationCompletionValue(legacy))
      return
    }

    const mergedEvents = mergeLegacyEventsBeforeScopedExtras(legacyEvents, scopedEvents)
    try {
      await this.eventStore.replaceStreamEvents(
        streamPath,
        migrationReplacementEvents(legacyPath, mergedEvents, legacyEvents.length),
        {
          closed: scoped.closed || (legacy.closed && mergedEvents.length === legacyEvents.length),
          expectedNextOffset: scoped.nextOffset,
          expectedClosed: scoped.closed,
        },
      )
    } catch (error) {
      if (retriesRemaining > 0 && isEventStreamReplaceConflict(error)) {
        await this.migrateDurableStream(streamPath, legacyStreamPaths, retriesRemaining - 1)
        return
      }
      throw error
    }
    await this.eventStore.setMetaValue?.(completionKey, legacyMigrationCompletionValue(legacy))
  }

  private async readAllStreamEvents(streamPath: string): Promise<{ events: MigratedStreamEvent[]; nextOffset: string; closed: boolean }> {
    const events: MigratedStreamEvent[] = []
    if (!this.eventStore) return { events, nextOffset: '-1', closed: false }
    let offset = '-1'
    for (;;) {
      const page = await this.eventStore.readEvents(streamPath, { offset, limit: 1000 })
      events.push(...page.events)
      offset = page.nextOffset
      if (page.upToDate) {
        const idempotencyKeys = await this.readStreamIdempotencyKeys(streamPath)
        return {
          events: attachEventIdempotencyKeys(events, idempotencyKeys),
          nextOffset: page.nextOffset,
          closed: page.closed,
        }
      }
    }
  }

  private async readStreamIdempotencyKeys(streamPath: string): Promise<EventStreamIdempotencyKey[]> {
    return this.eventStore?.readEventIdempotencyKeys?.(streamPath) ?? []
  }

  private async findLegacyStreamPath(streamPath: string, legacyStreamPaths: readonly string[]): Promise<string | undefined> {
    if (!this.eventStore) return undefined
    for (const legacyPath of legacyStreamPaths) {
      if (legacyPath === streamPath) continue
      const meta = await this.eventStore.getStreamMeta(legacyPath)
      if (meta) return legacyPath
    }
    return undefined
  }

  private async readDurableLatestPiChatSeq(streamPath: string): Promise<number> {
    if (!this.eventStore) return 0
    const meta = await this.eventStore.getStreamMeta(streamPath)
    if (!meta) return 0
    const tailIndex = parseOffset(meta.nextOffset)
    if (tailIndex < 0) return 0
    const tail = await this.eventStore.readEvents(streamPath, {
      offset: formatOffset(tailIndex - 1),
      limit: 1,
    })
    const envelope = tail.events[0]?.data as Partial<AgentEvent> | undefined
    const seq = envelope?.chunk?.seq
    return typeof seq === 'number' && Number.isInteger(seq) && seq >= 0 ? seq : tailIndex + 1
  }

  private validatedBrowserDraftSignal(sessionId: string, payload: PromptPayload): PromptPayload['browserDraft'] | undefined {
    const signal = payload.browserDraft
    if (!signal) return undefined
    if (signal.kind !== 'new-native' || !SAFE_BROWSER_DRAFT_NATIVE_ID.test(sessionId) || !SAFE_BROWSER_DRAFT_REQUEST_ID.test(signal.requestId)) {
      throw Object.assign(new Error('invalid browser draft session'), {
        statusCode: 400,
        code: ErrorCode.enum.BRIDGE_COMMAND_INVALID,
      })
    }
    return signal
  }

  private assertTrustedBrowserDraftOwner(ctx: PiSessionRequestContext): void {
    if (!ctx.workspaceId || !ctx.authSubject || ctx.browserDraftNative !== true || this.harness.browserDraftNative !== true) {
      throw Object.assign(new Error('browser draft native admission requires a trusted durable owner capability'), {
        statusCode: 401,
        code: ErrorCode.enum.UNAUTHORIZED,
      })
    }
  }

  private async assertSessionCanRename(ctx: PiSessionRequestContext, sessionId: string): Promise<void> {
    const detail = await this.sessionStore.load(toSessionCtx(ctx), sessionId)
    if (detail.materialized === true && detail.canRename === true) return
    throw browserDraftRenameNotAvailableError()
  }

  private async assertBrowserDraftSessionUnusedForFirstSend(ctx: PiSessionRequestContext, sessionId: string): Promise<void> {
    try {
      await this.sessionStore.load(toSessionCtx(ctx), sessionId)
      throw browserDraftRequestExpiredError()
    } catch (error) {
      if (!isSessionNotFoundError(error, sessionId)) throw error
    }
    if (await this.sessionStore.hasSessionId?.(sessionId)) throw browserDraftSessionCollisionError()
  }

  private async assertBrowserDraftSessionAbsentForUnknownRetry(ctx: PiSessionRequestContext, sessionId: string): Promise<void> {
    try {
      await this.sessionStore.load(toSessionCtx(ctx), sessionId)
      throw browserDraftRequestExpiredError()
    } catch (error) {
      if (!isSessionNotFoundError(error, sessionId)) throw error
    }
  }

  private scheduleBrowserDraftAdmissionEviction(key: string, admission: BrowserDraftPromptAdmission): void {
    if (admission.evictionTimer) clearTimeout(admission.evictionTimer)
    const timer = setTimeout(() => {
      if (this.browserDraftPromptAdmissions.get(key) === admission) admission.expired = true
    }, BROWSER_DRAFT_ADMISSION_TTL_MS)
    timer.unref?.()
    admission.evictionTimer = timer
  }

  private async shouldDeferDurableEventsForUnmaterializedNativeSession(ctx: PiSessionRequestContext, sessionId: string): Promise<boolean> {
    if (!this.eventStore || !SAFE_BROWSER_DRAFT_NATIVE_ID.test(sessionId)) return false
    if (!this.harness.hasPiSession?.(sessionId, toSessionCtx(ctx))) return false
    try {
      await this.sessionStore.load(toSessionCtx(ctx), sessionId)
      return false
    } catch (error) {
      if (isSessionNotFoundError(error, sessionId)) return true
      throw error
    }
  }

  private async assertCanAccessSession(ctx: PiSessionRequestContext, sessionId: string): Promise<void> {
    const sessionCtx = toSessionCtx(ctx)
    if (this.harness.hasPiSession?.(sessionId, sessionCtx)) return
    try {
      await this.sessionStore.load(sessionCtx, sessionId)
    } catch (error) {
      throw normalizeSessionAccessError(error, sessionId)
    }
  }

  private sessionKey(ctx: PiSessionRequestContext, sessionId: string): string {
    return sessionCacheKey(sessionId, toSessionCtx(ctx))
  }

}

class AutoPostFollowUpError extends Error {}

/** A prompt/follow-up whose run was cancelled by a concurrent stop/interrupt
 * during reservation. Surfaced as a retryable 409 (ABORTED) rather than a fake
 * accepted run the client would wait on forever. */
function isAssistantMessageEndEvent(event: PiChatEvent): boolean {
  return event.type === 'message-end' && event.final.role === 'assistant'
}

function promptCancelledError(): Error {
  return Object.assign(new Error('request cancelled before execution'), {
    statusCode: 409,
    code: ErrorCode.enum.ABORTED,
    retryable: true,
  })
}

function browserDraftRequestConflictError(): Error {
  return Object.assign(new Error('browser draft requestId already belongs to a different prompt'), {
    statusCode: 409,
    code: ErrorCode.enum.SESSION_LOCKED,
    retryable: false,
  })
}

function browserDraftRequestExpiredError(): Error {
  return Object.assign(new Error('browser draft request is no longer live; reload the session before retrying'), {
    statusCode: 409,
    code: ErrorCode.enum.SESSION_LOCKED,
    retryable: false,
  })
}

function browserDraftOutcomeUnknownError(): Error {
  return Object.assign(new Error('browser draft first-send outcome is unknown; reload before retrying'), {
    statusCode: 409,
    code: ErrorCode.enum.SUBMISSION_UNKNOWN,
    retryable: false,
  })
}

function browserDraftSessionCollisionError(): Error {
  return Object.assign(new Error('browser draft session is already owned by another context'), {
    statusCode: 404,
    code: ErrorCode.enum.SESSION_NOT_FOUND,
    retryable: false,
  })
}

function browserDraftRenameNotAvailableError(): Error {
  return Object.assign(new Error('session rename is not available until the first assistant response is committed'), {
    statusCode: 409,
    code: ErrorCode.enum.SESSION_LOCKED,
    retryable: true,
  })
}

function browserDraftAdmissionKey(sessionId: string): string {
  return sessionId
}

function browserDraftPromptFingerprint(payload: PromptPayload): string {
  return JSON.stringify({
    message: payload.message,
    displayMessage: payload.displayMessage ?? null,
    model: payload.model ?? null,
    thinkingLevel: payload.thinkingLevel ?? null,
    attachments: payload.attachments ?? null,
  })
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function rejectedReasons(results: PromiseSettledResult<unknown>[]): unknown[] {
  return results.flatMap((result) => result.status === 'rejected' ? [result.reason] : [])
}

function normalizeSessionAccessError(error: unknown, sessionId: string): unknown {
  if (isSessionNotFoundError(error, sessionId)) {
    return Object.assign(new Error('session not found'), {
      code: ErrorCode.enum.SESSION_NOT_FOUND,
    })
  }
  return error
}

function isSessionNotFoundError(error: unknown, sessionId: string): boolean {
  return (error as { code?: unknown })?.code === ErrorCode.enum.SESSION_NOT_FOUND || isPlainSessionNotFound(error, sessionId)
}

function isPlainSessionNotFound(error: unknown, sessionId: string): boolean {
  return error instanceof Error && (
    error.message === 'session not found' ||
    error.message === `Session not found: ${sessionId}`
  )
}

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
    path: attachment.path,
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

async function toPiPromptInput(payload: PromptPayload, workspace?: Workspace): Promise<PiAgentPromptInput> {
  const images = await promptImagesFromAttachments(payload.attachments, workspace)
  if (images.length === 0) return payload.message
  return { text: payload.message, options: { images } }
}

async function promptImagesFromAttachments(
  attachments: PromptPayload['attachments'],
  workspace?: Workspace,
): Promise<Array<{ type: 'image'; mimeType: string; data: string }>> {
  const images: Array<{ type: 'image'; mimeType: string; data: string }> = []
  for (const attachment of attachments ?? []) {
    const match = attachment.url.match(/^data:(image\/[^;]+);base64,(.+)$/)
    if (match) {
      const [, mimeType, data] = match
      images.push({ type: 'image', mimeType, data })
      continue
    }

    if (!workspace?.readBinaryFile || !isWorkspaceImageAttachment(attachment)) continue
    try {
      const stat = await workspace.stat(attachment.path)
      if (stat.kind !== 'file' || stat.size <= 0 || stat.size > MAX_PROMPT_IMAGE_BYTES) continue
      const bytes = await workspace.readBinaryFile(attachment.path)
      if (bytes.byteLength <= 0 || bytes.byteLength > MAX_PROMPT_IMAGE_BYTES) continue
      const detectedMimeType = detectPromptImageMimeType(bytes)
      if (!detectedMimeType) continue
      images.push({
        type: 'image',
        mimeType: detectedMimeType,
        data: Buffer.from(bytes).toString('base64'),
      })
    } catch {
      // Best effort: the enriched prompt still points the agent at the
      // workspace path, so a transient read miss must not reject the turn.
    }
  }
  return images
}

function isWorkspaceImageAttachment(
  attachment: NonNullable<PromptPayload['attachments']>[number],
): attachment is NonNullable<PromptPayload['attachments']>[number] & { mediaType: string; path: string } {
  if (!attachment.mediaType?.startsWith('image/') || !attachment.path) return false
  const lowerPath = attachment.path.toLowerCase()
  return [...PROMPT_IMAGE_EXTENSIONS].some((ext) => lowerPath.endsWith(ext))
}

function detectPromptImageMimeType(bytes: Uint8Array): string | null {
  const buffer = Buffer.from(bytes)
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png'
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg'
  }
  if (buffer.length >= 6) {
    const gif = buffer.subarray(0, 6).toString('ascii')
    if (gif === 'GIF87a' || gif === 'GIF89a') return 'image/gif'
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp'
  }
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('ascii')
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
  }
  return null
}

function isEventStreamReplaceConflict(error: unknown): boolean {
  return error instanceof Error && error.message.includes('changed during replacement')
}

function legacyMigrationCompletionKey(streamPath: string, legacyPath: string): string {
  return `legacy-stream-migration-complete:${JSON.stringify([streamPath, legacyPath])}`
}

function legacyMigrationCompletionValue(meta: EventStreamMeta): string {
  return JSON.stringify({ nextOffset: meta.nextOffset, closed: meta.closed })
}

function legacyMigrationEventKey(legacyPath: string, offset: string): string {
  return `legacy-stream-migration:${JSON.stringify([legacyPath, offset])}`
}

function eventDataSignature(data: unknown): string {
  return JSON.stringify(data) ?? 'undefined'
}

type MigratedStreamEvent = { data: unknown; offset: string; idempotencyKey?: string; idempotencyData?: unknown }

function attachEventIdempotencyKeys(
  events: readonly MigratedStreamEvent[],
  idempotencyKeys: readonly EventStreamIdempotencyKey[],
): MigratedStreamEvent[] {
  const keysByOffset = new Map(idempotencyKeys.map((key) => [key.offset, key]))
  return events.map((event) => {
    const key = keysByOffset.get(event.offset)
    return key ? { ...event, idempotencyKey: key.key, idempotencyData: key.data } : event
  })
}

function eventCommonPrefixLength(left: readonly MigratedStreamEvent[], right: readonly MigratedStreamEvent[]): number {
  const max = Math.min(left.length, right.length)
  for (let index = 0; index < max; index += 1) {
    if (eventDataSignature(left[index]?.data) !== eventDataSignature(right[index]?.data)) return index
  }
  return max
}

function eventDataCounts(events: readonly MigratedStreamEvent[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const event of events) {
    const signature = eventDataSignature(event.data)
    counts.set(signature, (counts.get(signature) ?? 0) + 1)
  }
  return counts
}

function mergeLegacyEventsBeforeScopedExtras(
  legacyEvents: readonly MigratedStreamEvent[],
  scopedEvents: readonly MigratedStreamEvent[],
): MigratedStreamEvent[] {
  const remainingLegacyCounts = eventDataCounts(legacyEvents)
  const scopedExtras: MigratedStreamEvent[] = []
  for (const event of scopedEvents) {
    const signature = eventDataSignature(event.data)
    const count = remainingLegacyCounts.get(signature) ?? 0
    if (count > 0) {
      if (count === 1) remainingLegacyCounts.delete(signature)
      else remainingLegacyCounts.set(signature, count - 1)
      continue
    }
    scopedExtras.push(event)
  }
  return [...legacyEvents, ...scopedExtras]
}

function migrationReplacementEvents(
  legacyPath: string,
  events: readonly MigratedStreamEvent[],
  legacyEventCount: number,
): EventStreamReplacementEvent[] {
  const usedKeys = new Set<string>()
  const scopedExtraKeys = agentEventIdempotencyKeys(events.slice(legacyEventCount))
  let nextScopedExtraSeq = maxAgentEventChunkSeq(events.slice(0, legacyEventCount))
  return events.map((event, index) => {
    let data = reindexAgentEventData(event.data, index)
    if (index < legacyEventCount) {
      const agentKey = event.idempotencyKey ?? agentEventIdempotencyKey(data)
      if (agentKey && !scopedExtraKeys.has(agentKey) && !usedKeys.has(agentKey)) {
        usedKeys.add(agentKey)
        return {
          data,
          idempotencyKey: agentKey,
          idempotencyData: migratedEventIdempotencyData(event, isAgentEvent(data) ? data.chunk : data),
        }
      }
      const idempotencyKey = legacyMigrationEventKey(legacyPath, event.offset)
      usedKeys.add(idempotencyKey)
      return { data, idempotencyKey, idempotencyData: data }
    }

    const originalAgentKey = event.idempotencyKey ?? agentEventIdempotencyKey(event.data)
    const originalAgentChunk = migratedEventIdempotencyData(event, isAgentEvent(event.data) ? event.data.chunk : undefined)
    if (isAgentEvent(data)) {
      const originalSeq = agentEventChunkSeq(event.data)
      const nextSeq = originalSeq !== undefined && originalSeq > nextScopedExtraSeq ? originalSeq : nextScopedExtraSeq + 1
      nextScopedExtraSeq = nextSeq
      data = resequenceAgentEventData(data, nextSeq)
    }
    if (originalAgentKey && !usedKeys.has(originalAgentKey)) {
      usedKeys.add(originalAgentKey)
      return { data, idempotencyKey: originalAgentKey, idempotencyData: originalAgentChunk }
    }
    return { data }
  })
}

function migratedEventIdempotencyData(event: MigratedStreamEvent, fallback: unknown): unknown {
  return Object.prototype.hasOwnProperty.call(event, 'idempotencyData') ? event.idempotencyData : fallback
}

function reindexAgentEventData(data: unknown, eventIndex: number): unknown {
  return isAgentEvent(data) ? { ...data, eventIndex } : data
}

function resequenceAgentEventData(data: AgentEvent, seq: number): AgentEvent {
  return { ...data, chunk: { ...data.chunk, seq } } as AgentEvent
}

function agentEventIdempotencyKeys(events: readonly MigratedStreamEvent[]): Set<string> {
  const keys = new Set<string>()
  for (const event of events) {
    const key = event.idempotencyKey ?? agentEventIdempotencyKey(event.data)
    if (key) keys.add(key)
  }
  return keys
}

function maxAgentEventChunkSeq(events: readonly MigratedStreamEvent[]): number {
  let maxSeq = 0
  for (const event of events) {
    const seq = agentEventChunkSeq(event.data)
    if (seq !== undefined) maxSeq = Math.max(maxSeq, seq)
  }
  return maxSeq
}

function agentEventIdempotencyKey(data: unknown): string | undefined {
  const seq = agentEventChunkSeq(data)
  return seq === undefined ? undefined : String(seq)
}

function agentEventChunkSeq(data: unknown): number | undefined {
  if (!isAgentEvent(data)) return undefined
  const seq = data.chunk.seq
  return typeof seq === 'number' && Number.isInteger(seq) && seq >= 0 ? seq : undefined
}

function isAgentEvent(data: unknown): data is AgentEvent {
  if (!data || typeof data !== 'object') return false
  const candidate = data as Partial<AgentEvent>
  return candidate.v === 1 && typeof candidate.eventIndex === 'number' && !!candidate.chunk && typeof candidate.chunk === 'object'
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

function browserDraftNativeCreateUnsupportedError(): Error & { statusCode: number; code: string; retryable: false; details: Record<string, string> } {
  return Object.assign(
    new Error('Server-created Pi sessions are unsupported in browser-draft native mode. Create a browser-memory draft and materialize it with first send.'),
    {
      statusCode: 409,
      code: ErrorCode.enum.SESSION_CREATE_UNSUPPORTED,
      retryable: false as const,
      details: { mode: 'browser-draft-native', action: 'use-browser-memory-draft' },
    },
  )
}

function toSessionCtx(ctx: PiSessionRequestContext): SessionCtx {
  return { workspaceId: ctx.workspaceId, userId: ctx.authSubject, storageScope: ctx.storageScope }
}

function sessionCacheKey(sessionId: string, ctx: SessionCtx): string {
  return JSON.stringify([sessionId, ctx.workspaceId ?? '', ctx.userId ?? '', ctx.storageScope ?? ''])
}

function legacySessionStreamPaths(sessionId: string, ctx: SessionCtx): string[] {
  return [
    sessionStreamPath(JSON.stringify([sessionId, ctx.workspaceId ?? '', ctx.userId ?? ''])),
    sessionStreamPath(sessionId),
  ]
}
