export type FilesystemId = "user" | "company_context" | (string & {})

export const USER_FILESYSTEM_ID = "user" satisfies FilesystemId
export const COMPANY_CONTEXT_FILESYSTEM_ID = "company_context" satisfies FilesystemId

export interface UiFileResource {
  readonly filesystem: FilesystemId
  readonly path: string
}

export type UiFileResourceInput = string | {
  readonly filesystem?: FilesystemId | null
  readonly path: string
}

export function normalizeUiFilesystem(filesystem: FilesystemId | null | undefined): FilesystemId {
  return filesystem && filesystem.length > 0 ? filesystem : USER_FILESYSTEM_ID
}

export function normalizeUiFileResource(input: UiFileResourceInput): UiFileResource {
  if (typeof input === "string") {
    return { filesystem: USER_FILESYSTEM_ID, path: input }
  }
  return {
    filesystem: normalizeUiFilesystem(input.filesystem),
    path: input.path,
  }
}

export function uiFileResourceKey(resource: UiFileResourceInput): string {
  const normalized = normalizeUiFileResource(resource)
  return `${normalized.filesystem}:${normalized.path}`
}

export function withUiFileResource<T extends Record<string, unknown>>(
  value: T,
  fallbackFilesystem?: FilesystemId | null,
): T & UiFileResource {
  const filesystem = typeof value.filesystem === "string"
    ? value.filesystem
    : normalizeUiFilesystem(fallbackFilesystem)
  return {
    ...value,
    filesystem,
    path: String(value.path ?? ""),
  } as T & UiFileResource
}
