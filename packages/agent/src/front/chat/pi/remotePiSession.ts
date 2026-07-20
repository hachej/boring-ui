import { ErrorCode } from '../../../shared/error-codes'
import type { SessionSummary } from '../../../shared/session'
import {
  isNativePromptReceipt,
  type NativePromptReceipt,
} from '../../../shared/chat/nativePiFirstSend'
import type {
  CommandReceipt,
  FollowUpPayload,
  FollowUpReceipt,
  InterruptPayload,
  PromptPayload,
  PromptReceipt,
  QueueClearPayload,
  QueueClearReceipt,
  StopPayload,
  StopReceipt,
  PiChatEvent,
} from '../../../shared/chat'
import {
  CommandReceiptSchema,
  FollowUpReceiptSchema,
  PiChatSnapshotSchema,
  PromptReceiptSchema,
  QueueClearReceiptSchema,
  StopReceiptSchema,
} from '../../../shared/chat'
import type { ChatError } from '../../../shared/chat'
import { createInitialPiChatState, type OptimisticUserMessage, type PiChatState } from './piChatReducer'
import { createPiChatStore, type PiChatStore, type PiChatStoreListener, type PiChatStoreOptions } from './piChatStore'
import { NativeFirstSendErrorKind, completeNativeFirst, nativeFirstRequestConflictError, sendNativeFirst } from './nativeFirstSendTransactions'
import {
  buildPiChatEventsUrl,
  parsePiChatReplayRangeError,
  PI_CHAT_CURSOR_AHEAD_CODE,
  readPiChatNdjsonStream,
  schedulePiChatReconnect,
} from './piChatStream'

const SUPPORTED_PROTOCOL_VERSION = 1
const DEFAULT_RECONNECT_BASE_MS = 1_000
const DEFAULT_RECONNECT_MAX_MS = 30_000
// Per-attempt budget for the /state hydration (and command) fetches. Right
// after a server (re)start the event loop can be saturated for tens of seconds
// by cold plugin transforms; an un-timed fetch issued in that window hangs
// indefinitely and pins the chat on "Loading chat history…" forever, because a
// hung request never throws so hydrateAndConnect never reaches its retry path.
// The only escape was remounting (switching workspaces). Bound each request so
// a slow/hung attempt surfaces as a (retryable) error and the reconnect loop
// re-issues a fresh request against the recovered server.
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_LARGE_STATE_WARNING_BYTES = 5 * 1024 * 1024
const DEFAULT_LARGE_STATE_WARNING_MESSAGES = 300
const EVENT_TYPE_RING_LIMIT = 20
let pageLifecycleInstalled = false
let pageUnloading = false
let pageUnloadResetTimer: ReturnType<typeof globalThis.setTimeout> | undefined

export interface RemotePiSessionHeaders {
  [key: string]: string | undefined
}

export interface RemotePiSessionOptions {
  sessionId: string
  workspaceId?: string
  storageScope?: string
  apiBaseUrl?: string
  headers?: RemotePiSessionHeaders | (() => RemotePiSessionHeaders | Promise<RemotePiSessionHeaders>)
  fetch?: typeof globalThis.fetch
  onEvent?: (event: PiChatEvent) => void
  storeOptions?: PiChatStoreOptions
  autoStart?: boolean
  reconnect?: {
    baseMs?: number
    maxMs?: number
    jitterRatio?: number
    random?: () => number
  }
  debug?: {
    largeStateWarningBytes?: number
    largeStateWarningMessages?: number
    onWarning?: (warning: RemotePiSessionLargeStateWarning) => void
  }
  setTimeoutFn?: typeof globalThis.setTimeout
  clearTimeoutFn?: typeof globalThis.clearTimeout
  // Per-attempt timeout for /state and command fetches. Defaults to
  // DEFAULT_REQUEST_TIMEOUT_MS; exposed mainly for tests.
  requestTimeoutMs?: number
  /** Browser-local session: first prompt atomically creates and adopts Pi's native ID. */
  nativeFirstPrompt?: {
    onAdopt: (session: SessionSummary) => void
  }
}

export interface RemotePiSessionLargeStateWarning {
  type: 'large-state'
  sessionId: string
  approxBytes: number
  messageCount: number
  thresholdBytes: number
  thresholdMessages: number
}

