export interface FileEntry {
  name: string
  kind: "file" | "dir"
  path: string
}

export interface FileContent {
  content: string
  /**
   * Server-stat'd modification time. Used as the OCC baseline for the
   * next write — the client sends it back as `expectedMtimeMs` so the
   * server can return 409 if the file changed underneath. Optional
   * because not every workspace impl can stat cheaply (sandbox
   * impl is best-effort).
   */
  mtimeMs?: number
}

export interface FileStat {
  size: number
  mtimeMs: number
  kind: "file" | "dir"
}

export interface GitUrlMetadata {
  enabled: boolean
  reason?: string
  url?: string
}

export interface FetchClientOptions {
  apiBaseUrl: string
  authHeaders?: Record<string, string>
  onAuthError?: (statusCode: number) => void
  onTimeout?: (route: string) => void
  timeout?: number
  maxRetries?: number
  retryBaseMs?: number
}
