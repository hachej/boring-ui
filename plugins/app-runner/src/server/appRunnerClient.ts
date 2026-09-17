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

  constructor(options: AppRunnerClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.BORING_APP_RUNNER_URL ?? "http://127.0.0.1:9877").replace(/\/+$/, "")
    this.token = options.token ?? process.env.BORING_APP_RUNNER_TOKEN
    this.authSecret = options.authSecret ?? process.env.BORING_APP_RUNNER_AUTH_SECRET
    this.fetchImpl = options.fetchImpl ?? fetch
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
  ): Promise<AppRunnerPublishResponse> {
    return this.request<AppRunnerPublishResponse>(
      "POST",
      `${this.appPath(workspaceId, appName)}/publish`,
      identity,
      workspaceId,
      { files, ...input },
    )
  }

  async rollback(workspaceId: string, appName: string, identity: AppRunnerIdentity): Promise<unknown> {
    return this.request("POST", `${this.appPath(workspaceId, appName)}/rollback`, identity, workspaceId)
  }

  async activate(workspaceId: string, appName: string, version: number, identity: AppRunnerIdentity): Promise<unknown> {
    return this.request("POST", `${this.appPath(workspaceId, appName)}/activate`, identity, workspaceId, { version })
  }

  async listVersions(workspaceId: string, appName: string, identity: AppRunnerIdentity): Promise<AppRunnerVersion[]> {
    const response = await this.request<{ versions: AppRunnerVersion[] }>("GET", `${this.appPath(workspaceId, appName)}/versions`, identity, workspaceId)
    return response.versions
  }

  async current(workspaceId: string, name: string, identity: AppRunnerIdentity): Promise<AppRunnerCurrent> {
    return this.request("GET", `${this.appPath(workspaceId, name)}/current`, identity, workspaceId)
  }

  async manifest(workspaceId: string, name: string, identity: AppRunnerIdentity): Promise<{ version: number; kind: AppRunnerKind; manifest: AppRunnerToolManifest }> {
    return this.request("GET", `${this.appPath(workspaceId, name)}/manifest`, identity, workspaceId)
  }

  async logs(workspaceId: string, appName: string, identity: AppRunnerIdentity): Promise<AppRunnerLogsResponse> {
    return this.request<AppRunnerLogsResponse>("GET", `${this.appPath(workspaceId, appName)}/logs`, identity, workspaceId)
  }

  async usage(workspaceId: string, appName: string, identity: AppRunnerIdentity): Promise<AppRunnerUsageResponse> {
    return this.request<AppRunnerUsageResponse>("GET", `${this.appPath(workspaceId, appName)}/usage`, identity, workspaceId)
  }

  /** `GET /w/{ws}/{app}/versions/{n}/files` — deployed source + manifest for one version. */
  async versionFiles(
    workspaceId: string,
    appName: string,
    version: number,
    identity: AppRunnerIdentity,
  ): Promise<{ files?: Record<string, string>; manifest?: unknown }> {
    return this.request(
      "GET",
      `${this.appPath(workspaceId, appName)}/versions/${version}/files`,
      identity,
      workspaceId,
    )
  }

  async callTool(
    workspaceId: string,
    appName: string,
    toolName: string,
    input: unknown,
    identity: AppRunnerIdentity,
  ): Promise<unknown> {
    return this.request("POST", `${this.appPath(workspaceId, appName)}/tools/${encodeURIComponent(toolName)}`, identity, workspaceId, input)
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
    return this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: this.servingHeaders(identity, workspaceId),
      signal,
    })
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
  ): Promise<T> {
    const headers = this.authHeaders(identity, workspaceId)
    if (body !== undefined) headers["Content-Type"] = "application/json"
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => "")
      throw new AppRunnerHttpError(response.status, text || `app runner request failed with status ${response.status}`)
    }
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }
}
