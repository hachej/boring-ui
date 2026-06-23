import {
  WorkspaceBridgeErrorCode,
  type WorkspaceBridgeCallFailure,
  type WorkspaceBridgeCallRequest,
  type WorkspaceBridgeCallResponse,
  type WorkspaceBridgeCallSuccess,
  type WorkspaceBridgeError,
} from "../shared/workspace-bridge-rpc"

export {
  WorkspaceBridgeErrorCode,
  type WorkspaceBridgeCallFailure,
  type WorkspaceBridgeCallRequest,
  type WorkspaceBridgeCallResponse,
  type WorkspaceBridgeCallSuccess,
  type WorkspaceBridgeError,
}

export const WORKSPACE_BRIDGE_URL_ENV = "BORING_WORKSPACE_BRIDGE_URL"
export const WORKSPACE_BRIDGE_TOKEN_ENV = "BORING_WORKSPACE_BRIDGE_TOKEN"
export const WORKSPACE_BRIDGE_TOKEN_URL_ENV = "BORING_WORKSPACE_BRIDGE_TOKEN_URL"
export const WORKSPACE_BRIDGE_REFRESH_TOKEN_ENV = "BORING_WORKSPACE_BRIDGE_REFRESH_TOKEN"
export const WORKSPACE_BRIDGE_DISABLED_ENV = "BORING_WORKSPACE_BRIDGE_DISABLED"

export enum WorkspaceBridgeClientErrorCode {
  Config = "WORKSPACE_BRIDGE_CLIENT_CONFIG_ERROR",
  InvalidResponse = "WORKSPACE_BRIDGE_INVALID_RESPONSE",
  Transport = "WORKSPACE_BRIDGE_TRANSPORT_ERROR",
  Timeout = "WORKSPACE_BRIDGE_TIMEOUT",
  Aborted = "WORKSPACE_BRIDGE_ABORTED",
  HttpError = "WORKSPACE_BRIDGE_HTTP_ERROR",
}

export interface WorkspaceBridgeTokenProviderContext {
  /** True when the previous attempt failed with a 401 and the client is retrying once. */
  refresh: boolean
  /** Aborts when the per-attempt timeout or caller AbortSignal fires. */
  signal?: AbortSignal
}

export type WorkspaceBridgeTokenProvider = (
  context: WorkspaceBridgeTokenProviderContext,
) => string | Promise<string>

export type WorkspaceBridgeClientToken = string | WorkspaceBridgeTokenProvider

export interface WorkspaceBridgeClientOptions {
  url: string
  token: WorkspaceBridgeClientToken
  fetch?: typeof fetch
  /** Default per-attempt timeout. Defaults to 30s. */
  defaultTimeoutMs?: number
}

export interface WorkspaceBridgeClientCallOptions {
  requestId?: string
  idempotencyKey?: string
  timeoutMs?: number
  signal?: AbortSignal
}

export class WorkspaceBridgeClientConfigError extends Error {
  readonly code = WorkspaceBridgeClientErrorCode.Config
  readonly missingVar?: string

  constructor(message: string, options: { missingVar?: string } = {}) {
    super(message)
    this.name = "WorkspaceBridgeClientConfigError"
    this.missingVar = options.missingVar
  }
}

export class WorkspaceBridgeClientError extends Error {
  readonly code: WorkspaceBridgeErrorCode | WorkspaceBridgeClientErrorCode
  readonly status?: number
  readonly requestId?: string

  constructor(
    message: string,
    options: {
      code: WorkspaceBridgeErrorCode | WorkspaceBridgeClientErrorCode
      status?: number
      requestId?: string
      cause?: unknown
    },
  ) {
    super(message)
    this.name = "WorkspaceBridgeClientError"
    this.code = options.code
    this.status = options.status
    this.requestId = options.requestId
    if (options.cause !== undefined) {
      ;(this as Error & { cause?: unknown }).cause = options.cause
    }
  }
}

export class WorkspaceBridgeClient {
  readonly url: string
  private readonly token: WorkspaceBridgeClientToken
  private readonly fetchImpl: typeof fetch
  private readonly defaultTimeoutMs: number