export interface RemotePiSessionDebugState {
  sessionId: string
  lastSeq: number
  status: PiChatState['status']
  connection: PiChatState['connection']['state']
  lastHeartbeatAt?: number
  queue: {
    followUps: number
    optimisticOutbox: number
    pendingToolCalls: number
  }
  recentEventTypes: string[]
  gapCount: number
  retryNotice?: PiChatState['retryNotice']
  largeStateWarning?: RemotePiSessionLargeStateWarning
  history: {
    mode: 'full'
    messageCount: number
    streamingMessageCount: 0 | 1
  }
  disposed: boolean
  generation: number
  streamRunId: number
  reconnectAttempt: number
  hasReconnectTimer: boolean
  inflightFetches: number
}

type ReconnectTimer = ReturnType<typeof schedulePiChatReconnect>
type ReceiptSchema<T> = { parse(value: unknown): T }

export class RemotePiSession {
  private readonly store: PiChatStore
  private readonly fetchImpl: typeof globalThis.fetch
  private readonly apiBaseUrl: string
  private readonly storageScope: string
  private readonly setTimeoutFn: typeof globalThis.setTimeout
  private readonly clearTimeoutFn: typeof globalThis.clearTimeout
  private readonly requestTimeoutMs: number
  private generation = 0
  private streamRunId = 0
  private reconnectAttempt = 0
  private started = false
  private disposed = false
  private streamAbortController?: AbortController
  private reconnectTimer?: ReconnectTimer
  private readonly fetchControllers = new Set<AbortController>()
  private readonly recentEventTypes: string[] = []
  private gapCount = 0
  private largeStateWarning?: RemotePiSessionLargeStateWarning
  private nativeFirstPrompt?: { requestIdentity: string; promise: Promise<PromptReceipt> }
  private nativeFirstAdoption?: { localId: string; session: SessionSummary }
  private nativeFirstAdoptionTimer?: ReturnType<typeof globalThis.setTimeout>
  private nativeFirstFollowUps = 0
  private nativeFirstAdopted = false
  private readonly nativeFirstDataSource: string
  private commandSessionId: string

  constructor(private readonly options: RemotePiSessionOptions) {
    this.commandSessionId = options.sessionId
    ensurePageLifecycleListeners()
    this.apiBaseUrl = options.apiBaseUrl?.replace(/\/$/, '') ?? ''
    this.storageScope = options.storageScope ?? ''
    this.nativeFirstDataSource = `${this.apiBaseUrl}\n${options.workspaceId ?? ''}\n${this.storageScope}`
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.setTimeoutFn = options.setTimeoutFn ?? globalThis.setTimeout
    this.clearTimeoutFn = options.clearTimeoutFn ?? globalThis.clearTimeout
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    this.store = createPiChatStore(createInitialPiChatState({
      sessionId: options.sessionId,
      workspaceId: options.workspaceId,
      storageScope: this.storageScope,
      status: options.autoStart === false ? 'idle' : undefined,
    }), options.storeOptions)

    if (options.autoStart !== false) this.start()
  }

  getState(): PiChatState {
    return this.store.getState()
  }

  getDebugState(): RemotePiSessionDebugState {
    const state = this.store.getState()
    return {
      sessionId: state.sessionId,
      lastSeq: state.lastSeq,
      status: state.status,
      connection: state.connection.state,
      lastHeartbeatAt: state.connection.lastHeartbeatAt,
      queue: {
        followUps: state.queue.followUps.length,
        optimisticOutbox: Object.keys(state.optimisticOutbox).length,
        pendingToolCalls: state.pendingToolCallIds.size,
      },
      recentEventTypes: [...this.recentEventTypes],
      gapCount: this.gapCount,
      retryNotice: state.retryNotice,
      largeStateWarning: this.largeStateWarning,
      history: {
        mode: state.history.mode,
        messageCount: state.history.messageCount,
        streamingMessageCount: state.streamingMessage ? 1 : 0,
      },
      disposed: this.disposed,
      generation: this.generation,
      streamRunId: this.streamRunId,
      reconnectAttempt: this.reconnectAttempt,
      hasReconnectTimer: this.reconnectTimer !== undefined,
      inflightFetches: this.fetchControllers.size,
    }
  }

  subscribe(listener: PiChatStoreListener): () => void {
    return this.store.subscribe(listener)
  }

