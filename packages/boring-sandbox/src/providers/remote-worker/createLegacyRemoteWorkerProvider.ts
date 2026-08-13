import type {
  Entry,
  ExecOptions,
  ExecResult,
  Sandbox,
  Stat,
  Workspace,
} from '@hachej/boring-agent/shared'

import { PROVIDER_CAPABILITIES, PROVIDER_CONTRACT_VERSION } from '../../shared/providerMatrix'
import type { SandboxProviderV1, WorkspaceSandboxPairV1 } from '../../shared/providerV1'
import { getEnv } from '../runtimeSupport'

export const LEGACY_REMOTE_WORKER_RUNTIME_CWD = '/workspace'
export const LEGACY_WORKER_INTERNAL_TOKEN_HEADER = 'x-boring-internal-token'
export const LEGACY_WORKER_WORKSPACE_ID_HEADER = 'x-boring-workspace-id'
export const LEGACY_WORKER_REQUEST_ID_HEADER = 'x-boring-request-id'

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_EXEC_TIMEOUT_MS = 30_000
const DEFAULT_EXEC_REQUEST_GRACE_MS = 10_000

export interface LegacyRemoteWorkerProviderOptions {
  baseUrl?: string
  token?: string
  fetchImpl?: typeof fetch
  requestTimeoutMs?: number
  execTimeoutMs?: number
  execRequestGraceMs?: number
}

export interface LegacyRemoteWorkerClientOptions extends LegacyRemoteWorkerProviderOptions {
  baseUrl: string
  token: string
  workspaceId: string
  requestId?: string
}

type LegacyRemoteWorkerWorkspaceOp =
  | { op: 'readFile'; path: string }
  | { op: 'readBinaryFile'; path: string }
  | { op: 'writeFile'; path: string; data: string }
  | { op: 'writeBinaryFile'; path: string; dataBase64: string }
  | { op: 'readFileWithStat'; path: string }
  | { op: 'writeFileWithStat'; path: string; data: string }
  | { op: 'writeBinaryFileWithStat'; path: string; dataBase64: string }
  | { op: 'unlink'; path: string }
  | { op: 'readdir'; path: string }
  | { op: 'stat'; path: string }
  | { op: 'mkdir'; path: string; recursive?: boolean }
  | { op: 'rename'; from: string; to: string }

type LegacyRemoteWorkerWorkspaceResult =
  | { content: string }
  | { dataBase64: string }
  | { stat: Stat }
  | { content: string; stat: Stat }
  | { entries: Entry[] }
  | { ok: true }

interface LegacyRemoteWorkerExecRequest {
  cmd: string
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
  maxOutputBytes?: number
}

interface LegacyRemoteWorkerExecResponse extends Omit<ExecResult, 'stdout' | 'stderr'> {
  stdoutBase64: string
  stderrBase64: string
}

interface LegacyRemoteWorkerErrorPayload {
  error?: { code?: string; message?: string; statusCode?: number; details?: unknown }
}

type LegacyWorkspaceWatcher = ReturnType<NonNullable<Workspace['watch']>>
type LegacyWorkspaceChangeListener = Parameters<LegacyWorkspaceWatcher['subscribe']>[0]
type LegacyWorkspaceChangeEvent = Parameters<LegacyWorkspaceChangeListener>[0]
type LegacyWorkspaceWatchSubscribeOptions = Parameters<LegacyWorkspaceWatcher['subscribe']>[1]

export class LegacyRemoteWorkerClientError extends Error {
  readonly statusCode: number
  readonly code: string
  readonly details?: unknown

  constructor(message: string, options: { statusCode: number; code?: string; details?: unknown }) {
    super(message)
    this.name = 'RemoteWorkerClientError'
    this.statusCode = options.statusCode
    this.code = options.code ?? 'remote_worker_error'
    this.details = options.details
  }
}

