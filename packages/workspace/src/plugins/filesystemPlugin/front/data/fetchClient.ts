import type { FetchClientOptions, FileContent, FileEntry, FileStat, GitUrlMetadata } from "./types"

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
    // Auth headers always go on; Content-Type is added per-request only when
    // there's a body. Sending `Content-Type: application/json` on a body-less
    // DELETE made Fastify's JSON parser reject with FST_ERR_CTP_EMPTY_JSON_BODY
    // ("Body cannot be empty when content-type is set to 'application/json'") —
    // surfaces in the UI as a generic "Delete failed HTTP 400".
    //
    // Defensively strip Content-Type from authHeaders too: if a host passed
    // one in (some auth flows do), it would re-introduce the same bug on
    // every body-less request despite the per-request fix below.
    const sanitizedAuth: Record<string, string> = { ...opts.authHeaders }
    for (const key of Object.keys(sanitizedAuth)) {
      if (key.toLowerCase() === "content-type") delete sanitizedAuth[key]
    }
    this.headers = sanitizedAuth
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
    signal?: AbortSignal,
  ): Promise<T> {
    const effectiveTimeout = requestTimeout ?? this.timeout
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        await delay(this.retryBaseMs * 2 ** (attempt - 1))
      }

      const controller = new AbortController()
      const abortFromCaller = () => controller.abort()
      signal?.addEventListener("abort", abortFromCaller, { once: true })
      const timer = setTimeout(() => controller.abort(), effectiveTimeout)

      try {
        const hasBody = body != null
        const res = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers: hasBody
            ? { ...this.headers, "Content-Type": "application/json" }
            : this.headers,
          body: hasBody ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        })

        clearTimeout(timer)
        signal?.removeEventListener("abort", abortFromCaller)

        if (res.status === 401 || res.status === 403) {
          this.onAuthError?.(res.status)
          throw new FetchError(res.status, `Auth error: ${res.status}`)
        }

        if (isRetryable(res.status)) {
          lastError = new FetchError(res.status, `HTTP ${res.status}: ${res.statusText}`)
          continue
        }

        if (!res.ok) {
          // Parse the body so structured errors (e.g. 409 OCC payloads
          // carrying `currentMtimeMs`) can be inspected by callers.
          const parsed = await safeJson(res)
          throw new FetchError(
            res.status,
            `HTTP ${res.status}: ${res.statusText}`,
            parsed,
          )
        }

        return (await res.json()) as T
      } catch (err) {
        clearTimeout(timer)
        signal?.removeEventListener("abort", abortFromCaller)

        if (err instanceof FetchError && !isRetryable(err.status)) {
          throw err
        }

        if (err instanceof DOMException && err.name === "AbortError") {
          if (signal?.aborted) {
            throw err
          }
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

  async getTree(path: string, signal?: AbortSignal): Promise<FileEntry[]> {
    const res = await this.request<{ entries: FileEntry[] }>(
      "GET",
      `/api/v1/tree?path=${encodeURIComponent(path)}`,
      undefined,
      undefined,
      signal,
    )
    return res.entries
  }

  async getFile(path: string, signal?: AbortSignal, filesystem?: string): Promise<FileContent> {
    const params = new URLSearchParams({ path })
    if (filesystem && filesystem !== "user") params.set("filesystem", filesystem)
    return this.request<FileContent>(
      "GET",
      `/api/v1/files?${params.toString()}`,
      undefined,
      undefined,
      signal,
    )
  }

  /**
   * Write file content. When `expectedMtimeMs` is supplied, the server
   * runs an optimistic-concurrency check and returns 409 if the file
   * has been modified since that mtime — surfaced here as a typed
   * `FileConflictError` so the editor can ask the user to reload or
   * force-overwrite. The returned `mtimeMs` is the server's stat
   * after the write; callers use it as the OCC baseline for the
   * next save. Set `returnMtimeMs: false` only for writes that do
   * not need a fresh OCC baseline (for example, creating an empty
   * file before immediately opening/refetching it). That lets remote
   * sandboxes skip an expensive post-write stat.
   */
  async writeFile(
    path: string,
    content: string,
    opts?: { expectedMtimeMs?: number; returnMtimeMs?: boolean; filesystem?: string },
  ): Promise<{ mtimeMs?: number }> {
    try {
      const body: { path: string; content: string; expectedMtimeMs?: number; returnMtimeMs?: boolean; filesystem?: string } = {
        path,
        content,
      }
      if (opts?.filesystem && opts.filesystem !== "user") body.filesystem = opts.filesystem
      if (opts?.expectedMtimeMs != null) body.expectedMtimeMs = opts.expectedMtimeMs
      if (opts?.returnMtimeMs === false) body.returnMtimeMs = false
      const res = await this.request<{ ok: boolean; mtimeMs?: number }>(
        "POST",
        "/api/v1/files",
        body,
      )
      return { mtimeMs: res.mtimeMs }
    } catch (err) {
      if (err instanceof FetchError && err.status === 409) {
        throw FileConflictError.from(err, path)
      }
      throw err
    }
  }

  async deleteFile(path: string, options?: { filesystem?: string }): Promise<void> {
    const params = new URLSearchParams({ path })
    if (options?.filesystem) params.set("filesystem", options.filesystem)
    await this.request<void>("DELETE", `/api/v1/files?${params}`)
  }

  async stat(path: string, signal?: AbortSignal, filesystem?: string): Promise<FileStat> {
    const params = new URLSearchParams({ path })
    if (filesystem && filesystem !== "user") params.set("filesystem", filesystem)
    return this.request<FileStat>(
      "GET",
      `/api/v1/stat?${params.toString()}`,
      undefined,
      undefined,
      signal,
    )
  }

  async getGitUrlMetadata(path: string, signal?: AbortSignal): Promise<GitUrlMetadata> {
    return this.request<GitUrlMetadata>(
      "GET",
      `/api/v1/git/file-url?path=${encodeURIComponent(path)}`,
      undefined,
      undefined,
      signal,
    )
  }

  async search(query: string, limit?: number, signal?: AbortSignal): Promise<string[]> {
    const params = new URLSearchParams({ q: query })
    if (limit != null) params.set("limit", String(limit))
    const res = await this.request<{ results: string[] }>(
      "GET",
      `/api/v1/files/search?${params}`,
      undefined,
      undefined,
      signal,
    )
    return res.results
  }

  async createDir(path: string, options?: { filesystem?: string }): Promise<void> {
    await this.request<void>("POST", "/api/v1/dirs", { path, ...(options?.filesystem ? { filesystem: options.filesystem } : {}) })
  }

  async moveFile(from: string, to: string, options?: { filesystem?: string }): Promise<void> {
    await this.request<void>("POST", "/api/v1/files/move", { from, to, ...(options?.filesystem ? { filesystem: options.filesystem } : {}) })
  }
}

export class FetchError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message)
    this.name = "FetchError"
  }
}

/**
 * Thrown by `writeFile` when the server returns 409 because the file
 * has been modified since the client's last read. Carries the
 * server's current mtime so the editor can show the user a
 * Reload-vs-Overwrite choice with the actual conflict context.
 */
export class FileConflictError extends Error {
  constructor(
    public readonly path: string,
    public readonly currentMtimeMs: number | null,
    public readonly expectedMtimeMs: number | null,
  ) {
    super(`File modified on server: ${path}`)
    this.name = "FileConflictError"
  }

  static from(err: FetchError, path: string): FileConflictError {
    const body = (err.body && typeof err.body === "object" ? err.body : null) as
      | { error?: { currentMtimeMs?: number; expectedMtimeMs?: number } }
      | null
    return new FileConflictError(
      path,
      typeof body?.error?.currentMtimeMs === "number" ? body.error.currentMtimeMs : null,
      typeof body?.error?.expectedMtimeMs === "number" ? body.error.expectedMtimeMs : null,
    )
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    const text = await res.text()
    if (!text) return null
    return JSON.parse(text)
  } catch {
    return null
  }
}