  start(cursor?: number): Promise<void> {
    if (this.disposed || this.started) return Promise.resolve()
    this.started = true
    const generation = this.generation
    if (cursor === undefined) {
      void this.hydrateAndConnect(generation)
      return Promise.resolve()
    }
    this.store.dispatch({ type: 'cursor-sync', cursor }, { flush: true })
    this.store.dispatch({ type: 'connection-state', state: 'connecting' }, { flush: true })
    return this.connectEvents(cursor, generation)
  }

  async prompt(payload: PromptPayload): Promise<PromptReceipt> {
    const generation = this.generation
    if (!this.isGenerationActive(generation)) throw abortError('Remote Pi session disposed before command send.')
    this.store.dispatch({ type: 'optimistic-user-message', message: toOptimisticUserMessage(payload) }, { flush: true })
    try {
      if (this.options.nativeFirstPrompt && this.commandSessionId === this.options.sessionId) {
        if (!this.isGenerationActive(generation)) throw abortError('Remote Pi session disposed before native session start.')
        return await this.postNativeFirstPrompt(payload)
      }
      if (!this.started) await this.start(this.store.getState().lastSeq)
      else this.ensureReconnectScheduled()
      return await this.postCommand('/prompt', payload, PromptReceiptSchema)
    } catch (error) {
      this.rollbackOptimisticMessage(payload.clientNonce)
      throw error
    }
  }

  async followUp(payload: FollowUpPayload): Promise<FollowUpReceipt> {
    if (!this.isGenerationActive(this.generation)) throw abortError('Remote Pi session disposed before command send.')
    if (!this.disposed) {
      this.store.dispatch({ type: 'optimistic-user-message', message: toOptimisticUserMessage(payload) }, { flush: true })
    }
    const nativeFirstPrompt = this.nativeFirstPrompt
    const defersNativeAdoption = nativeFirstPrompt !== undefined && !this.nativeFirstAdopted
    if (defersNativeAdoption) this.nativeFirstFollowUps += 1
    try {
      // A local browser session may be adopted by its first native prompt while
      // a second message is already queued. Never send that follow-up to the
      // local placeholder; wait for adoption or propagate the first-send error.
      if (nativeFirstPrompt) await nativeFirstPrompt.promise
      if (!this.started) await this.start(this.store.getState().lastSeq)
      else this.ensureReconnectScheduled()
      const receipt = await this.postCommand('/followup', payload, FollowUpReceiptSchema)
      return receipt
    } catch (error) {
      this.rollbackOptimisticMessage(payload.clientNonce)
      throw error
    } finally {
      if (defersNativeAdoption) {
        this.nativeFirstFollowUps -= 1
        this.scheduleNativeFirstAdoption()
      }
    }
  }

  async clearQueue(payload: QueueClearPayload = {}): Promise<QueueClearReceipt> {
    const receipt = await this.postCommand('/queue/clear', payload, QueueClearReceiptSchema)
    if (!this.disposed && receipt.cleared > 0) {
      this.store.dispatch({ type: 'clear-optimistic-followups', ...payload }, { flush: true })
    }
    return receipt
  }

  async interrupt(payload: InterruptPayload = {}): Promise<CommandReceipt> {
    return this.postCommand('/interrupt', payload, CommandReceiptSchema)
  }

  async stop(payload: StopPayload = {}): Promise<StopReceipt> {
    const receipt = await this.postCommand('/stop', payload, StopReceiptSchema)
    if (!this.disposed && receipt.clearedQueue.length > 0) {
      this.store.dispatch({ type: 'clear-optimistic-followups' }, { flush: true })
    }
    return receipt
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.generation += 1
    this.streamRunId += 1
    this.clearReconnectTimer()
    this.abortEventStream()
    for (const controller of this.fetchControllers) controller.abort()
    this.fetchControllers.clear()
    this.store.dispatch({ type: 'connection-state', state: 'disconnected' }, { flush: true })
    this.store.dispose()
  }