  constructor(options: WorkspaceBridgeClientOptions) {
    this.url = normalizeBridgeUrl(options.url)
    this.token = options.token
    this.fetchImpl = options.fetch ?? globalThis.fetch
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000
    assertTimeoutMs(this.defaultTimeoutMs, "defaultTimeoutMs")
    if (!this.fetchImpl) {
      throw new WorkspaceBridgeClientConfigError("WorkspaceBridge client requires a fetch implementation")
    }
  }

  static fromEnv(
    env: Record<string, string | undefined> = readProcessEnv(),
    options: { fetch?: typeof fetch; token?: WorkspaceBridgeClientToken; defaultTimeoutMs?: number } = {},
  ): WorkspaceBridgeClient {
    const disabled = env[WORKSPACE_BRIDGE_DISABLED_ENV]
    if (disabled) {
      throw new WorkspaceBridgeClientConfigError(`WorkspaceBridge runtime env is disabled: ${disabled}`)
    }
    const url = requireEnv(env, WORKSPACE_BRIDGE_URL_ENV)
    const token = options.token ?? tokenFromEnv(env, options.fetch ?? globalThis.fetch)
    return new WorkspaceBridgeClient({ url, token, fetch: options.fetch, defaultTimeoutMs: options.defaultTimeoutMs })
  }

  async call<TOutput = unknown, TInput = unknown>(
    op: string,
    input: TInput,
    options: WorkspaceBridgeClientCallOptions = {},
  ): Promise<TOutput> {
    const request: WorkspaceBridgeCallRequest = {
      op,
      input,
      ...(options.requestId ? { requestId: options.requestId } : {}),
      ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
    }
    try {
      return await this.callOnce<TOutput>(request, options, false)
    } catch (error) {
      if (this.shouldRetryWithFreshToken(error)) {
        return await this.callOnce<TOutput>(request, options, true)
      }
      throw error
    }
  }

  private async callOnce<TOutput>(
    request: WorkspaceBridgeCallRequest,
    options: WorkspaceBridgeClientCallOptions,
    refreshToken: boolean,
  ): Promise<TOutput> {
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs
    assertTimeoutMs(timeoutMs, "timeoutMs")
    const abort = createAbortController({ signal: options.signal, timeoutMs })
    try {
      const token = await runWithAbort(() => this.resolveToken(refreshToken, abort.signal), abort)
      const response = await runWithAbort(() => this.fetchImpl(this.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(request),
        signal: abort.signal,
      }), abort)

      const body = await readJsonResponse(response, abort)
      const envelope = parseBridgeEnvelope(body)
      if (!envelope) {
        if (!httpOk(response)) {
          throw new WorkspaceBridgeClientError(httpErrorMessage(response, body), {
            code: WorkspaceBridgeClientErrorCode.HttpError,
            status: response.status,
          })
        }
        throw new WorkspaceBridgeClientError("WorkspaceBridge response envelope was invalid", {
          code: WorkspaceBridgeClientErrorCode.InvalidResponse,
          status: response.status,
        })
      }

      if (!envelope.ok) {
        throw new WorkspaceBridgeClientError(envelope.error.message, {
          code: envelope.error.code,
          status: response.status,
          requestId: envelope.requestId,
        })
      }

      if (!httpOk(response)) {
        throw new WorkspaceBridgeClientError(httpErrorMessage(response, body), {
          code: WorkspaceBridgeClientErrorCode.HttpError,
          status: response.status,
          requestId: envelope.requestId,
        })
      }

      return envelope.output as TOutput
    } catch (error) {
      if (error instanceof WorkspaceBridgeClientError || error instanceof WorkspaceBridgeClientConfigError) throw error
      throw fetchError(error, abort)
    } finally {
      abort.cleanup()
    }
  }

  private async resolveToken(refresh: boolean, signal: AbortSignal): Promise<string> {
    const value = typeof this.token === "function" ? await this.token({ refresh, signal }) : this.token
    if (!value) {
      throw new WorkspaceBridgeClientConfigError("WorkspaceBridge token provider returned an empty token")
    }
    return value
  }

  private shouldRetryWithFreshToken(error: unknown): boolean {
    if (typeof this.token !== "function") return false
    return error instanceof WorkspaceBridgeClientError && error.status === 401
  }
}

