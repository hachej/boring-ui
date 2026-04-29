"use client"

import { useEffect } from "react"
import { useQueryClient, type QueryClient } from "@tanstack/react-query"
import { events } from "../front/events"
import { useApiBaseUrl } from "./DataProvider"

/**
 * Single source of truth for translating workspace bus `file:*` events
 * into React Query invalidation. Mounted once inside `DataProvider`.
 *
 * Why centralized:
 *   - Prior version had `useFileChangeStream` in `@boring/agent` doing
 *     its own invalidation with the wrong key shape (`['file', path]`
 *     vs the workspace's `[base, "files", path]`). Editor never
 *     refreshed on agent edits.
 *   - Now: agent SSE chunks → ChatCenteredShell forwards via
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

  useEffect(() => {
    const offChanged = events.on("file:changed", (e) => {
      invalidateFile(queryClient, base, e.path)
    })
    const offCreated = events.on("file:created", (e) => {
      invalidateTree(queryClient, base)
      if (e.kind === "file") {
        invalidateStat(queryClient, base, e.path)
      }
    })
    const offMoved = events.on("file:moved", (e) => {
      invalidateTree(queryClient, base)
      invalidateFile(queryClient, base, e.from)
      invalidateFile(queryClient, base, e.to)
      invalidateSearch(queryClient, base)
    })
    const offDeleted = events.on("file:deleted", (e) => {
      invalidateTree(queryClient, base)
      invalidateFile(queryClient, base, e.path)
      invalidateSearch(queryClient, base)
    })
    return () => {
      offChanged()
      offCreated()
      offMoved()
      offDeleted()
    }
  }, [queryClient, base])
}

function invalidateFile(qc: QueryClient, base: string, path: string): void {
  qc.invalidateQueries({ queryKey: [base, "files", path] })
  qc.invalidateQueries({ queryKey: [base, "stat", path] })
}

function invalidateStat(qc: QueryClient, base: string, path: string): void {
  qc.invalidateQueries({ queryKey: [base, "stat", path] })
}

function invalidateTree(qc: QueryClient, base: string): void {
  qc.invalidateQueries({ queryKey: [base, "tree"] })
}

function invalidateSearch(qc: QueryClient, base: string): void {
  qc.invalidateQueries({ queryKey: [base, "search"] })
}