  private async hydrateAndConnect(generation: number, options: { allowSeqRewind?: boolean } = {}): Promise<void> {
    if (!this.isGenerationActive(generation)) return
    this.clearReconnectTimer()
    this.abortEventStream()
    this.store.dispatch({ type: 'connection-state', state: this.store.getState().hydrated ? 'reconnecting' : 'connecting' }, { flush: true })

    try {
      const headers = await this.requestHeaders()
      if (!this.isGenerationActive(generation)) return
      const raw = await this.fetchJsonAt(this.stateUrl(), { method: 'GET', headers })
      if (!this.isGenerationActive(generation)) return

      this.recordLargeStateWarning(raw)

      if (readProtocolVersion(raw) !== SUPPORTED_PROTOCOL_VERSION) {
        this.dispatchProtocolError(`Unsupported Pi chat protocol version: ${String(readProtocolVersion(raw) ?? 'missing')}`)
        return
      }

      const snapshot = PiChatSnapshotSchema.parse(raw)
      if (!this.isGenerationActive(generation)) return
      this.store.dispatch({ type: 'hydrate', snapshot, allowSeqRewind: options?.allowSeqRewind }, { flush: true })
      this.connectEvents(snapshot.seq, generation)
    } catch (error) {
      if (!this.isGenerationActive(generation) || isAbortError(error)) return
      this.dispatchProtocolError(errorMessage(error, 'Failed to hydrate Pi chat session state.'))
      this.scheduleReconnect(generation)
    }
  }

  private connectEvents(cursor: number, generation: number): Promise<void> {
    if (!this.isGenerationActive(generation)) return Promise.resolve()
    this.clearReconnectTimer()
    this.abortEventStream()
    const runId = ++this.streamRunId
    const controller = new AbortController()
    this.streamAbortController = controller
    let markOpen!: () => void
    const open = new Promise<void>((resolve) => {
      markOpen = resolve
    })

    void this.runEventStream(cursor, generation, runId, controller, markOpen)
    return open
  }

  private async runEventStream(
    cursor: number,
    generation: number,
    runId: number,
    controller: AbortController,
    onOpen?: () => void,
  ): Promise<void> {
    let opened = false
    const markOpen = () => {
      if (opened) return
      opened = true
      onOpen?.()
    }
    // Bound only the time-to-first-response of the (long-lived) stream fetch:
    // a saturated/restarting server can leave the request hanging before any
    // bytes arrive, which would otherwise never reconnect. Cleared as soon as
    // the response headers land so the streaming body is never timed out.
    let connectTimedOut = false
    let connectTimer: ReturnType<typeof globalThis.setTimeout> | undefined = globalThis.setTimeout(() => {
      connectTimedOut = true
      controller.abort()
    }, this.requestTimeoutMs)
    const clearConnectTimer = () => {
      if (connectTimer !== undefined) {
        globalThis.clearTimeout(connectTimer)
        connectTimer = undefined
      }
    }
    try {
      const headers = await this.requestHeaders()
      if (!this.isStreamActive(generation, runId)) {
        clearConnectTimer()
        markOpen()
        return
      }
      const response = await this.fetchImpl(buildPiChatEventsUrl({ apiBaseUrl: this.apiBaseUrl, sessionId: this.commandSessionId, cursor }), {
        method: 'GET',
        headers,
        signal: controller.signal,
      })
      clearConnectTimer()
      if (!this.isStreamActive(generation, runId)) {
        markOpen()
        return
      }

      if (!response.ok) {
        const body = await safeReadJson(response)
        if (!this.isStreamActive(generation, runId)) {
          markOpen()
          return
        }
        const replayError = parsePiChatReplayRangeError(response.status, body)
        if (replayError) {
          this.gapCount += 1
          this.rehydrateAfterStreamReset(generation, { allowSeqRewind: replayError.type === PI_CHAT_CURSOR_AHEAD_CODE })
          markOpen()
          return
        }
        this.dispatchProtocolError(routeErrorMessage(body, `Pi chat event stream failed with HTTP ${response.status}.`))
        this.scheduleReconnect(generation)
        markOpen()
        return
      }

      if (!response.body) {
        this.dispatchProtocolError('Pi chat event stream response did not include a body.')
        this.scheduleReconnect(generation)
        markOpen()
        return
      }

      this.reconnectAttempt = 0
      this.store.dispatch({ type: 'connection-state', state: 'connected' }, { flush: true })
      markOpen()
      await readPiChatNdjsonStream(response.body, {
        onFrame: (frame) => {
          if (!this.isStreamActive(generation, runId)) return
          if (frame.type === 'heartbeat') {
            this.reconnectAttempt = 0
            this.store.dispatch({ type: 'heartbeat', now: Date.parse(frame.now) || Date.now() })
            return
          }

          this.recordEventType(frame.type)
          this.options.onEvent?.(frame)
          this.store.dispatch({ type: 'event', event: frame })
          if (this.store.getState().needsResync && this.isStreamActive(generation, runId)) {
            this.gapCount += 1
            this.rehydrateAfterStreamReset(generation)
          }
        },
        onProtocolError: (error) => {
          if (!this.isStreamActive(generation, runId)) return
          this.dispatchProtocolError(error.type === 'malformed-json'
            ? 'Received malformed Pi chat stream JSON.'
            : 'Received invalid Pi chat stream frame.')
          this.scheduleReconnect(generation)
        },
      })

      if (this.isStreamActive(generation, runId) && !pageUnloading) {
        this.scheduleReconnect(generation)
      }
    } catch (error) {
      clearConnectTimer()
      markOpen()
      if (!this.isStreamActive(generation, runId)) return
      // A connect-timeout aborts the controller, so shouldIgnoreStreamClose
      // would normally swallow it; treat it instead as a recoverable
      // disconnect that schedules a reconnect against the recovered server.
      if (!connectTimedOut && shouldIgnoreStreamClose(error, controller)) return
      if (!connectTimedOut) {
        this.dispatchProtocolError(errorMessage(error, 'Pi chat event stream disconnected.'))
      }
      this.scheduleReconnect(generation)
    } finally {
      clearConnectTimer()
    }
  }