function requireNonEmpty(value: string | undefined, label: string): string {
  const trimmed = value?.trim()
  if (!trimmed) throw new Error(`${label} is required for remote-worker mode`)
  return trimmed
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive integer`)
  return Math.trunc(value)
}

function makeHeaders(options: {
  token: string
  workspaceId: string
  requestId?: string
  contentType?: string
}): Headers {
  const headers = new Headers()
  headers.set(LEGACY_WORKER_INTERNAL_TOKEN_HEADER, options.token)
  headers.set(LEGACY_WORKER_WORKSPACE_ID_HEADER, options.workspaceId)
  if (options.requestId) headers.set(LEGACY_WORKER_REQUEST_ID_HEADER, options.requestId)
  if (options.contentType) headers.set('content-type', options.contentType)
  return headers
}

export class LegacyRemoteWorkerClient {
  readonly #baseUrl: string
  readonly #token: string
  readonly #workspaceId: string
  readonly #requestId?: string
  readonly #fetch: typeof fetch
  readonly #requestTimeoutMs: number
  readonly #execTimeoutMs: number
  readonly #execRequestGraceMs: number

  constructor(options: LegacyRemoteWorkerClientOptions) {
    this.#baseUrl = requireNonEmpty(options.baseUrl, 'BORING_WORKER_BASE_URL').replace(/\/+$/, '')
    this.#token = requireNonEmpty(options.token, 'BORING_WORKER_INTERNAL_TOKEN')
    this.#workspaceId = requireNonEmpty(options.workspaceId, 'workspaceId')
    this.#requestId = options.requestId
    this.#fetch = options.fetchImpl ?? fetch
    this.#requestTimeoutMs = positiveInteger(options.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, 'requestTimeoutMs')
    this.#execTimeoutMs = positiveInteger(options.execTimeoutMs, DEFAULT_EXEC_TIMEOUT_MS, 'execTimeoutMs')
    this.#execRequestGraceMs = positiveInteger(options.execRequestGraceMs, DEFAULT_EXEC_REQUEST_GRACE_MS, 'execRequestGraceMs')
  }

  async #request(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    const upstreamSignal = init.signal
    const abort = () => controller.abort()
    if (upstreamSignal?.aborted) {
      clearTimeout(timer)
      throw new LegacyRemoteWorkerClientError('remote worker request aborted', {
        statusCode: 499,
        code: 'ABORTED',
      })
    }
    upstreamSignal?.addEventListener('abort', abort, { once: true })
    try {
      return await this.#fetch(url, { ...init, signal: controller.signal })
    } catch (error) {
      if (timedOut) {
        throw new LegacyRemoteWorkerClientError('remote worker request timed out', {
          statusCode: 504,
          code: 'REMOTE_WORKER_TIMEOUT',
          details: { timeoutMs, retryable: true },
        })
      }
      if (upstreamSignal?.aborted) {
        throw new LegacyRemoteWorkerClientError('remote worker request aborted', {
          statusCode: 499,
          code: 'ABORTED',
        })
      }
      throw error
    } finally {
      clearTimeout(timer)
      upstreamSignal?.removeEventListener('abort', abort)
    }
  }

  async #expectOk(response: Response): Promise<Response> {
    if (response.ok) return response
    let payload: LegacyRemoteWorkerErrorPayload | undefined
    try { payload = await response.json() as LegacyRemoteWorkerErrorPayload } catch { /* non-JSON error */ }
    throw new LegacyRemoteWorkerClientError(
      payload?.error?.message ?? `remote worker request failed (${response.status})`,
      {
        statusCode: payload?.error?.statusCode ?? response.status,
        code: payload?.error?.code,
        details: payload?.error?.details,
      },
    )
  }

  #headers(contentType?: string): Headers {
    return makeHeaders({
      token: this.#token,
      workspaceId: this.#workspaceId,
      requestId: this.#requestId,
      contentType,
    })
  }

  async health(): Promise<void> {
    await this.#expectOk(await this.#request(`${this.#baseUrl}/internal/health`, {
      headers: this.#headers(),
    }, this.#requestTimeoutMs))
  }

  async workspace(operation: LegacyRemoteWorkerWorkspaceOp): Promise<LegacyRemoteWorkerWorkspaceResult> {
    const response = await this.#expectOk(await this.#request(
      `${this.#baseUrl}/internal/workspaces/${encodeURIComponent(this.#workspaceId)}/fs`,
      {
        method: 'POST',
        headers: this.#headers('application/json'),
        body: JSON.stringify(operation),
      },
      this.#requestTimeoutMs,
    ))
    return await response.json() as LegacyRemoteWorkerWorkspaceResult
  }

  async exec(input: LegacyRemoteWorkerExecRequest, signal?: AbortSignal): Promise<ExecResult> {
    const timeoutMs = (input.timeoutMs ?? this.#execTimeoutMs) + this.#execRequestGraceMs
    const response = await this.#expectOk(await this.#request(
      `${this.#baseUrl}/internal/workspaces/${encodeURIComponent(this.#workspaceId)}/exec`,
      {
        method: 'POST',
        headers: this.#headers('application/json'),
        body: JSON.stringify(input),
        signal,
      },
      timeoutMs,
    ))
    const body = await response.json() as LegacyRemoteWorkerExecResponse
    return {
      stdout: new Uint8Array(Buffer.from(body.stdoutBase64, 'base64')),
      stderr: new Uint8Array(Buffer.from(body.stderrBase64, 'base64')),
      exitCode: body.exitCode,
      durationMs: body.durationMs,
      truncated: body.truncated,
      stdoutEncoding: body.stdoutEncoding,
      stderrEncoding: body.stderrEncoding,
    }
  }

  watch(onEvent: (event: LegacyWorkspaceChangeEvent) => void, onError: (error: Error) => void): { close(): void } {
    const controller = new AbortController()
    void this.#consumeEvents(controller.signal, onEvent).catch((error) => {
      if (!controller.signal.aborted) onError(error instanceof Error ? error : new Error(String(error)))
    })
    return { close: () => controller.abort() }
  }

  async #consumeEvents(signal: AbortSignal, onEvent: (event: LegacyWorkspaceChangeEvent) => void): Promise<void> {
    const response = await this.#fetch(
      `${this.#baseUrl}/internal/workspaces/${encodeURIComponent(this.#workspaceId)}/fs/events`,
      { headers: this.#headers(), signal },
    )
    await this.#expectOk(response)
    if (!response.body) throw new LegacyRemoteWorkerClientError('remote worker event stream missing body', { statusCode: 502 })
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) {
          if (signal.aborted) return
          throw new LegacyRemoteWorkerClientError('remote worker event stream closed', {
            statusCode: 502,
            code: 'REMOTE_WORKER_STREAM_CLOSED',
          })
        }
        buffer += decoder.decode(value, { stream: true })
        let boundary = buffer.indexOf('\n\n')
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          this.#handleSseFrame(frame, onEvent)
          boundary = buffer.indexOf('\n\n')
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  #handleSseFrame(frame: string, onEvent: (event: LegacyWorkspaceChangeEvent) => void): void {
    let eventName = 'message'
    const dataLines: string[] = []
    for (const line of frame.split('\n')) {
      if (line.startsWith(':')) continue
      if (line.startsWith('event:')) eventName = line.slice('event:'.length).trim()
      if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trimStart())
    }
    if (eventName !== 'change' || dataLines.length === 0) return
    const payload = JSON.parse(dataLines.join('\n')) as { event: LegacyWorkspaceChangeEvent }
    onEvent(payload.event)
  }
}

