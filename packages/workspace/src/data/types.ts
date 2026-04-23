export interface FileEntry {
  name: string
  kind: "file" | "dir"
  path: string
}

export interface FileContent {
  content: string
}

export interface FileStat {
  size: number
  mtimeMs: number
  kind: "file" | "dir"
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