  private rehydrateAfterStreamReset(generation: number, options: { allowSeqRewind?: boolean } = {}): void {
    if (!this.isGenerationActive(generation)) return
    this.streamRunId += 1
    this.abortEventStream()
    void this.hydrateAndConnect(generation, options)
  }

  private ensureReconnectScheduled(): void {
    if (!this.isGenerationActive(this.generation)) return
    const state = this.store.getState()
    if (state.connection.state === 'connected' || state.connection.state === 'connecting') return
    if (this.reconnectTimer !== undefined) return
    void this.hydrateAndConnect(this.generation)
  }

  private scheduleReconnect(generation: number): void {
    if (!this.isGenerationActive(generation)) return
    this.clearReconnectTimer()
    this.store.dispatch({ type: 'connection-state', state: 'reconnecting' }, { flush: true })
    const attempt = this.reconnectAttempt++
    this.reconnectTimer = schedulePiChatReconnect({
      attempt,
      baseMs: this.options.reconnect?.baseMs ?? DEFAULT_RECONNECT_BASE_MS,
      maxMs: this.options.reconnect?.maxMs ?? DEFAULT_RECONNECT_MAX_MS,
      jitterRatio: this.options.reconnect?.jitterRatio,
      random: this.options.reconnect?.random,
      setTimeoutFn: this.setTimeoutFn,
      clearTimeoutFn: this.clearTimeoutFn,
      reconnect: () => {
        this.reconnectTimer = undefined
        if (!this.isGenerationActive(generation)) return
        const state = this.store.getState()
        if (state.hydrated) this.connectEvents(state.lastSeq, generation)
        else void this.hydrateAndConnect(generation)
      },
    })
  }

