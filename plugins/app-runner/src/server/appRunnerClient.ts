import {
  APP_RUNNER_AUTH_SECRET_HEADER,
  APP_RUNNER_USER_HEADER,
  APP_RUNNER_WORKSPACE_HEADER,
} from "../shared/constants"
import { appRunnerAppId, sanitizeAppName } from "../shared/sanitize"
import type {
  AppRunnerCurrent,
  AppRunnerIdentity,
  AppRunnerKind,
  AppRunnerLogsResponse,
  AppRunnerPublishResponse,
  AppRunnerToolManifest,
  AppRunnerUsageResponse,
  AppRunnerVersion,
} from "../shared/types"

export class AppRunnerHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = "AppRunnerHttpError"
  }
}

export interface AppRunnerClientOptions {
  baseUrl?: string
  token?: string
  authSecret?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/**
 * Thin client for the celld app runner service. The runner is a separate
 * service built in parallel — this client only encodes its documented HTTP
 * contract (see APP-RUNNER-SPEC.md): path scheme
 * `/w/{workspaceId}/{app}/...`, bearer token, and identity/dev-secret
 * headers.
 */
export class AppRunnerClient {
  private readonly baseUrl: string
  private readonly token: string | undefined
  private readonly authSecret: string | undefined
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(options: AppRunnerClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.BORING_APP_RUNNER_URL ?? "http://127.0.0.1:9877").replace(/\/+$/, "")
    this.token = options.token ?? process.env.BORING_APP_RUNNER_TOKEN
    this.authSecret = options.authSecret ?? process.env.BORING_APP_RUNNER_AUTH_SECRET
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs ?? 15_000
  }

  /** Internal runner app id (`{workspaceId}--{app}`), not part of the URL scheme. */
  appId(workspaceId: string, appName: string): string {
    return appRunnerAppId(workspaceId, appName)
  }

  private appPath(workspaceId: string, appName: string): string {
    return `/w/${sanitizeAppName(workspaceId)}/${sanitizeAppName(appName)}`
  }

  publicAppUrl(workspaceId: string, appName: string): string {
    return `${this.baseUrl}${this.appPath(workspaceId, appName)}/`
  }

  publicPreviewUrl(workspaceId: string, appName: string, version: number): string {
    return `${this.baseUrl}${this.appPath(workspaceId, appName)}/preview/${version}/`
  }

  async publish(
    workspaceId: string,
    appName: string,
    files: Record<string, string>,
    identity: AppRunnerIdentity,
    input: { kind: AppRunnerKind; message: string; sha: string },
    signal?: AbortSignal,
  ): Promise<AppRunnerPublishResponse> {
    return this.request<AppRunnerPublishResponse>(
      "POST",
      `${this.appPath(workspaceId, appName)}/publish`,
      identity,
      workspaceId,
      { files, ...input },
      signal,
    )
  }

  async rollback(workspaceId: string, appName: string, identity: AppRunnerIdentity, signal?: AbortSignal): Promise<unknown> {
    return this.request("POST", `${this.appPath(workspaceId, appName)}/rollback`, identity, workspaceId, undefined, signal)
  }

  async activate(workspaceId: string, appName: string, version: number, identity: AppRunnerIdentity, signal?: AbortSignal): Promise<unknown> {
    return this.request("POST", `${this.appPath(workspaceId, appName)}/activate`, identity, workspaceId, { version }, signal)
  }

  async listVersions(workspaceId: string, appName: string, identity: AppRunnerIdentity, signal?: AbortSignal): Promise<AppRunnerVersion[]> {
    const response = await this.request<{ versions: AppRunnerVersion[] }>("GET", `${this.appPath(workspaceId, appName)}/versions`, identity, workspaceId, undefined, signal)
    return response.versions
  }

  async current(workspaceId: string, name: string, identity: AppRunnerIdentity, signal?: AbortSignal): Promise<AppRunnerCurrent> {
    return this.request("GET", `${this.appPath(workspaceId, name)}/current`, identity, workspaceId, undefined, signal)
  }

