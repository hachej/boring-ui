import type { FilesystemEventMap } from "../shared/events"

declare module "../../../front/events/types" {
  interface WorkspacePluginEventMap extends FilesystemEventMap {}
}

export type { FilesystemEventMap, FilesystemEventMeta } from "../shared/events"