  private async postNativeFirstPrompt(payload: PromptPayload): Promise<PromptReceipt> {
    const requestIdentity = nativeFirstRequestIdentity(payload)
    if (this.nativeFirstPrompt) {
      if (this.nativeFirstPrompt.requestIdentity !== requestIdentity) throw nativeFirstRequestConflictError()
      return this.nativeFirstPrompt.promise
    }
    const localId = this.options.sessionId
    const promise = (async () => {
      const receipt: NativePromptReceipt = await sendNativeFirst(
        this.nativeFirstDataSource,
        localId,
        this.requestTimeoutMs,
        requestIdentity,
        async ({ idempotencyKey, retry, signal }) => {
            const headers = await this.requestHeaders()
            try {
              const response = await this.fetchImpl(`${this.apiBaseUrl}/api/v1/agent/pi-chat/sessions/native-prompt`, {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...payload, nativeSessionStart: { idempotencyKey, retry } }),
                signal,
              })
              const raw = await safeReadJson(response)
              if (!response.ok) throw new RemotePiSessionHttpError(response.status, routeErrorMessage(raw, `HTTP ${response.status}`), raw, routeErrorCode(raw))
              if (!isNativePromptReceipt(raw)) throw new NativeFirstPromptInvalidReceiptError()
              return raw
            } catch (error) {
              if (signal.aborted) throw new RemotePiSessionRequestTimeoutError('native session start', this.requestTimeoutMs)
              throw error
            }
        },
        classifyNativeFirstPromptError,
      )
      this.commandSessionId = receipt.nativeSessionId
      this.nativeFirstAdoption = { localId, session: receipt.session }
      this.scheduleNativeFirstAdoption()
      if (!receipt.accepted) throw Object.assign(new Error(receipt.error.message), { errorCode: receipt.error.code })
      return { accepted: true as const, cursor: receipt.cursor, clientNonce: receipt.clientNonce, duplicate: receipt.duplicate }
    })()
    this.nativeFirstPrompt = { requestIdentity, promise }
    try {
      return await promise
    } catch (error) {
      if (this.nativeFirstPrompt?.promise === promise) this.nativeFirstPrompt = undefined
      throw error
    }
  }

  private scheduleNativeFirstAdoption(): void {
    if (!this.nativeFirstAdoption || this.nativeFirstFollowUps > 0 || this.nativeFirstAdoptionTimer !== undefined) return
    this.nativeFirstAdoptionTimer = this.setTimeoutFn(() => {
      this.nativeFirstAdoptionTimer = undefined
      if (!this.nativeFirstAdoption || this.nativeFirstFollowUps > 0) return
      const adoption = this.nativeFirstAdoption
      this.nativeFirstAdoption = undefined
      this.nativeFirstAdopted = true
      completeNativeFirst(this.nativeFirstDataSource, adoption.localId, () => this.options.nativeFirstPrompt?.onAdopt(adoption.session))
    }, 0)
  }

  private async postCommand<TReceipt>(path: string, payload: unknown, schema: ReceiptSchema<TReceipt>): Promise<TReceipt> {
    const generation = this.generation
    if (!this.isGenerationActive(generation)) throw abortError('Remote Pi session disposed before command send.')
    const headers = await this.requestHeaders()
    if (!this.isGenerationActive(generation)) throw abortError('Remote Pi session disposed before command send.')
    const raw = await this.fetchJsonAt(this.sessionUrl(path), {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!this.isGenerationActive(generation)) {
      throw abortError('Remote Pi session disposed before command receipt.')
    }
    return schema.parse(raw)
  }

  private rollbackOptimisticMessage(clientNonce: string): void {
    if (this.disposed) return
    this.store.dispatch({ type: 'remove-optimistic-user-message', clientNonce }, { flush: true })
  }

  private async fetchJsonAt(url: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController()
    this.fetchControllers.add(controller)
    // Bound the attempt: a hung request (saturated server right after a
    // restart, dead keep-alive socket) would otherwise never settle, leaving
    // the chat stuck hydrating. On timeout we abort the in-flight fetch so it
    // rejects with an AbortError, surfacing as a retryable hydrate error.
    let timedOut = false
    const timer = globalThis.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, this.requestTimeoutMs)
    try {
      const response = await this.fetchImpl(url, { ...init, signal: controller.signal })
      const body = await safeReadJson(response)
      if (!response.ok) throw new RemotePiSessionHttpError(response.status, routeErrorMessage(body, `HTTP ${response.status}`), body, routeErrorCode(body))
      return body
    } catch (error) {
      // Distinguish our own timeout abort from a dispose-driven abort: a
      // dispose abort must stay an (ignored) AbortError, but a timeout should
      // throw a real error so the caller's catch reaches scheduleReconnect.
      if (timedOut) throw new RemotePiSessionRequestTimeoutError(url, this.requestTimeoutMs)
      throw error
    } finally {
      globalThis.clearTimeout(timer)
      this.fetchControllers.delete(controller)
    }
  }

  private async requestHeaders(): Promise<Record<string, string>> {
    const raw = typeof this.options.headers === 'function' ? await this.options.headers() : this.options.headers
    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries(raw ?? {})) {
      if (typeof value === 'string') headers[key] = value
    }
    if (this.storageScope && !hasHeader(headers, 'x-boring-storage-scope')) {
      headers['x-boring-storage-scope'] = this.storageScope
    }
    return headers
  }

  private stateUrl(): string {
    return this.sessionUrl('/state')
  }

  private sessionUrl(path: string): string {
    return `${this.apiBaseUrl}/api/v1/agent/pi-chat/${encodeURIComponent(this.commandSessionId)}${path}`
  }

  private dispatchProtocolError(message: string): void {
    if (this.disposed) return
    const error: ChatError = { code: ErrorCode.enum.INTERNAL_ERROR, message, retryable: true }
    this.store.dispatch({ type: 'protocol-error', error }, { flush: true })
  }

  private recordEventType(type: string): void {
    this.recentEventTypes.push(type)
    if (this.recentEventTypes.length > EVENT_TYPE_RING_LIMIT) this.recentEventTypes.shift()
  }

  private recordLargeStateWarning(raw: unknown): void {
    const messageCount = readSnapshotMessageCount(raw)
    const approxBytes = estimateJsonBytes(raw)
    const thresholdBytes = this.options.debug?.largeStateWarningBytes ?? DEFAULT_LARGE_STATE_WARNING_BYTES
    const thresholdMessages = this.options.debug?.largeStateWarningMessages ?? DEFAULT_LARGE_STATE_WARNING_MESSAGES
    if (messageCount <= thresholdMessages && approxBytes <= thresholdBytes) {
      this.largeStateWarning = undefined
      return
    }

    const warning: RemotePiSessionLargeStateWarning = {
      type: 'large-state',
      sessionId: this.options.sessionId,
      approxBytes,
      messageCount,
      thresholdBytes,
      thresholdMessages,
    }
    this.largeStateWarning = warning
    this.options.debug?.onWarning?.(warning)
  }

  private clearReconnectTimer(): void {
    this.reconnectTimer?.cancel()
    this.reconnectTimer = undefined
  }

  private abortEventStream(): void {
    this.streamAbortController?.abort()
    this.streamAbortController = undefined
  }

  private isGenerationActive(generation: number): boolean {
    return !this.disposed && generation === this.generation
  }

  private isStreamActive(generation: number, runId: number): boolean {
    return this.isGenerationActive(generation) && runId === this.streamRunId
  }
}

