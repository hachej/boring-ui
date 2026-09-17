import { appRunnerAppId } from "../shared/sanitize"
import type { AppRunnerPublishResponse, AppRunnerVersion } from "../shared/types"

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
  fetchImpl?: typeof fetch
}

/**
 * Thin client for the celld app runner service. The runner is a separate
 * service built in parallel — this client only encodes its documented HTTP
 * contract (see `BORING_APP_RUNNER_URL`/`BORING_APP_RUNNER_TOKEN`).
 */
export class AppRunnerClient {
  private readonly baseUrl: string
  private readonly token: string | undefined
  private readonly fetchImpl: typeof fetch

  constructor(options: AppRunnerClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.BORING_APP_RUNNER_URL ?? "http://127.0.0.1:9877").replace(/\/+$/, "")
    this.token = options.token ?? process.env.BORING_APP_RUNNER_TOKEN
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  appId(workspaceId: string, appName: string): string {
    return appRunnerAppId(workspaceId, appName)
  }

  publicAppUrl(workspaceId: string, appName: string): string {
    return `${this.baseUrl}/u/${this.appId(workspaceId, appName)}/app/`
  }

  publicPreviewUrl(workspaceId: string, appName: string, version: number): string {
    return `${this.baseUrl}/u/${this.appId(workspaceId, appName)}/preview/${version}/`
  }

  async publish(
    workspaceId: string,
    appName: string,
    files: Record<string, string>,
    message?: string,
  ): Promise<AppRunnerPublishResponse> {
    return this.request<AppRunnerPublishResponse>(
      "POST",
      `/u/${this.appId(workspaceId, appName)}/publish`,
      { files, ...(message ? { message } : {}) },
    )
  }

  async rollback(workspaceId: string, appName: string): Promise<unknown> {
    return this.request("POST", `/u/${this.appId(workspaceId, appName)}/rollback`)
  }

  async activate(workspaceId: string, appName: string, version: number): Promise<unknown> {
    return this.request("POST", `/u/${this.appId(workspaceId, appName)}/activate`, { version })
  }

  async listVersions(workspaceId: string, appName: string): Promise<AppRunnerVersion[]> {
    return this.request<AppRunnerVersion[]>("GET", `/u/${this.appId(workspaceId, appName)}/versions`)
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {}
    if (this.token) headers.Authorization = `Bearer ${this.token}`
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
