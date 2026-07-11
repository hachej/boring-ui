import { timingSafeEqual } from 'node:crypto'

import type { ExecOptions, ExecResult, WorkspaceChangeEvent } from '../contracts'
import {
  REMOTE_WORKER_ERROR_CODES,
  REMOTE_WORKER_PROVIDER,
  WORKER_INTERNAL_TOKEN_HEADER,
  WORKER_REQUEST_ID_HEADER,
  WORKER_WORKSPACE_ID_HEADER,
  type RemoteWorkerErrorPayload,
  type RemoteWorkerExecRequest,
  type RemoteWorkerExecResponse,
  type RemoteWorkerFsEventEnvelope,
  type RemoteWorkerWorkspaceOp,
  type RemoteWorkerWorkspaceResult,
} from '../../shared/remoteWorkerProtocol'

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_EXEC_TIMEOUT_MS = 30_000
const DEFAULT_EXEC_REQUEST_GRACE_MS = 10_000

export interface RemoteWorkerClientOptions {
  baseUrl: string
  token: string
  workspaceId: string
  requestId?: string
  fetchImpl?: typeof fetch
  requestTimeoutMs?: number
  execTimeoutMs?: number
  execRequestGraceMs?: number
}

export class RemoteWorkerClientError extends Error {
  readonly statusCode: number
  readonly code: string
  readonly details?: unknown

  constructor(message: string, opts: { statusCode: number; code?: string; details?: unknown }) {
    super(message)
    this.name = 'RemoteWorkerClientError'
    this.statusCode = opts.statusCode
    this.code = opts.code ?? 'remote_worker_error'
    this.details = opts.details
  }
}

function requireNonEmpty(value: string, label: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${label} is required for ${REMOTE_WORKER_PROVIDER} mode`)
  return trimmed
}

function normalizeBaseUrl(value: string): string {
  return requireNonEmpty(value, 'BORING_WORKER_BASE_URL').replace(/\/+$/, '')
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive integer`)
  return Math.trunc(value)
}

function encodeWorkspaceId(workspaceId: string): string {
  return encodeURIComponent(requireNonEmpty(workspaceId, 'workspaceId'))
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function base64ToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'))
}

function makeHeaders(opts: { token: string; workspaceId: string; requestId?: string; contentType?: string }): Headers {
  const headers = new Headers()
  headers.set(WORKER_INTERNAL_TOKEN_HEADER, requireNonEmpty(opts.token, 'BORING_WORKER_INTERNAL_TOKEN'))
  headers.set(WORKER_WORKSPACE_ID_HEADER, requireNonEmpty(opts.workspaceId, 'workspaceId'))
  if (opts.requestId) headers.set(WORKER_REQUEST_ID_HEADER, opts.requestId)
  if (opts.contentType) headers.set('content-type', opts.contentType)
  return headers
}

async function parseError(response: Response): Promise<RemoteWorkerClientError> {
  let payload: RemoteWorkerErrorPayload | undefined
  try {
    payload = await response.json() as RemoteWorkerErrorPayload
  } catch {
    // ignore non-json errors
  }
  return new RemoteWorkerClientError(
    payload?.error?.message ?? `remote worker request failed (${response.status})`,
    {
      statusCode: payload?.error?.statusCode ?? response.status,
      code: payload?.error?.code,
      details: payload?.error?.details,
    },
  )
}

export class RemoteWorkerClient {
  private readonly baseUrl: string
  private readonly token: string
  private readonly workspaceId: string
  private readonly requestId?: string
  private readonly fetchImpl: typeof fetch
  private readonly requestTimeoutMs: number
  private readonly execTimeoutMs: number
  private readonly execRequestGraceMs: number

  constructor(opts: RemoteWorkerClientOptions) {
    this.baseUrl = normalizeBaseUrl(opts.baseUrl)
    this.token = requireNonEmpty(opts.token, 'BORING_WORKER_INTERNAL_TOKEN')
    this.workspaceId = requireNonEmpty(opts.workspaceId, 'workspaceId')
    this.requestId = opts.requestId
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.requestTimeoutMs = positiveInteger(opts.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, 'requestTimeoutMs')
    this.execTimeoutMs = positiveInteger(opts.execTimeoutMs, DEFAULT_EXEC_TIMEOUT_MS, 'execTimeoutMs')
    this.execRequestGraceMs = positiveInteger(opts.execRequestGraceMs, DEFAULT_EXEC_REQUEST_GRACE_MS, 'execRequestGraceMs')
  }

  private timeoutError(timeoutMs: number): RemoteWorkerClientError {
    return new RemoteWorkerClientError('remote worker request timed out', {
      statusCode: 504,
      code: REMOTE_WORKER_ERROR_CODES.TIMEOUT,
      details: { timeoutMs, retryable: true },
    })
  }