function tokenFromEnv(env: Record<string, string | undefined>, fetchImpl: typeof fetch | undefined): WorkspaceBridgeClientToken {
  const initialToken = requireEnv(env, WORKSPACE_BRIDGE_TOKEN_ENV)
  const tokenUrl = env[WORKSPACE_BRIDGE_TOKEN_URL_ENV]
  const refreshToken = env[WORKSPACE_BRIDGE_REFRESH_TOKEN_ENV]
  if (!tokenUrl && !refreshToken) return initialToken
  if (!tokenUrl) {
    throw new WorkspaceBridgeClientConfigError(`WorkspaceBridge client missing required env var ${WORKSPACE_BRIDGE_TOKEN_URL_ENV}`, { missingVar: WORKSPACE_BRIDGE_TOKEN_URL_ENV })
  }
  if (!refreshToken) {
    throw new WorkspaceBridgeClientConfigError(`WorkspaceBridge client missing required env var ${WORKSPACE_BRIDGE_REFRESH_TOKEN_ENV}`, { missingVar: WORKSPACE_BRIDGE_REFRESH_TOKEN_ENV })
  }
  if (!fetchImpl) {
    throw new WorkspaceBridgeClientConfigError("WorkspaceBridge refresh token provider requires a fetch implementation")
  }
  const normalizedTokenUrl = normalizeBridgeUrl(tokenUrl)
  let cachedToken = initialToken
  return async ({ refresh, signal }) => {
    if (!refresh) return cachedToken
    cachedToken = await fetchRefreshedToken({ tokenUrl: normalizedTokenUrl, refreshToken, fetchImpl, signal })
    return cachedToken
  }
}

