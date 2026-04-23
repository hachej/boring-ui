import type { FetchClientOptions, FileContent, FileEntry, FileStat } from "./types"

const DEFAULT_TIMEOUT = 10_000
const DEFAULT_MAX_RETRIES = 3
const RETRY_BASE_MS = 1_000

function isRetryable(status: number): boolean {
  return status >= 500
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class FetchClient {
  private baseUrl: string
  private headers: Record<string, string>
  private onAuthError?: (statusCode: number) => void
  private onTimeout?: (route: string) => void
  private timeout: number
  private maxRetries: number
  private retryBaseMs: number

  constructor(opts: FetchClientOptions) {
    this.baseUrl = opts.apiBaseUrl.replace(/\/$/, "")
    this.headers = { "Content-Type": "application/json", ...opts.authHeaders }
    this.onAuthError = opts.onAuthError
    this.onTimeout = opts.onTimeout
    this.timeout = opts.timeout ?? DEFAULT_TIMEOUT
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES
    this.retryBaseMs = opts.retryBaseMs ?? RETRY_BASE_MS
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    requestTimeout?: number,
  ): Promise<T> {
    const effectiveTimeout = requestTimeout ?? this.timeout
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        await delay(this.retryBaseMs * 2 ** (attempt - 1))
      }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), effectiveTimeout)

      try {
        const res = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers: this.headers,
          body: body != null ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        })

        clearTimeout(timer)

        if (res.status === 401 || res.status === 403) {
          this.onAuthError?.(res.status)
          throw new FetchError(res.status, `Auth error: ${res.status}`)
        }

        if (isRetryable(res.status)) {
          lastError = new FetchError(res.status, `HTTP ${res.status}: ${res.statusText}`)
          continue
        }

        if (!res.ok) {
          throw new FetchError(res.status, `HTTP ${res.status}: ${res.statusText}`)
        }

        return (await res.json()) as T
      } catch (err) {
        clearTimeout(timer)

        if (err instanceof FetchError && !isRetryable(err.status)) {
          throw err
        }

        if (err instanceof DOMException && err.name === "AbortError") {
          this.onTimeout?.(path)
          lastError = new FetchError(0, `Request timeout after ${effectiveTimeout}ms: ${path}`)
          continue
        }

        if (err instanceof TypeError) {
          lastError = err
          continue
        }

        throw err
      }
    }

    throw lastError ?? new FetchError(0, "Request failed after retries")
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
