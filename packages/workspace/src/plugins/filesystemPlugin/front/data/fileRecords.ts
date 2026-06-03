export type FileRecordsFormat = "json-array" | "ndjson" | "csv"

export interface FileRecordsSource {
  kind: "file"
  path: string
  format: FileRecordsFormat
  recordSet?: string
}

export interface FileRecordsResult {
  source: FileRecordsSource
  path: string
  format: FileRecordsFormat
  columns: { name: string; type: string }[]
  rows: Record<string, unknown>[]
  total: number
  hasMore: boolean
  offset: number
  limit: number
  mtimeMs?: number
}

export interface ReadFileRecordsOptions {
  path: string
  recordSet?: string
  offset?: number
  limit?: number
  q?: string
  apiBaseUrl?: string
  headers?: Record<string, string>
  workspaceId?: string
  signal?: AbortSignal
}

function joinUrl(base: string | undefined, path: string): string {
  if (!base) return path
  return `${base.replace(/\/$/, "")}${path}`
}

function workspaceIdFromLocation(): string | undefined {
  if (typeof window === "undefined") return undefined
  const match = window.location.pathname.match(/^\/workspace\/([^/?#]+)/)
  if (!match?.[1]) return undefined
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

export async function readFileRecords(options: ReadFileRecordsOptions): Promise<FileRecordsResult> {
  const params = new URLSearchParams({ path: options.path })
  if (options.recordSet) params.set("recordSet", options.recordSet)
  if (options.offset !== undefined) params.set("offset", String(options.offset))
  if (options.limit !== undefined) params.set("limit", String(options.limit))
  if (options.q) params.set("q", options.q)

  const headers: Record<string, string> = { ...(options.headers ?? {}) }
  const workspaceId = options.workspaceId ?? workspaceIdFromLocation()
  if (workspaceId && !Object.keys(headers).some((key) => key.toLowerCase() === "x-boring-workspace-id")) {
    headers["x-boring-workspace-id"] = workspaceId
  }

  const response = await fetch(joinUrl(options.apiBaseUrl, `/api/v1/files/records?${params}`), {
    method: "GET",
    headers,
    signal: options.signal,
  })
  if (!response.ok) {
    throw new Error(`readFileRecords failed: HTTP ${response.status}`)
  }
  return await response.json() as FileRecordsResult
}
