import { ErrorCode } from '../../../shared/error-codes'
import {
  errorResponseCode,
  GatewayResponseError,
  gatewayResponseErrorFromBody,
  isRuntimeScopeMismatchError,
} from '../gatewayResponseError'
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
// Prompt admission may cold-start the agent runtime and load plugins before it
// can return its 202 receipt. Keep state/stream recovery bounded tightly, but
// give commands enough time to finish admission instead of rolling back an
// accepted prompt after the client-side deadline.
const DEFAULT_COMMAND_TIMEOUT_MS = 60_000
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
  /** Addressed AgentGateway owner for this session. */
  agentTypeId: string
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
  // Per-attempt timeout for /state and event-stream connection fetches.
  // Defaults to DEFAULT_REQUEST_TIMEOUT_MS; exposed mainly for tests.
  requestTimeoutMs?: number
  // Per-attempt timeout for command fetches. Defaults to
  // DEFAULT_COMMAND_TIMEOUT_MS; exposed mainly for tests.
  commandTimeoutMs?: number
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
  suspended: boolean
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
  private readonly commandTimeoutMs: number
  private generation = 0
  private streamRunId = 0
  private reconnectAttempt = 0
  private started = false
  private suspended = false
  private disposed = false
  private streamAbortController?: AbortController
  private reconnectTimer?: ReconnectTimer
  private readonly fetchControllers = new Set<AbortController>()
  private readonly recentEventTypes: string[] = []
  private gapCount = 0
  private largeStateWarning?: RemotePiSessionLargeStateWarning

  constructor(private readonly options: RemotePiSessionOptions) {
    ensurePageLifecycleListeners()
    this.apiBaseUrl = options.apiBaseUrl?.replace(/\/$/, '') ?? ''
    this.storageScope = options.storageScope ?? ''
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.setTimeoutFn = options.setTimeoutFn ?? globalThis.setTimeout
    this.clearTimeoutFn = options.clearTimeoutFn ?? globalThis.clearTimeout
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS
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
      suspended: this.suspended,
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
    if (this.disposed || this.suspended || this.started) return Promise.resolve()
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
    if (!this.disposed) {
      this.store.dispatch({ type: 'optimistic-user-message', message: toOptimisticUserMessage(payload) }, { flush: true })
    }
    if (!this.started && !this.suspended) await this.start(this.store.getState().lastSeq)
    else if (!this.suspended) this.ensureReconnectScheduled()
    try {
      const receipt = await this.postCommand('/prompt', payload, PromptReceiptSchema)
      return receipt
    } catch (error) {
      this.rollbackOptimisticMessage(payload.clientNonce)
      throw error
    }
  }

  async followUp(payload: FollowUpPayload): Promise<FollowUpReceipt> {
    if (!this.disposed) {
      this.store.dispatch({ type: 'optimistic-user-message', message: toOptimisticUserMessage(payload) }, { flush: true })
    }
    if (!this.started && !this.suspended) await this.start(this.store.getState().lastSeq)
    else if (!this.suspended) this.ensureReconnectScheduled()
    try {
      const receipt = await this.postCommand('/followup', payload, FollowUpReceiptSchema)
      return receipt
    } catch (error) {
      this.rollbackOptimisticMessage(payload.clientNonce)
      throw error
    }
  }

  async clearQueue(payload: QueueClearPayload = {}): Promise<QueueClearReceipt> {
    let receipt: QueueClearReceipt
    try {
      receipt = await this.postCommand('/queue/clear', payload, QueueClearReceiptSchema)
    } catch (error) {
      if (error instanceof GatewayResponseError) throw error
      receipt = await this.postCommand('/queue/clear', payload, QueueClearReceiptSchema)
    }
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

  suspendStream(): void {
    if (this.disposed || this.suspended) return
    this.suspended = true
    this.started = false
    this.streamRunId += 1
    this.clearReconnectTimer()
    this.abortEventStream()
    this.store.dispatch({ type: 'connection-state', state: 'suspended' }, { flush: true })
  }

  resumeStream(): void {
    if (this.disposed || (!this.suspended && this.started)) return
    this.suspended = false
    this.started = true
    const generation = this.generation
    const state = this.store.getState()
    if (!state.hydrated) {
      void this.hydrateAndConnect(generation)
      return
    }
    this.store.dispatch({ type: 'connection-state', state: 'connecting' }, { flush: true })
    void this.connectEvents(state.lastSeq, generation)
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
    const hydrationRunId = this.streamRunId
    if (!this.isHydrationActive(generation, hydrationRunId)) return
    this.clearReconnectTimer()
    this.abortEventStream()
    this.store.dispatch({ type: 'connection-state', state: this.store.getState().hydrated ? 'reconnecting' : 'connecting' }, { flush: true })

    try {
      const headers = await this.requestHeaders()
      if (!this.isHydrationActive(generation, hydrationRunId)) return
      const responseBody = await this.fetchJson(this.stateUrl(), { method: 'GET', headers })
      if (!this.isHydrationActive(generation, hydrationRunId)) return
      const raw = addressedSnapshot(responseBody)

      this.recordLargeStateWarning(raw)

      if (readProtocolVersion(raw) !== SUPPORTED_PROTOCOL_VERSION) {
        this.dispatchProtocolError(`Unsupported Pi chat protocol version: ${String(readProtocolVersion(raw) ?? 'missing')}`)
        return
      }

      const snapshot = PiChatSnapshotSchema.parse(raw)
      if (!this.isHydrationActive(generation, hydrationRunId)) return
      this.store.dispatch({ type: 'hydrate', snapshot, allowSeqRewind: options?.allowSeqRewind }, { flush: true })
      this.connectEvents(snapshot.seq, generation)
    } catch (error) {
      if (!this.isHydrationActive(generation, hydrationRunId) || isAbortError(error)) return
      if (isRuntimeScopeMismatchError(error)) {
        this.dispatchTerminalSessionError(error)
        return
      }
      this.dispatchProtocolError(errorMessage(error, 'Failed to hydrate Pi chat session state.'))
      this.scheduleReconnect(generation)
    }
  }

  private connectEvents(cursor: number, generation: number): Promise<void> {
    if (!this.isStreamLifecycleActive(generation)) return Promise.resolve()
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
      const response = await this.fetchImpl(this.eventsUrl(cursor), {
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
        const responseError = gatewayResponseErrorFromBody(
          response.status,
          body,
          `Pi chat event stream failed with HTTP ${response.status}.`,
          'events',
        )
        if (isRuntimeScopeMismatchError(responseError)) {
          this.dispatchTerminalSessionError(responseError)
        } else {
          this.dispatchProtocolError(responseError.message)
          this.scheduleReconnect(generation)
        }
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
    if (!this.isStreamLifecycleActive(generation)) return
    this.streamRunId += 1
    this.abortEventStream()
    void this.hydrateAndConnect(generation, options)
  }

  private ensureReconnectScheduled(): void {
    if (!this.isStreamLifecycleActive(this.generation)) return
    const state = this.store.getState()
    if (state.connection.state === 'connected' || state.connection.state === 'connecting') return
    if (this.reconnectTimer !== undefined) return
    void this.hydrateAndConnect(this.generation)
  }

  private scheduleReconnect(generation: number): void {
    if (!this.isStreamLifecycleActive(generation)) return
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
        if (!this.isStreamLifecycleActive(generation)) return
        const state = this.store.getState()
        if (state.hydrated) this.connectEvents(state.lastSeq, generation)
        else void this.hydrateAndConnect(generation)
      },
    })
  }

  private async postCommand<TReceipt>(path: string, payload: unknown, schema: ReceiptSchema<TReceipt>): Promise<TReceipt> {
    const generation = this.generation
    if (!this.isGenerationActive(generation)) throw abortError('Remote Pi session disposed before command send.')
    const headers = await this.requestHeaders()
    if (!this.isGenerationActive(generation)) throw abortError('Remote Pi session disposed before command send.')
    const raw = await this.fetchJson(this.sessionUrl(path), {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(this.addressedCommandPayload(path, payload)),
    }, this.commandTimeoutMs)
    if (!this.isGenerationActive(generation)) {
      throw abortError('Remote Pi session disposed before command receipt.')
    }
    return schema.parse(this.addressedCommandReceipt(path, raw))
  }

  private addressedCommandReceipt(path: string, receipt: unknown): unknown {
    if (path !== '/followup' || typeof receipt !== 'object' || receipt === null) {
      return receipt
    }
    const record = receipt as Record<string, unknown>
    return record.disposition === 'followup' ? { ...record, queued: true } : receipt
  }

  private rollbackOptimisticMessage(clientNonce: string): void {
    if (this.disposed) return
    this.store.dispatch({ type: 'remove-optimistic-user-message', clientNonce }, { flush: true })
  }

  private async fetchJson(url: string, init: RequestInit, timeoutMs = this.requestTimeoutMs): Promise<unknown> {
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
    }, timeoutMs)
    try {
      const response = await this.fetchImpl(url, { ...init, signal: controller.signal })
      const body = await safeReadJson(response)
      if (!response.ok) throw gatewayResponseErrorFromBody(response.status, body, `HTTP ${response.status}`, url)
      return body
    } catch (error) {
      // Distinguish our own timeout abort from a dispose-driven abort: a
      // dispose abort must stay an (ignored) AbortError, but a timeout should
      // throw a real error so the caller's catch reaches scheduleReconnect.
      if (timedOut) throw new Error(`Request to ${url} timed out after ${timeoutMs}ms.`)
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

  private eventsUrl(cursor: number): string {
    return buildPiChatEventsUrl({
      apiBaseUrl: this.apiBaseUrl,
      agentTypeId: this.options.agentTypeId,
      sessionId: this.options.sessionId,
      cursor,
    })
  }

  private sessionUrl(path: string): string {
    return `${this.apiBaseUrl}/api/v1/agents/${encodeURIComponent(this.options.agentTypeId)}/sessions/${encodeURIComponent(this.options.sessionId)}${path}`
  }

  private addressedCommandPayload(path: string, payload: unknown): unknown {
    if (typeof payload !== 'object' || payload === null) return payload
    const record = payload as Record<string, unknown>
    if (typeof record.requestId === 'string' && record.requestId.length > 0) return payload
    if (path === '/prompt' && typeof record.clientNonce === 'string' && typeof record.message === 'string') {
      const { message, displayMessage, ...gatewayFields } = record
      return {
        ...gatewayFields,
        requestId: record.clientNonce,
        content: message,
        ...(typeof displayMessage === 'string' ? { displayContent: displayMessage } : {}),
      }
    }
    if (
      path === '/queue/clear'
      && (typeof record.clientNonce === 'string' || typeof record.clientSeq === 'number')
    ) {
      return {
        ...record,
        requestId: `queue-clear:${typeof record.clientNonce === 'string' ? record.clientNonce : ''}:${typeof record.clientSeq === 'number' ? record.clientSeq : ''}`,
      }
    }
    if (
      path === '/followup'
      && typeof record.clientNonce === 'string'
      && typeof record.clientSeq === 'number'
      && typeof record.message === 'string'
    ) {
      const { message, displayMessage, ...gatewayFields } = record
      return {
        ...gatewayFields,
        requestId: `${record.clientNonce}:${record.clientSeq}`,
        content: message,
        ...(typeof displayMessage === 'string' ? { displayContent: displayMessage } : {}),
      }
    }
    return payload
  }

  private dispatchProtocolError(message: string): void {
    if (this.disposed) return
    const error: ChatError = { code: ErrorCode.enum.INTERNAL_ERROR, message, retryable: true }
    this.store.dispatch({ type: 'protocol-error', error }, { flush: true })
  }

  private dispatchTerminalSessionError(error: unknown): void {
    if (this.disposed) return
    const errorCode = errorResponseCode(error)
    if (!errorCode) {
      this.dispatchProtocolError(errorMessage(error, 'Chat session is unavailable.'))
      return
    }
    this.suspendStream()
    this.store.dispatch({
      type: 'terminal-session-error',
      message: errorMessage(error, 'Chat session is unavailable.'),
      errorCode,
    }, { flush: true })
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

  private isStreamLifecycleActive(generation: number): boolean {
    return !this.suspended && this.isGenerationActive(generation)
  }

  private isHydrationActive(generation: number, runId: number): boolean {
    return this.isStreamLifecycleActive(generation) && runId === this.streamRunId
  }

  private isStreamActive(generation: number, runId: number): boolean {
    return this.isStreamLifecycleActive(generation) && runId === this.streamRunId
  }
}

function addressedSnapshot(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || !('state' in value)) {
    throw new Error('Addressed session state response did not include state.')
  }
  return (value as { state: unknown }).state
}

export function createRemotePiSession(options: RemotePiSessionOptions): RemotePiSession {
  return new RemotePiSession(options)
}

/**
 * Extract a stable shared or AgentGateway server error code from a rejected chat
 * operation. Hosts use it to attach recovery actions without parsing error text.
 */
export function piChatErrorCode(error: unknown): string | undefined {
  return errorResponseCode(error)
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