function expectContent(result: LegacyRemoteWorkerWorkspaceResult): string {
  if ('content' in result && typeof result.content === 'string') return result.content
  throw new Error('remote worker returned invalid file content response')
}

function expectStat(result: LegacyRemoteWorkerWorkspaceResult): Stat {
  if ('stat' in result && result.stat) return result.stat
  throw new Error('remote worker returned invalid stat response')
}

function expectEntries(result: LegacyRemoteWorkerWorkspaceResult): Entry[] {
  if ('entries' in result && Array.isArray(result.entries)) return result.entries
  throw new Error('remote worker returned invalid readdir response')
}

export function encodeLegacyRemoteWorkerBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

export function decodeLegacyRemoteWorkerBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'))
}

export function createLegacyRemoteWorkerWorkspace(
  client: LegacyRemoteWorkerClient,
): Workspace & { closeWatcher(): void } {
  let watcher: LegacyWorkspaceWatcher | null = null
  const listeners = new Map<LegacyWorkspaceChangeListener, LegacyWorkspaceWatchSubscribeOptions>()
  let stream: { close(): void } | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let closed = false
  const clearReconnectTimer = () => {
    if (!reconnectTimer) return
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  const ensureStream = () => {
    if (stream || closed || listeners.size === 0) return
    clearReconnectTimer()
    stream = client.watch(
      (event) => {
        for (const listener of listeners.keys()) {
          try { listener(event) } catch { /* ignore listener errors */ }
        }
      },
      () => {
        stream = null
        for (const options of listeners.values()) {
          try {
            options?.onControlEvent?.({ type: 'resync-required', reason: 'remote_worker_stream_closed' })
          } catch {
            // Ignore listener control-channel errors.
          }
        }
        if (!closed && listeners.size > 0 && !reconnectTimer) {
          reconnectTimer = setTimeout(() => { reconnectTimer = null; ensureStream() }, 1_000)
        }
      },
    )
  }
  watcher = {
    subscribe(listener, options) {
      if (closed) return () => {}
      listeners.set(listener, options)
      ensureStream()
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          clearReconnectTimer()
          stream?.close()
          stream = null
        }
      }
    },
    close() {
      closed = true
      listeners.clear()
      clearReconnectTimer()
      stream?.close()
      stream = null
    },
  }
  const runtimeContext = { runtimeCwd: LEGACY_REMOTE_WORKER_RUNTIME_CWD }
  return {
    root: LEGACY_REMOTE_WORKER_RUNTIME_CWD,
    runtimeContext,
    fsCapability: 'best-effort',
    watch: () => watcher!,
    async readFile(path) { return expectContent(await client.workspace({ op: 'readFile', path })) },
    async readBinaryFile(path) {
      const result = await client.workspace({ op: 'readBinaryFile', path })
      if ('dataBase64' in result) return decodeLegacyRemoteWorkerBytes(result.dataBase64)
      throw new Error('remote worker returned invalid binary response')
    },
    async writeFile(path, data) { await client.workspace({ op: 'writeFile', path, data }) },
    async writeBinaryFile(path, data) {
      await client.workspace({ op: 'writeBinaryFile', path, dataBase64: encodeLegacyRemoteWorkerBytes(data) })
    },
    async readFileWithStat(path) {
      const result = await client.workspace({ op: 'readFileWithStat', path })
      if ('content' in result && 'stat' in result) return { content: result.content, stat: result.stat }
      throw new Error('remote worker returned invalid readFileWithStat response')
    },
    async writeFileWithStat(path, data) { return expectStat(await client.workspace({ op: 'writeFileWithStat', path, data })) },
    async writeBinaryFileWithStat(path, data) {
      return expectStat(await client.workspace({ op: 'writeBinaryFileWithStat', path, dataBase64: encodeLegacyRemoteWorkerBytes(data) }))
    },
    async unlink(path) { await client.workspace({ op: 'unlink', path }) },
    async readdir(path) { return expectEntries(await client.workspace({ op: 'readdir', path })) },
    async stat(path) { return expectStat(await client.workspace({ op: 'stat', path })) },
    async mkdir(path, options) { await client.workspace({ op: 'mkdir', path, recursive: options?.recursive }) },
    async rename(from, to) { await client.workspace({ op: 'rename', from, to }) },
    closeWatcher() { watcher?.close() },
  }
}

