import type { UiFileResource } from "../../../../shared/types/filesystem"
export type {
  FilesystemCatalogCapabilities,
  FilesystemCatalogEntry,
} from "@hachej/boring-bash/shared"

export type FilesystemCapability = "read" | "write" | "create-child" | "delete" | "move-from"

export type FilesystemCapabilities = Readonly<Record<FilesystemCapability, boolean>>

export interface FilesystemAccessProjection {
  /** Compatibility summary only; operation controls consume `capabilities`. */
  access?: "readonly" | "readwrite"
  capabilities?: FilesystemCapabilities
}

export interface FileEntry extends FilesystemAccessProjection {
  name: string
  kind: "file" | "dir"
  path: string
}

export interface FileTreeListing extends FilesystemAccessProjection {
  entries: FileEntry[]
}

/** Browser presentation helper only; the server remains the mutation authority. */
export function allowsFilesystemCapability(
  projection: FilesystemAccessProjection | undefined,
  capability: FilesystemCapability,
  fallbackAccess: "readonly" | "readwrite" = "readwrite",
): boolean {
  if (projection?.capabilities) return projection.capabilities[capability] === true
  return (projection?.access ?? fallbackAccess) !== "readonly"
}

export interface FileContent extends FilesystemAccessProjection {
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

export type FileSearchResource = UiFileResource

export interface FileStat extends FilesystemAccessProjection {
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