  async manifest(workspaceId: string, name: string, identity: AppRunnerIdentity, signal?: AbortSignal): Promise<{ version: number; kind: AppRunnerKind; manifest: AppRunnerToolManifest }> {
    return this.request("GET", `${this.appPath(workspaceId, name)}/manifest`, identity, workspaceId, undefined, signal)
  }

  async logs(workspaceId: string, appName: string, identity: AppRunnerIdentity, signal?: AbortSignal): Promise<AppRunnerLogsResponse> {
    return this.request<AppRunnerLogsResponse>("GET", `${this.appPath(workspaceId, appName)}/logs`, identity, workspaceId, undefined, signal)
  }

  async usage(workspaceId: string, appName: string, identity: AppRunnerIdentity, signal?: AbortSignal): Promise<AppRunnerUsageResponse> {
    return this.request<AppRunnerUsageResponse>("GET", `${this.appPath(workspaceId, appName)}/usage`, identity, workspaceId, undefined, signal)
  }

  /** `GET /w/{ws}/{app}/versions/{n}/files` — deployed source + manifest for one version. */
  async versionFiles(
    workspaceId: string,
    appName: string,
    version: number,
    identity: AppRunnerIdentity,
    signal?: AbortSignal,
  ): Promise<{ files?: Record<string, string>; manifest?: unknown }> {
    return this.request(
      "GET",
      `${this.appPath(workspaceId, appName)}/versions/${version}/files`,
      identity,
      workspaceId,
      undefined,
      signal,
    )
  }

  async callTool(
    workspaceId: string,
    appName: string,
    toolName: string,
    input: unknown,
    identity: AppRunnerIdentity,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.request("POST", `${this.appPath(workspaceId, appName)}/tools/${encodeURIComponent(toolName)}`, identity, workspaceId, input, signal)
  }

  /** Credentials used only for runner control-plane and tool requests. */
  authHeaders(identity: AppRunnerIdentity, workspaceId: string): Record<string, string> {
    const headers: Record<string, string> = {}
    if (this.token) headers.Authorization = `Bearer ${this.token}`
    headers[APP_RUNNER_USER_HEADER] = JSON.stringify(identity)
    headers[APP_RUNNER_WORKSPACE_HEADER] = workspaceId
    if (this.authSecret) headers[APP_RUNNER_AUTH_SECRET_HEADER] = this.authSecret
    return headers
  }

  /** Identity-only headers for app-serving requests; platform credentials must never reach app code. */
  servingHeaders(identity: AppRunnerIdentity, workspaceId: string): Record<string, string> {
    return {
      [APP_RUNNER_USER_HEADER]: JSON.stringify(identity),
      [APP_RUNNER_WORKSPACE_HEADER]: workspaceId,
    }
  }

  async fetchServing(path: string, identity: AppRunnerIdentity, workspaceId: string, signal?: AbortSignal): Promise<Response> {
    return this.fetchWithDeadline(`${this.baseUrl}${path}`, {
      headers: this.servingHeaders(identity, workspaceId),
    }, signal)
  }

  get base(): string {
    return this.baseUrl
  }

  private async request<T>(
    method: string,
    path: string,
    identity: AppRunnerIdentity,
    workspaceId: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const headers = this.authHeaders(identity, workspaceId)
    if (body !== undefined) headers["Content-Type"] = "application/json"
    const response = await this.fetchWithDeadline(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }, signal)
    if (!response.ok) {
      const text = await response.text().catch(() => "")
      throw new AppRunnerHttpError(response.status, text || `app runner request failed with status ${response.status}`)
    }
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }

  private async fetchWithDeadline(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    signal?.throwIfAborted()
    const controller = new AbortController()
    const abort = () => controller.abort(signal?.reason)
    signal?.addEventListener("abort", abort, { once: true })
    const timeout = setTimeout(() => controller.abort(new Error(`app runner request timed out after ${this.timeoutMs}ms`)), this.timeoutMs)
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener("abort", abort)
    }
  }
}