export function createRemotePiSession(options: RemotePiSessionOptions): RemotePiSession {
  return new RemotePiSession(options)
}

class RemotePiSessionRequestTimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`Request to ${url} timed out after ${timeoutMs}ms.`)
    this.name = 'RemotePiSessionRequestTimeoutError'
  }
}

class RemotePiSessionHttpError extends Error {
  constructor(readonly status: number, message: string, readonly body: unknown, readonly errorCode?: string) {
    super(message)
    this.name = 'RemotePiSessionHttpError'
  }
}

class NativeFirstPromptInvalidReceiptError extends Error {
  constructor() {
    super('Native session start returned an invalid receipt.')
    this.name = 'NativeFirstPromptInvalidReceiptError'
  }
}

/**
 * Extract the stable, CANONICAL server error code (a member of the shared ErrorCode
 * enum, e.g. `SESSION_LOCKED`) from an error thrown by a command call (prompt/follow-up/
 * etc). Returns undefined for non-HTTP errors, bodies without a code, or non-canonical
 * codes. This is the agent's generic seam: callers map a code to UI (a notice action)
 * WITHOUT the agent knowing what the code means.
 */
export function piChatErrorCode(error: unknown): string | undefined {
  if (error instanceof RemotePiSessionHttpError) return error.errorCode
  // Also accept a plain `errorCode` carried on any thrown value, so callers that
  // re-wrap or synthesize a command error can still surface a stable code — but only
  // when it's a canonical ErrorCode, never an arbitrary string.
  const parsed = ErrorCode.safeParse((error as { errorCode?: unknown } | null)?.errorCode)
  return parsed.success ? parsed.data : undefined
}

function nativeFirstRequestIdentity(payload: PromptPayload): string {
  return JSON.stringify([
    payload.message,
    payload.displayMessage ?? null,
    payload.clientNonce,
    payload.model?.provider ?? null,
    payload.model?.id ?? null,
    payload.thinkingLevel ?? null,
    (payload.attachments ?? []).map((attachment) => [
      attachment.filename ?? null,
      attachment.mediaType ?? null,
      attachment.url,
      attachment.path ?? null,
    ]),
  ])
}

