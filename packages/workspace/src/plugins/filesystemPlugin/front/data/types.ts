import type { UiFileResource } from "../../../../shared/types/filesystem"

export interface FileEntry {
  name: string
  kind: "file" | "dir"
  path: string
}

export interface FileContent {
  content: string
  /** Access granted by the resolved filesystem binding, when the server exposes it. */
  access?: "readonly" | "readwrite"
  /**
   * Server-stat'd modification time. Used as the OCC baseline for the
   * next write — the client sends it back as `expectedMtimeMs` so the
   * server can return 409 if the file changed underneath. Optional
   * because not every workspace impl can stat cheaply (sandbox
   * impl is best-effort).
   */
  mtimeMs?: number
}

export type FileSearchResource = UiFileResource

export interface FilesystemCatalogCapabilities {
  read: boolean
  list: boolean
  search: boolean
  write: boolean
  delete: boolean
  move: boolean
  mkdir: boolean
}

export interface FilesystemCatalogEntry {
  filesystem: string
  label: string
  rootDir: string
  access: "readonly" | "readwrite"
  capabilities: FilesystemCatalogCapabilities
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
