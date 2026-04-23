import type { FetchClientOptions, FileContent, FileEntry, FileStat } from "./types"

export class FetchClient {
  private baseUrl: string
  private headers: Record<string, string>
  private onAuthError?: (statusCode: number) => void
  private timeout: number

  constructor(opts: FetchClientOptions) {
    this.baseUrl = opts.apiBaseUrl.replace(/\/$/, "")
    this.headers = { "Content-Type": "application/json", ...opts.authHeaders }
    this.onAuthError = opts.onAuthError
    this.timeout = opts.timeout ?? 10_000
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: this.headers,
        body: body != null ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })

      if (res.status === 401 || res.status === 403) {
        this.onAuthError?.(res.status)
        throw new FetchError(res.status, `Auth error: ${res.status}`)
      }

      if (!res.ok) {
        throw new FetchError(res.status, `HTTP ${res.status}: ${res.statusText}`)
      }

      return (await res.json()) as T
    } finally {
      clearTimeout(timer)
    }
  }

  async getTree(path: string): Promise<FileEntry[]> {
    const res = await this.request<{ entries: FileEntry[] }>(
      "GET",
      `/api/v1/tree?path=${encodeURIComponent(path)}`,
    )
    return res.entries
  }

  async getFile(path: string): Promise<FileContent> {
    return this.request<FileContent>("GET", `/api/v1/files?path=${encodeURIComponent(path)}`)
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.request<void>("POST", "/api/v1/files", { path, content })
  }

  async deleteFile(path: string): Promise<void> {
    await this.request<void>("DELETE", `/api/v1/files?path=${encodeURIComponent(path)}`)
  }

  async stat(path: string): Promise<FileStat> {
    return this.request<FileStat>("GET", `/api/v1/stat?path=${encodeURIComponent(path)}`)
  }

  async search(query: string, limit?: number): Promise<string[]> {
    const params = new URLSearchParams({ q: query })
    if (limit != null) params.set("limit", String(limit))
    const res = await this.request<{ results: string[] }>("GET", `/api/v1/files/search?${params}`)
    return res.results
  }

  async createDir(path: string): Promise<void> {
    await this.request<void>("POST", "/api/v1/dirs", { path })
  }

  async moveFile(from: string, to: string): Promise<void> {
    await this.request<void>("POST", "/api/v1/files/move", { from, to })
  }
}

export class FetchError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = "FetchError"
  }
}