function classifyNativeFirstPromptError(error: unknown): NativeFirstSendErrorKind {
  if ((error as { errorCode?: unknown } | null)?.errorCode === ErrorCode.enum.NATIVE_SESSION_START_OUTCOME_UNKNOWN) {
    return NativeFirstSendErrorKind.TerminalUnknown
  }
  if (error instanceof RemotePiSessionHttpError && error.errorCode) return NativeFirstSendErrorKind.Definite
  if (error instanceof TypeError
    || error instanceof RemotePiSessionRequestTimeoutError
    || error instanceof NativeFirstPromptInvalidReceiptError
    || (error instanceof RemotePiSessionHttpError && error.status >= 500)) {
    return NativeFirstSendErrorKind.Ambiguous
  }
  return NativeFirstSendErrorKind.Definite
}

function toOptimisticUserMessage(payload: PromptPayload | FollowUpPayload): OptimisticUserMessage {
  const displayText = payload.displayMessage ?? payload.message
  return {
    id: `optimistic:${payload.clientNonce}`,
    role: 'user',
    status: 'pending',
    clientNonce: payload.clientNonce,
    createdAt: new Date().toISOString(),
    ...('clientSeq' in payload ? { clientSeq: payload.clientSeq } : {}),
    parts: [
      { type: 'text', id: `optimistic:${payload.clientNonce}:text`, text: displayText },
      ...('attachments' in payload ? (payload.attachments ?? []) : []).map((attachment, index) => ({
        type: 'file' as const,
        id: `optimistic:${payload.clientNonce}:file:${index}`,
        filename: attachment.filename,
        mediaType: attachment.mediaType,
        url: attachment.url,
        path: attachment.path,
      })),
    ],
  }
}

async function safeReadJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function routeErrorMessage(body: unknown, fallback: string): string {
  if (typeof body !== 'object' || body === null) return fallback
  const error = (body as Record<string, unknown>).error
  const payload = typeof error === 'object' && error !== null ? error as Record<string, unknown> : body as Record<string, unknown>
  return typeof payload.message === 'string' && payload.message ? payload.message : fallback
}

function routeErrorCode(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const error = (body as Record<string, unknown>).error
  const payload = typeof error === 'object' && error !== null ? error as Record<string, unknown> : body as Record<string, unknown>
  // Only surface a CANONICAL code: hosts treat notice.errorCode as a stable action
  // key, so a malformed/legacy body must not leak an arbitrary string.
  const parsed = ErrorCode.safeParse(payload.code)
  return parsed.success ? parsed.data : undefined
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function readProtocolVersion(value: unknown): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>).protocolVersion : undefined
}

function readSnapshotMessageCount(value: unknown): number {
  if (typeof value !== 'object' || value === null) return 0
  const messages = (value as Record<string, unknown>).messages
  return Array.isArray(messages) ? messages.length : 0
}

function estimateJsonBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength
  } catch {
    return 0
  }
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lowerName = name.toLowerCase()
  return Object.keys(headers).some((key) => key.toLowerCase() === lowerName)
}

function abortError(message: string): DOMException {
  return new DOMException(message, 'AbortError')
}

function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException && error.name === 'AbortError') || (error instanceof Error && error.name === 'AbortError')
}

function shouldIgnoreStreamClose(error: unknown, controller: AbortController): boolean {
  return controller.signal.aborted || pageUnloading || isAbortError(error)
}

function ensurePageLifecycleListeners(): void {
  if (pageLifecycleInstalled || typeof window === 'undefined') return
  pageLifecycleInstalled = true
  window.addEventListener('pagehide', markPageUnloading)
  window.addEventListener('beforeunload', markPageUnloading)
  window.addEventListener('pageshow', clearPageUnloading)
}

function markPageUnloading(): void {
  pageUnloading = true
  if (pageUnloadResetTimer !== undefined) globalThis.clearTimeout(pageUnloadResetTimer)
  // A beforeunload handler elsewhere can cancel navigation; recover if the page stays alive.
  pageUnloadResetTimer = globalThis.setTimeout(() => {
    pageUnloading = false
    pageUnloadResetTimer = undefined
  }, 5_000)
}

function clearPageUnloading(): void {
  if (pageUnloadResetTimer !== undefined) {
    globalThis.clearTimeout(pageUnloadResetTimer)
    pageUnloadResetTimer = undefined
  }
  pageUnloading = false
}
