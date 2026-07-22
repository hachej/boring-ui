import { ErrorCode } from '../../../shared/error-codes'
import type { PromptPayload, PromptReceipt } from '../../../shared/chat'
import { PromptNewSessionReceiptSchema, type PromptNewSessionReceipt } from '../../../shared/chat'
import type { SessionSummary } from '../../../shared/session'

export interface EphemeralSessionRequest {
  apiBaseUrl?: string
  storageScope?: string
  fetch: typeof globalThis.fetch
  requestTimeoutMs?: number
  headers?: Record<string, string | undefined> | (() => Record<string, string | undefined> | Promise<Record<string, string | undefined>>)
}

export interface FailedEphemeralDraft {
  id: string
  sessionId: string
  draft: string
  attachments: NonNullable<PromptPayload['attachments']>
  error: { code: string; message: string; retryable: true }
}

export type EphemeralSessionPhase =
  | { type: 'local' }
  | { type: 'starting'; idempotencyKey: string; payload: PromptPayload; retry: boolean; inFlight: Promise<PromptNewSessionReceipt> }
  | { type: 'retryable'; idempotencyKey: string; payload: PromptPayload }
  | { type: 'adopted'; receipt: PromptNewSessionReceipt }
  | { type: 'failed'; receipt: Extract<PromptNewSessionReceipt, { accepted: false }>; recovery: FailedEphemeralDraft }

export interface EphemeralSessionAdoption {
  localId: string
  session: SessionSummary
  receipt: PromptNewSessionReceipt
}

export type EphemeralSessionListener = (adoption: EphemeralSessionAdoption) => void

interface EphemeralSessionEntry {
  phase: EphemeralSessionPhase
  request?: EphemeralSessionRequest
  discarded?: boolean
}

/** Public structural contract for hosts that retain coordinator state across panes. */
export interface EphemeralSessionCoordinatorApi {
  register(localId: string): void
  discard(localId: string): Promise<void>
  discardNativeSession(sessionId: string): void
  isEphemeralSession(localId: string): boolean
  phase(localId: string): EphemeralSessionPhase | undefined
  failedDraft(sessionId: string | undefined): FailedEphemeralDraft | undefined
  clearFailedDraft(sessionId: string | undefined): void
  subscribe(listener: EphemeralSessionListener): () => void
  subscribeState(listener: () => void): () => void
  start(localId: string, payload: PromptPayload, request: EphemeralSessionRequest): Promise<PromptNewSessionReceipt>
  dispose(): void
}

/**
 * Request-scope owner for a browser-local session's single first-send transaction.
 * RemotePiSession instances are disposable views; this coordinator is not.
 */
export class EphemeralSessionCoordinator implements EphemeralSessionCoordinatorApi {
  private readonly entries = new Map<string, EphemeralSessionEntry>()
  private readonly listeners = new Set<EphemeralSessionListener>()
  private readonly stateListeners = new Set<() => void>()
  private recoveryVersion = 0
  private disposed = false

  constructor(readonly requestScope: string) {}

  register(localId: string): void {
    if (this.disposed || this.entries.has(localId)) return
    this.entries.set(localId, { phase: { type: 'local' } })
  }

  async discard(localId: string): Promise<void> {
    const entry = this.entries.get(localId)
    if (!entry) return
    entry.discarded = true
    try {
      const receipt = await this.resolveDiscardReceipt(localId, entry)
      if (receipt && entry.request) await this.deleteNativeSession(receipt.nativeSessionId, entry.request)
    } finally {
      if (this.entries.get(localId) === entry) this.entries.delete(localId)
      this.notifyState()
    }
  }

  discardNativeSession(sessionId: string): void {
    for (const [localId, entry] of this.entries) {
      const receipt = entry.phase.type === 'adopted' || entry.phase.type === 'failed'
        ? entry.phase.receipt
        : undefined
      if (receipt?.nativeSessionId !== sessionId) continue
      this.entries.delete(localId)
      this.notifyState()
      return
    }
  }

  isEphemeralSession(localId: string): boolean {
    const phase = this.entries.get(localId)?.phase
    return phase?.type === 'local' || phase?.type === 'starting' || phase?.type === 'retryable'
  }

  phase(localId: string): EphemeralSessionPhase | undefined {
    return this.entries.get(localId)?.phase
  }

  failedDraft(sessionId: string | undefined): FailedEphemeralDraft | undefined {
    if (!sessionId) return undefined
    for (const entry of this.entries.values()) {
      if (entry.phase.type === 'failed' && entry.phase.recovery.sessionId === sessionId) return entry.phase.recovery
    }
    return undefined
  }

  clearFailedDraft(sessionId: string | undefined): void {
    if (!sessionId) return
    for (const entry of this.entries.values()) {
      if (entry.phase.type !== 'failed' || entry.phase.recovery.sessionId !== sessionId) continue
      entry.phase = { type: 'adopted', receipt: entry.phase.receipt }
      this.notifyState()
      return
    }
  }