async function fetchRefreshedToken(options: {
  tokenUrl: string
  refreshToken: string
  fetchImpl: typeof fetch
  signal?: AbortSignal
}): Promise<string> {
  const response = await options.fetchImpl(options.tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${options.refreshToken}`,
    },
    body: "{}",
    signal: options.signal,
  })
  const body = await response.json()
  if (isTokenResponse(body)) return body.token
  const envelope = parseBridgeEnvelope(body)
  if (envelope && !envelope.ok) {
    throw new WorkspaceBridgeClientError(envelope.error.message, {
      code: envelope.error.code,
      status: response.status,
      requestId: envelope.requestId,
    })
  }
  if (!httpOk(response)) {
    throw new WorkspaceBridgeClientError(httpErrorMessage(response, body), {
      code: WorkspaceBridgeClientErrorCode.HttpError,
      status: response.status,
    })
  }
  throw new WorkspaceBridgeClientError("WorkspaceBridge token response envelope was invalid", {
    code: WorkspaceBridgeClientErrorCode.InvalidResponse,
    status: response.status,
  })
}

function isTokenResponse(value: unknown): value is { ok: true; token: string } {
  return !!value && typeof value === "object" && (value as { ok?: unknown }).ok === true && typeof (value as { token?: unknown }).token === "string"
}

function requireEnv(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]
  if (!value) {
    throw new WorkspaceBridgeClientConfigError(`WorkspaceBridge client missing required env var ${name}`, { missingVar: name })
  }
  return value
}

function normalizeBridgeUrl(value: string): string {
  try {
    return new URL(value).toString()
  } catch {
    throw new WorkspaceBridgeClientConfigError(`WorkspaceBridge client env var ${WORKSPACE_BRIDGE_URL_ENV} is not a valid URL`)
  }
}

function readProcessEnv(): Record<string, string | undefined> {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
}

function assertTimeoutMs(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new WorkspaceBridgeClientConfigError(`WorkspaceBridge client ${name} must be a positive finite number`)
  }
}

type AbortState = {
  signal: AbortSignal
  timedOut: () => boolean
  callerAborted: () => boolean
  cleanup: () => void
}

function createAbortController(options: { signal?: AbortSignal; timeoutMs: number }): AbortState {
  const controller = new AbortController()
  let timedOut = false
  let callerAborted = Boolean(options.signal?.aborted)
  const abortFromCaller = () => {
    callerAborted = true
    controller.abort(options.signal?.reason)
  }
  if (options.signal?.aborted) abortFromCaller()
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true })
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort(new Error("WorkspaceBridge request timed out"))
  }, options.timeoutMs)
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    callerAborted: () => callerAborted,
    cleanup: () => {
      clearTimeout(timeout)
      options.signal?.removeEventListener("abort", abortFromCaller)
    },
  }
}

function fetchError(error: unknown, abort: AbortState): WorkspaceBridgeClientError {
  if (abort.timedOut()) {
    return new WorkspaceBridgeClientError("WorkspaceBridge request timed out", {
      code: WorkspaceBridgeClientErrorCode.Timeout,
      cause: error,
    })
  }
  if (abort.callerAborted()) {
    return new WorkspaceBridgeClientError("WorkspaceBridge request was aborted", {
      code: WorkspaceBridgeClientErrorCode.Aborted,
      cause: error,
    })
  }
  return new WorkspaceBridgeClientError("WorkspaceBridge transport failed", {
    code: WorkspaceBridgeClientErrorCode.Transport,
    cause: error,
  })
}

async function runWithAbort<T>(operation: () => T | Promise<T>, abort: AbortState): Promise<T> {
  if (abort.signal.aborted) throw fetchError(undefined, abort)

  return await new Promise<T>((resolve, reject) => {
    let settled = false
    const cleanup = () => abort.signal.removeEventListener("abort", onAbort)
    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }
    const onAbort = () => settle(() => reject(fetchError(undefined, abort)))

    abort.signal.addEventListener("abort", onAbort, { once: true })
    Promise.resolve()
      .then(operation)
      .then(
        (value) => settle(() => resolve(value)),
        (error) => settle(() => reject(error)),
      )
  })
}

async function readJsonResponse(response: Response, abort: AbortState): Promise<unknown> {
  try {
    return await runWithAbort(() => response.json(), abort)
  } catch (error) {
    if (error instanceof WorkspaceBridgeClientError) throw error
    if (abort.timedOut() || abort.callerAborted()) throw fetchError(error, abort)
    throw new WorkspaceBridgeClientError("WorkspaceBridge response was not valid JSON", {
      code: WorkspaceBridgeClientErrorCode.InvalidResponse,
      status: response.status,
      cause: error,
    })
  }
}

type ParsedBridgeEnvelope =
  | { ok: true; op: string; requestId?: string; output: unknown }
  | { ok: false; op: string; requestId?: string; error: WorkspaceBridgeError }

function parseBridgeEnvelope(value: unknown): ParsedBridgeEnvelope | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Record<string, unknown>
  const requestId = raw.requestId === undefined || typeof raw.requestId === "string" ? raw.requestId : undefined
  if (raw.ok === true) {
    return {
      ok: true,
      op: typeof raw.op === "string" ? raw.op : "",
      ...(requestId ? { requestId } : {}),
      output: raw.output,
    }
  }
  if (raw.ok === false && raw.error && typeof raw.error === "object") {
    const error = raw.error as Record<string, unknown>
    if (typeof error.message !== "string" || !isWorkspaceBridgeErrorCode(error.code)) return null
    return {
      ok: false,
      op: typeof raw.op === "string" ? raw.op : "",
      ...(requestId ? { requestId } : {}),
      error: { code: error.code, message: error.message },
    }
  }
  return null
}

const WORKSPACE_BRIDGE_ERROR_CODES = new Set<string>(Object.values(WorkspaceBridgeErrorCode))

function isWorkspaceBridgeErrorCode(value: unknown): value is WorkspaceBridgeErrorCode {
  return typeof value === "string" && WORKSPACE_BRIDGE_ERROR_CODES.has(value)
}

function httpOk(response: Response): boolean {
  return typeof response.ok === "boolean" ? response.ok : response.status >= 200 && response.status < 300
}

function httpErrorMessage(response: Response, body: unknown): string {
  if (body && typeof body === "object" && typeof (body as { message?: unknown }).message === "string") {
    return (body as { message: string }).message
  }
  const statusText = typeof response.statusText === "string" && response.statusText ? ` ${response.statusText}` : ""
  return `WorkspaceBridge HTTP ${response.status}${statusText}`
}
