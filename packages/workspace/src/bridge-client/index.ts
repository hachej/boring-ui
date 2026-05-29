import type {
  WorkspaceBridgeCallRequest,
  WorkspaceBridgeCallResponse,
  WorkspaceBridgeErrorCode,
} from "../shared/workspace-bridge-rpc"

export const WORKSPACE_BRIDGE_URL_ENV = "BORING_WORKSPACE_BRIDGE_URL"
export const WORKSPACE_BRIDGE_TOKEN_ENV = "BORING_WORKSPACE_BRIDGE_TOKEN"
export const WORKSPACE_BRIDGE_DISABLED_ENV = "BORING_WORKSPACE_BRIDGE_DISABLED"

export interface WorkspaceBridgeClientOptions {
  url: string
  token: string
  fetch?: typeof fetch
}

export interface WorkspaceBridgeClientCallOptions {
  requestId?: string
  idempotencyKey?: string
}

export class WorkspaceBridgeClientConfigError extends Error {
  readonly code = "WORKSPACE_BRIDGE_CLIENT_CONFIG_ERROR"
  readonly missingVar?: string

  constructor(message: string, options: { missingVar?: string } = {}) {
    super(message)
    this.name = "WorkspaceBridgeClientConfigError"
    this.missingVar = options.missingVar
  }
}

export class WorkspaceBridgeClientError extends Error {
  readonly code: WorkspaceBridgeErrorCode | string
  readonly status?: number
  readonly requestId?: string

  constructor(message: string, options: { code: WorkspaceBridgeErrorCode | string; status?: number; requestId?: string }) {
    super(message)
    this.name = "WorkspaceBridgeClientError"
    this.code = options.code
    this.status = options.status
    this.requestId = options.requestId
  }
}

export class WorkspaceBridgeClient {
  readonly url: string
  private readonly token: string
  private readonly fetchImpl: typeof fetch

  constructor(options: WorkspaceBridgeClientOptions) {
    this.url = normalizeBridgeUrl(options.url)
    this.token = options.token
    this.fetchImpl = options.fetch ?? globalThis.fetch
    if (!this.fetchImpl) {
      throw new WorkspaceBridgeClientConfigError("WorkspaceBridge client requires a fetch implementation")
    }
  }

  static fromEnv(env: Record<string, string | undefined> = readProcessEnv(), options: { fetch?: typeof fetch } = {}): WorkspaceBridgeClient {
    const disabled = env[WORKSPACE_BRIDGE_DISABLED_ENV]
    if (disabled) {
      throw new WorkspaceBridgeClientConfigError(`WorkspaceBridge runtime env is disabled: ${disabled}`)
    }
    const url = requireEnv(env, WORKSPACE_BRIDGE_URL_ENV)
    const token = requireEnv(env, WORKSPACE_BRIDGE_TOKEN_ENV)
    return new WorkspaceBridgeClient({ url, token, fetch: options.fetch })
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
    const response = await this.fetchImpl(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(request),
    })

    let body: WorkspaceBridgeCallResponse | undefined
    try {
      body = await response.json() as WorkspaceBridgeCallResponse
    } catch {
      throw new WorkspaceBridgeClientError("WorkspaceBridge response was not valid JSON", {
        code: "WORKSPACE_BRIDGE_INVALID_RESPONSE",
        status: response.status,
      })
    }

    if (!body.ok) {
      throw new WorkspaceBridgeClientError(body.error.message, {
        code: body.error.code,
        status: response.status,
        requestId: body.requestId,
      })
    }
    return body.output as TOutput
  }
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
