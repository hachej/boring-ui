/**
 * Bridge from the agent SSE stream (`data-file-changed` chunks) to the
 * unified workspace event bus. The agent owns the SSE schema; the
 * workspace owns the event bus. This file lives on the *workspace* side
 * to avoid a circular dependency (`@boring/workspace` already depends
 * on `@boring/agent`, not the other way) — that means we redeclare the
 * SSE chunk shape here. Small dupe, clean package boundary.
 *
 * Hosts wire `emitAgentFileChange` into the agent client's `onData`
 * callback (`ChatCenteredShell` does this automatically). Once
 * wired, an agent-driven rename updates open editor panes the same
 * way a user-driven rename does, just with `cause: 'agent'`.
 *
 * See `docs/plans/UNIFIED_EVENT_BUS.md` step 3 for the broader plan.
 */

import { events } from "./index"
import { agentMeta } from "./types"

type Op = "write" | "edit" | "unlink" | "rename" | "mkdir"

interface AgentFileChangedChunkData {
  op: Op
  path: string
  oldPath?: string
  toolCallId: string
  /**
   * Server-supplied disambiguator for `op: 'write'`. When `false`,
   * the write created a brand-new file (→ `file:created`); otherwise
   * we treat it as a content overwrite (→ `file:changed`). Adding
   * this field server-side is a separate small PR — until then the
   * safer default is "changed", which keeps open editor panes in
   * sync without false-positive "new file" effects on the tree.
   */
  existsBefore?: boolean
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
  // oldPath is optional, but when present it must be a non-empty string.
  // The rename emit further guards `if (data.oldPath)`, but checking the
  // type here keeps the boundary contract clean.
  if (
    d.oldPath !== undefined &&
    (typeof d.oldPath !== "string" || d.oldPath.length === 0)
  ) {
    return null
  }
  return d as unknown as AgentFileChangedChunkData
}

/**
 * Translate one `data-file-changed` SSE chunk into a workspace bus
 * event. Safe to call with arbitrary input — non-matching chunks are a
 * no-op.
 */
export function emitAgentFileChange(part: unknown): void {
  const data = parseChunk(part)
  if (!data) return
  const meta = agentMeta(data.toolCallId)
  switch (data.op) {
    case "rename":
      if (data.oldPath) {
        events.emit("file:moved", {
          ...meta,
          from: data.oldPath,
          to: data.path,
        })
      }
      return
    case "unlink":
      events.emit("file:deleted", { ...meta, path: data.path })
      return
    case "mkdir":
      events.emit("file:created", { ...meta, path: data.path, kind: "dir" })
      return
    case "write":
      // Default to "changed" — overwrites are far more common from the
      // agent than fresh creates, and the tree react-query invalidation
      // already covers the "new file in listing" UX.
      if (data.existsBefore === false) {
        events.emit("file:created", {
          ...meta,
          path: data.path,
          kind: "file",
        })
      } else {
        events.emit("file:changed", { ...meta, path: data.path })
      }
      return
    case "edit":
      events.emit("file:changed", { ...meta, path: data.path })
      return
  }
}
