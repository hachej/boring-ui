"use client"

import { useEffect } from "react"
import { useQueryClient, type QueryClient } from "@tanstack/react-query"
import { events } from "../events"
import { useApiBaseUrl, useWorkspaceRequestId } from "./DataProvider"

/**
 * Single source of truth for translating workspace bus `file:*` events
 * into React Query invalidation. Mounted once inside `DataProvider`.
 *
 * Why centralized:
 *   - Prior version had `useFileChangeStream` in `@boring/agent` doing
 *     its own invalidation with the wrong key shape (`['file', path]`
 *     vs the workspace's `[base, "files", path]`). Editor never
 *     refreshed on agent edits.
 *   - Now: agent SSE chunks → ChatPanelHost forwards via
 *     `emitAgentFileChange` → bus → THIS hook → invalidate.
 *     User actions (`useFileWrite`, etc.) emit onto the same bus →
 *     same invalidator. One path, one bug surface.
 *
 * Granular invalidation per event kind so a content-only change
 * doesn't nuke tree/search caches:
 *   file:changed                 → files(path) + stat(path)
 *   file:created (file)          → tree + stat(path)  (file appears in listing)
 *   file:created (dir)           → tree only          (no file content, no stat fetch)
 *   file:moved                   → tree + files(from+to) + stat(from+to) + search
 *   file:deleted                 → tree + files(path) + stat(path) + search
 */
export function useFileEventInvalidation(): void {
  const queryClient = useQueryClient()
  const base = useApiBaseUrl()
  const workspaceId = useWorkspaceRequestId()

  useEffect(() => {
    const offChanged = events.on("file:changed", (e) => {
      invalidateFile(queryClient, base, workspaceId, e.path)
    })
    const offCreated = events.on("file:created", (e) => {
      invalidateTree(queryClient, base, workspaceId)
      if (e.kind === "file") {
        invalidateStat(queryClient, base, workspaceId, e.path)
      }
    })
    const offMoved = events.on("file:moved", (e) => {
      invalidateTree(queryClient, base, workspaceId)
      invalidateFile(queryClient, base, workspaceId, e.from)
      invalidateFile(queryClient, base, workspaceId, e.to)
      invalidateSearch(queryClient, base, workspaceId)
    })
    const offDeleted = events.on("file:deleted", (e) => {
      invalidateTree(queryClient, base, workspaceId)
      invalidateFile(queryClient, base, workspaceId, e.path)
      invalidateSearch(queryClient, base, workspaceId)
    })
    return () => {
      offChanged()
      offCreated()
      offMoved()
      offDeleted()
    }
  }, [queryClient, base, workspaceId])
}

function invalidateFile(
  qc: QueryClient,
  base: string,
  workspaceId: string | null,
  path: string,
): void {
  qc.invalidateQueries({ queryKey: [base, workspaceId, "files", path] })
  qc.invalidateQueries({ queryKey: [base, workspaceId, "stat", path] })
}

function invalidateStat(
  qc: QueryClient,
  base: string,
  workspaceId: string | null,
  path: string,
): void {
  qc.invalidateQueries({ queryKey: [base, workspaceId, "stat", path] })
}

function invalidateTree(
  qc: QueryClient,
  base: string,
  workspaceId: string | null,
): void {
  qc.invalidateQueries({ queryKey: [base, workspaceId, "tree"] })
}

function invalidateSearch(
  qc: QueryClient,
  base: string,
  workspaceId: string | null,
): void {
  qc.invalidateQueries({ queryKey: [base, workspaceId, "search"] })
}
