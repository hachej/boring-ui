"use client"

import { useEffect } from "react"
import { events, agentMeta, workspaceEvents } from "../../../front/events"
import { useEvent } from "../../../front/events/useEvent"
import { postUiCommand } from "../../../front/bridge"
import { filesystemEvents } from "../shared/events"
import type { FilesystemEventMeta } from "../shared/events"
import type { FilesystemId } from "../../../shared/types/filesystem"

type Op = "write" | "edit" | "unlink" | "rename" | "mkdir"

interface AgentFileChangedChunkData {
  op: Op
  path: string
  oldPath?: string
  toolCallId: string
  existsBefore?: boolean
  filesystem?: FilesystemId
}

const VALID_OPS: ReadonlySet<Op> = new Set([
  "write",
  "edit",
  "unlink",
  "rename",
  "mkdir",
])

function parseChunk(part: unknown): AgentFileChangedChunkData | null {
  if (typeof part !== "object" || part === null) return null
  const root = part as Record<string, unknown>
  if (root.type !== "data-file-changed") return null
  const data = root.data
  if (typeof data !== "object" || data === null) return null
  const d = data as Record<string, unknown>
  if (
    typeof d.op !== "string" ||
    !VALID_OPS.has(d.op as Op) ||
    typeof d.path !== "string" ||
    d.path.length === 0 ||
    typeof d.toolCallId !== "string" ||
    d.toolCallId.length === 0
  ) {
    return null
  }
  if (
    d.oldPath !== undefined &&
    (typeof d.oldPath !== "string" || d.oldPath.length === 0)
  ) {
    return null
  }
  if (d.filesystem !== undefined && (typeof d.filesystem !== "string" || d.filesystem.length === 0)) {
    return null
  }
  return d as unknown as AgentFileChangedChunkData
}

export function emitFilesystemAgentFileChange(part: unknown): void {
  const data = parseChunk(part)
  if (!data) return
  const meta = {
    ...agentMeta(data.toolCallId),
    ...(data.filesystem ? { filesystem: data.filesystem } : {}),
  }

  switch (data.op) {
    case "rename":
      if (data.oldPath) {
        events.emit(filesystemEvents.moved, {
          ...meta,
          from: data.oldPath,
          to: data.path,
        })
      }
      return
    case "unlink":
      events.emit(filesystemEvents.deleted, { ...meta, path: data.path })
      return
    case "mkdir":
      events.emit(filesystemEvents.created, { ...meta, path: data.path, kind: "dir" })
      return
    case "write":
      if (data.existsBefore === false) {
        events.emit(filesystemEvents.created, {
          ...meta,
          path: data.path,
          kind: "file",
        })
      } else {
        events.emit(filesystemEvents.changed, { ...meta, path: data.path })
      }
      return
    case "edit":
      events.emit(filesystemEvents.changed, { ...meta, path: data.path })
      return
  }
}

export interface UseAutoOpenAgentFilesOptions {
  skip?: (path: string) => boolean
  filesOnly?: boolean
}

export function useAutoOpenAgentFiles(
  onOpen: (path: string) => void,
  options: UseAutoOpenAgentFilesOptions = {},
): void {
  const { skip, filesOnly = true } = options

  useEvent(filesystemEvents.created, (e) => {
    if (e.cause !== "agent") return
    if (filesOnly && e.kind !== "file") return
    if (skip?.(e.path)) return
    onOpen(e.path)
  })
}

/** Subscribe to file-changed events. Returns the unsubscribe function. */
export function onFilesystemChanged(
  handler: (payload: FilesystemEventMeta & { path: string }) => void,
): () => void {
  return events.on(filesystemEvents.changed, handler)
}

export function FilesystemAgentFileBridge() {
  useEffect(() => {
    return events.on(workspaceEvents.agentData, ({ part }) => {
      emitFilesystemAgentFileChange(part)
    })
  }, [])

  useAutoOpenAgentFiles((path) => {
    postUiCommand({ kind: "openFile", params: { path } })
  })

  return null
}