  private abortedError(): RemoteWorkerClientError {
    return new RemoteWorkerClientError('remote worker request aborted', {
      statusCode: 499,
      code: REMOTE_WORKER_ERROR_CODES.ABORTED,
    })
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    const upstreamSignal = init.signal
    const abortFromUpstream = (): void => controller.abort()

    if (upstreamSignal?.aborted) {
      clearTimeout(timer)
      throw this.abortedError()
    }
    upstreamSignal?.addEventListener('abort', abortFromUpstream, { once: true })

    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal })
    } catch (error) {
      if (timedOut) throw this.timeoutError(timeoutMs)
      if (upstreamSignal?.aborted) throw this.abortedError()
      throw error
    } finally {
      clearTimeout(timer)
      upstreamSignal?.removeEventListener('abort', abortFromUpstream)
    }
  }

  async health(): Promise<void> {
    const response = await this.fetchWithTimeout(`${this.baseUrl}/internal/health`, {
      headers: makeHeaders({ token: this.token, workspaceId: this.workspaceId, requestId: this.requestId }),
    }, this.requestTimeoutMs)
    if (!response.ok) throw await parseError(response)
  }

  async workspace(op: RemoteWorkerWorkspaceOp): Promise<RemoteWorkerWorkspaceResult> {
    const response = await this.fetchWithTimeout(`${this.baseUrl}/internal/workspaces/${encodeWorkspaceId(this.workspaceId)}/fs`, {
      method: 'POST',
      headers: makeHeaders({ token: this.token, workspaceId: this.workspaceId, requestId: this.requestId, contentType: 'application/json' }),
      body: JSON.stringify(op),
    }, this.requestTimeoutMs)
    if (!response.ok) throw await parseError(response)
    return await response.json() as RemoteWorkerWorkspaceResult
  }

  async exec(input: RemoteWorkerExecRequest, opts: Pick<ExecOptions, 'signal'> = {}): Promise<ExecResult> {
    const timeoutMs = (input.timeoutMs ?? this.execTimeoutMs) + this.execRequestGraceMs
    const response = await this.fetchWithTimeout(`${this.baseUrl}/internal/workspaces/${encodeWorkspaceId(this.workspaceId)}/exec`, {
      method: 'POST',
      headers: makeHeaders({ token: this.token, workspaceId: this.workspaceId, requestId: this.requestId, contentType: 'application/json' }),
      body: JSON.stringify(input),
      signal: opts.signal,
    }, timeoutMs)
    if (!response.ok) throw await parseError(response)
    const body = await response.json() as RemoteWorkerExecResponse
    return {
      stdout: base64ToBytes(body.stdoutBase64),
      stderr: base64ToBytes(body.stderrBase64),
      exitCode: body.exitCode,
      durationMs: body.durationMs,
      truncated: body.truncated,
      stdoutEncoding: body.stdoutEncoding,
      stderrEncoding: body.stderrEncoding,
    }
  }

  watch(onEvent: (event: WorkspaceChangeEvent) => void, onError?: (error: Error) => void): { close(): void } {
    const controller = new AbortController()
    void this.consumeEvents(controller.signal, onEvent).catch((error) => {
      if (!controller.signal.aborted) onError?.(error instanceof Error ? error : new Error(String(error)))
    })
    return { close: () => controller.abort() }
  }

  private async consumeEvents(signal: AbortSignal, onEvent: (event: WorkspaceChangeEvent) => void): Promise<void> {
    const response = await this.fetchImpl(`${this.baseUrl}/internal/workspaces/${encodeWorkspaceId(this.workspaceId)}/fs/events`, {
      headers: makeHeaders({ token: this.token, workspaceId: this.workspaceId, requestId: this.requestId }),
      signal,
    })
    if (!response.ok) throw await parseError(response)
    if (!response.body) throw new RemoteWorkerClientError('remote worker event stream missing body', { statusCode: 502 })

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) {
          if (signal.aborted) return
          throw new RemoteWorkerClientError('remote worker event stream closed', {
            statusCode: 502,
            code: REMOTE_WORKER_ERROR_CODES.STREAM_CLOSED,
          })
        }
        buffer += decoder.decode(value, { stream: true })
        let boundary = buffer.indexOf('\n\n')
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          this.handleSseFrame(frame, onEvent)
          boundary = buffer.indexOf('\n\n')
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  private handleSseFrame(frame: string, onEvent: (event: WorkspaceChangeEvent) => void): void {
    let eventName = 'message'
    const dataLines: string[] = []
    for (const line of frame.split('\n')) {
      if (line.startsWith(':')) continue
      if (line.startsWith('event:')) eventName = line.slice('event:'.length).trim()
      if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trimStart())
    }
    if (eventName !== 'change' || dataLines.length === 0) return
    const payload = JSON.parse(dataLines.join('\n')) as RemoteWorkerFsEventEnvelope
    onEvent(payload.event)
  }
}

export function encodeBytesForWorker(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
}

export function decodeBytesFromWorker(value: string): Uint8Array {
  return base64ToBytes(value)
}

export function constantTimeTokenEqual(a: string, b: string): boolean {
  if (!a || !b) return false
  const aBytes = Buffer.from(a)
  const bBytes = Buffer.from(b)
  if (aBytes.length !== bBytes.length) return false
  return timingSafeEqual(aBytes, bBytes)
}
