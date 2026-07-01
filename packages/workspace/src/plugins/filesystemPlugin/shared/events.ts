import type { FilesystemId } from "../../../shared/types/filesystem"

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

export type FilesystemEventMeta = (
  | { cause: "user" }
  | { cause: "agent"; toolCallId: string }
  | { cause: "remote"; toolCallId?: string }
) & { ts: number; filesystem?: FilesystemId }

export interface FilesystemEventMap {
  [FILESYSTEM_FILE_MOVED_EVENT]: FilesystemEventMeta & { from: string; to: string }
  [FILESYSTEM_FILE_DELETED_EVENT]: FilesystemEventMeta & { path: string }
  [FILESYSTEM_FILE_CREATED_EVENT]: FilesystemEventMeta & { path: string; kind: "file" | "dir" }
  [FILESYSTEM_FILE_CHANGED_EVENT]: FilesystemEventMeta & { path: string }
}
