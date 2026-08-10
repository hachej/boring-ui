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

/** How a file panel presents a file. One spelling for the whole workspace. */
export const UI_FILE_OPEN_MODES = ["view", "edit", "diff"] as const

export type UiFileOpenMode = typeof UI_FILE_OPEN_MODES[number]

/**
 * The mode when the caller supplied a real one, else `undefined` so callers
 * can spread it away. Every surface that narrows an untrusted `mode` MUST use
 * this — hand-rolled `x === "view" || x === "edit" || x === "diff"` chains had
 * already been copied four times, one per surface that could forget a member.
 */
export function parseFileOpenMode(value: unknown): UiFileOpenMode | undefined {
  return UI_FILE_OPEN_MODES.includes(value as UiFileOpenMode) ? value as UiFileOpenMode : undefined
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
  const filesystemKey = /^[A-Za-z0-9._-]+$/.test(normalized.filesystem)
    ? normalized.filesystem
    : JSON.stringify(normalized.filesystem)
  return `${filesystemKey}:${normalized.path}`
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