export function createLegacyRemoteWorkerSandbox(client: LegacyRemoteWorkerClient): Sandbox {
  const runtimeContext = { runtimeCwd: LEGACY_REMOTE_WORKER_RUNTIME_CWD }
  return {
    id: 'remote-worker',
    placement: 'remote',
    provider: 'remote-worker',
    capabilities: ['exec'],
    runtimeContext,
    async init() { await client.health() },
    async exec(cmd: string, options: ExecOptions = {}) {
      const env = options.env
        ? Object.fromEntries(Object.entries(options.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
        : undefined
      const startedAt = Date.now()
      const heartbeat = options.onHeartbeat
        ? setInterval(() => options.onHeartbeat?.(Date.now() - startedAt), 1_000)
        : null
      try {
        const result = await client.exec({
          cmd,
          cwd: options.cwd,
          env,
          timeoutMs: options.timeoutMs,
          maxOutputBytes: options.maxOutputBytes,
        }, options.signal)
        options.onStdout?.(result.stdout)
        options.onStderr?.(result.stderr)
        return result
      } finally {
        if (heartbeat) clearInterval(heartbeat)
      }
    },
  }
}

export function createLegacyRemoteWorkerSandboxProvider(
  options: LegacyRemoteWorkerProviderOptions = {},
): SandboxProviderV1 {
  return {
    contractVersion: PROVIDER_CONTRACT_VERSION,
    providerId: 'remote-worker',
    capabilities: PROVIDER_CAPABILITIES['remote-worker'],
    resolveRuntimeRoot: () => LEGACY_REMOTE_WORKER_RUNTIME_CWD,
    async create(context): Promise<WorkspaceSandboxPairV1> {
      const workspaceId = requireNonEmpty(context.workspaceId ?? context.sessionId, 'workspaceId')
      const client = new LegacyRemoteWorkerClient({
        ...options,
        baseUrl: requireNonEmpty(options.baseUrl ?? getEnv('BORING_WORKER_BASE_URL'), 'BORING_WORKER_BASE_URL'),
        token: requireNonEmpty(options.token ?? getEnv('BORING_WORKER_INTERNAL_TOKEN'), 'BORING_WORKER_INTERNAL_TOKEN'),
        workspaceId,
        requestId: context.requestId,
      })
      const workspace = createLegacyRemoteWorkerWorkspace(client)
      const sandbox = createLegacyRemoteWorkerSandbox(client)
      await sandbox.init?.({ workspace, sessionId: context.sessionId })
      return {
        workspace,
        sandbox,
        async dispose() { workspace.closeWatcher() },
      }
    },
  }
}
