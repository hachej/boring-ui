import type { EventMeta } from "../../front/events/types"

export const FILESYSTEM_FILE_CHANGED_EVENT = "filesystem:file.changed"
export const FILESYSTEM_FILE_CREATED_EVENT = "filesystem:file.created"
export const FILESYSTEM_FILE_MOVED_EVENT = "filesystem:file.moved"
export const FILESYSTEM_FILE_DELETED_EVENT = "filesystem:file.deleted"

export const filesystemEvents = {
  changed: FILESYSTEM_FILE_CHANGED_EVENT,
  created: FILESYSTEM_FILE_CREATED_EVENT,
  moved: FILESYSTEM_FILE_MOVED_EVENT,
  deleted: FILESYSTEM_FILE_DELETED_EVENT,
} as const

export interface FilesystemEventMap {
  [FILESYSTEM_FILE_MOVED_EVENT]: EventMeta & { from: string; to: string }
  [FILESYSTEM_FILE_DELETED_EVENT]: EventMeta & { path: string }
  [FILESYSTEM_FILE_CREATED_EVENT]: EventMeta & { path: string; kind: "file" | "dir" }
  [FILESYSTEM_FILE_CHANGED_EVENT]: EventMeta & { path: string }
}

declare module "../../front/events/types" {
  interface WorkspacePluginEventMap extends FilesystemEventMap {}
}