  subscribe(listener: EphemeralSessionListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  subscribeState(listener: () => void): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  async start(localId: string, payload: PromptPayload, request: EphemeralSessionRequest): Promise<PromptNewSessionReceipt> {
    if (this.disposed) throw new Error('ephemeral session coordinator is disposed')
    this.register(localId)
    const entry = this.entries.get(localId)!
    if (entry.phase.type === 'starting') return entry.phase.inFlight
    if (entry.phase.type === 'adopted' || entry.phase.type === 'failed') return entry.phase.receipt

    const idempotencyKey = entry.phase.type === 'retryable' ? entry.phase.idempotencyKey : nativeSessionStartKey()
    const startPayload = entry.phase.type === 'retryable' ? entry.phase.payload : payload
    const retry = entry.phase.type === 'retryable'
    entry.request = request
    const inFlight = this.post(startPayload, { ...request, idempotencyKey, retry }).then((receipt) => {
      if (this.disposed || this.entries.get(localId) !== entry || entry.discarded) return receipt
      if (receipt.accepted) {
        entry.phase = { type: 'adopted', receipt }
      } else {
        entry.phase = {
          type: 'failed',
          receipt,
          recovery: {
            id: `${localId}:${++this.recoveryVersion}`,
            sessionId: receipt.nativeSessionId,
            draft: startPayload.displayMessage ?? startPayload.message,
            attachments: startPayload.attachments ?? [],
            error: receipt.error,
          },
        }
      }
      this.notify({ localId, session: receipt.session, receipt })
      this.notifyState()
      return receipt
    }).catch((error) => {
      if (!this.disposed && this.entries.get(localId) === entry && entry.phase.type === 'starting' && entry.phase.inFlight === inFlight) {
        entry.phase = { type: 'retryable', idempotencyKey, payload: startPayload }
        this.notifyState()
      }
      throw error
    })
    entry.phase = { type: 'starting', idempotencyKey, payload: startPayload, retry, inFlight }
    return inFlight
  }

  /** Attach this owner to its request-scope lifecycle. */
  activate(): void {
    this.disposed = false
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.listeners.clear()
    this.stateListeners.clear()
    this.entries.clear()
  }

  private async resolveDiscardReceipt(
    localId: string,
    entry: EphemeralSessionEntry,
  ): Promise<PromptNewSessionReceipt | undefined> {
    if (!entry.request || entry.phase.type === 'local') return undefined
    if (entry.phase.type === 'adopted' || entry.phase.type === 'failed') return entry.phase.receipt
    if (entry.phase.type === 'retryable') return this.start(localId, entry.phase.payload, entry.request)
    try {
      return await entry.phase.inFlight
    } catch (error) {
      // A lost response may already have persisted Pi's transcript. Replay the
      // retained key once to resolve that durable outcome before deletion.
      const retryPhase = this.entries.get(localId)?.phase
      if (retryPhase?.type === 'retryable') return this.start(localId, retryPhase.payload, entry.request)
      throw error
    }
  }

  private notify(adoption: EphemeralSessionAdoption): void {
    for (const listener of this.listeners) listener(adoption)
  }

  private notifyState(): void {
    for (const listener of this.stateListeners) listener()
  }

  private async deleteNativeSession(sessionId: string, request: EphemeralSessionRequest): Promise<void> {
    const headers = await requestHeaders(request)
    const apiBaseUrl = request.apiBaseUrl?.replace(/\/$/, '') ?? ''
    const response = await request.fetch(`${apiBaseUrl}/api/v1/agent/pi-chat/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      headers,
    })
    if (!response.ok && response.status !== 404) throw nativeStartHttpError(response.status, await safeReadJson(response))
  }

  private async post(
    payload: PromptPayload,
    options: EphemeralSessionRequest & { idempotencyKey: string; retry: boolean },
  ): Promise<PromptNewSessionReceipt> {
    const headers = await requestHeaders(options)
    const apiBaseUrl = options.apiBaseUrl?.replace(/\/$/, '') ?? ''
    const url = `${apiBaseUrl}/api/v1/agent/pi-chat/sessions/native-prompt`
    const controller = new AbortController()
    let timedOut = false
    const timeout = options.requestTimeoutMs === undefined
      ? undefined
      : globalThis.setTimeout(() => {
        timedOut = true
        controller.abort()
      }, options.requestTimeoutMs)
    try {
      const response = await options.fetch(url, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          nativeSessionStart: { idempotencyKey: options.idempotencyKey, retry: options.retry },
        }),
        signal: controller.signal,
      })
      const body = await safeReadJson(response)
      if (!response.ok) throw nativeStartHttpError(response.status, body)
      return PromptNewSessionReceiptSchema.parse(body)
    } catch (error) {
      if (timedOut) throw new Error(`Request to ${url} timed out after ${options.requestTimeoutMs}ms.`)
      throw error
    } finally {
      if (timeout !== undefined) globalThis.clearTimeout(timeout)
    }
  }
}

export class NativePromptFailedError extends Error {
  readonly errorCode: string
  readonly retryable = true

  constructor(readonly failure: Extract<PromptNewSessionReceipt, { accepted: false }>['error']) {
    super(failure.message)
    this.errorCode = failure.code
  }
}

function nativeSessionStartKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `native-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

async function safeReadJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return undefined
  try { return JSON.parse(text) } catch { return undefined }
}

function nativeStartHttpError(status: number, body: unknown): Error {
  const payload = typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'object'
    ? (body as { error: Record<string, unknown> }).error
    : body as Record<string, unknown> | undefined
  const code = ErrorCode.safeParse(payload?.code)
  const error = Object.assign(new Error(typeof payload?.message === 'string' ? payload.message : `HTTP ${status}`), { status, errorCode: code.success ? code.data : undefined })
  return error
}

async function requestHeaders(request: EphemeralSessionRequest): Promise<Record<string, string>> {
  const rawHeaders = typeof request.headers === 'function' ? await request.headers() : request.headers
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(rawHeaders ?? {})) {
    if (typeof value === 'string') headers[key] = value
  }
  if (request.storageScope && !hasHeader(headers, 'x-boring-storage-scope')) headers['x-boring-storage-scope'] = request.storageScope
  return headers
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name)
}
