"use client"

/**
 * Auto-surface files the agent creates: when a `file:created` event
 * lands on the workspace bus with `origin: "agent"`, invoke the host's
 * open callback. The host owns the actual open mechanism (dockview
 * surface, sidebar tab, dialog, …) — this hook is just the wiring
 * from the file-change stream to that callback.
 *
 * The full pipeline:
 *   agent SSE `data-file-changed` chunks
 *     → ChatCenteredShell forwards to emitAgentFileChange
 *     → workspace event bus emits `file:created` (origin:"agent")
 *     → THIS hook calls onOpen(path)
 *     → host opens the file (typically via SurfaceShellApi.openFile)
 *
 * No-op for `origin:"user"` events (those come from the user's own
 * file-tree actions; the user just clicked, no need to re-open).
 * No-op for directory creates (filesOnly defaults true).
 *
 * Idempotent at the host layer: openFile on a path that already has
 * a tab focuses it.
 */
import { useEvent } from "../events"

export interface UseAutoOpenAgentFilesOptions {
  /**
   * Skip auto-open for paths that match. Useful for noisy artifacts
   * (e.g. `.cache/`, `node_modules/`, lock files) you don't want
   * surfacing every time the agent touches them.
   */
  skip?: (path: string) => boolean

  /**
   * When false, also auto-open directories. Defaults to `true` —
   * directory-create events typically just need the file tree to
   * reveal them, not a workbench tab.
   */
  filesOnly?: boolean
}

export function useAutoOpenAgentFiles(
  onOpen: (path: string) => void,
  options: UseAutoOpenAgentFilesOptions = {},
): void {
  const { skip, filesOnly = true } = options

  useEvent("file:created", (e) => {
    if (e.cause !== "agent") return
    if (filesOnly && e.kind !== "file") return
    if (skip?.(e.path)) return
    onOpen(e.path)
  })
}
