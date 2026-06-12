"use client"

import { useEffect } from "react"
import { useQueryClient, type QueryClient } from "@tanstack/react-query"
import { events } from "../../../../front/events"
import { useApiBaseUrl, useWorkspaceRequestId } from "./DataProvider"
import { filesystemEvents } from "../../shared/events"
import { FILES_QUERY_KEY_SEGMENT } from "../../shared/constants"

/**
 * Single source of truth for translating workspace bus `filesystem:file.*` events
 * into React Query invalidation. Mounted once inside `DataProvider`.
 *
 * Why centralized:
 *   - Prior version had `useFileChangeStream` in `@hachej/boring-agent` doing
 *     its own invalidation with the wrong key shape (`['file', path]`
 *     vs the workspace's `[base, "files", path]`). Editor never
 *     refreshed on agent edits.
 *   - Now: agent SSE chunks → ChatPanelHost forwards via
 *     filesystem agent-data bridge → filesystem bus event → THIS hook → invalidate.
 *     User actions (`useFileWrite`, etc.) emit onto the same bus →
 *     same invalidator. One path, one bug surface.
 *
 * Granular invalidation per event kind so a content-only change
 * doesn't nuke tree/search caches:
 *   filesystem:file.changed      → files(path) + stat(path)
 *   filesystem:file.created file → tree(parent) + files(path) + stat(path)
 *   filesystem:file.created dir  → tree(parent)       (no file content, no stat fetch)
 *   filesystem:file.moved        → tree(parents of from+to) + files(from+to) + stat(from+to) + search
 *   filesystem:file.deleted      → tree(parent) + files(path) + stat(path) + search
 *
 * Tree invalidation targets the changed path's PARENT listing, not the
 * whole `tree` prefix — during event storms (large dir moves, builds)
 * a prefix invalidation refetched every mounted listing per batch.
 */
export function useFileEventInvalidation(): void {
  const queryClient = useQueryClient()
  const base = useApiBaseUrl()
  const workspaceId = useWorkspaceRequestId()

  useEffect(() => {
    const batch = createInvalidationBatch(queryClient)

    const offChanged = events.on(filesystemEvents.changed, (e) => {
      invalidateFile(batch, base, workspaceId, e.path)
    })
    const offCreated = events.on(filesystemEvents.created, (e) => {
      invalidateTree(batch, base, workspaceId, e.path)
      if (e.kind === "file") {
        invalidateFile(batch, base, workspaceId, e.path)
      }
    })
    const offMoved = events.on(filesystemEvents.moved, (e) => {
      invalidateTree(batch, base, workspaceId, e.from)
      invalidateTree(batch, base, workspaceId, e.to)
      invalidateFile(batch, base, workspaceId, e.from)
      invalidateFile(batch, base, workspaceId, e.to)
      invalidateSearch(batch, base, workspaceId)
    })
    const offDeleted = events.on(filesystemEvents.deleted, (e) => {
      invalidateTree(batch, base, workspaceId, e.path)
      invalidateFile(batch, base, workspaceId, e.path)
      invalidateSearch(batch, base, workspaceId)
    })
    return () => {
      offChanged()
      offCreated()
      offMoved()
      offDeleted()
      batch.dispose()
    }
  }, [queryClient, base, workspaceId])
}

const INVALIDATION_BATCH_MS = 25

type QueryKey = readonly unknown[]

interface InvalidationBatch {
  enqueue(queryKey: QueryKey): void
  dispose(): void
}

function createInvalidationBatch(qc: QueryClient): InvalidationBatch {
  const pending = new Map<string, QueryKey>()
  let timer: ReturnType<typeof setTimeout> | undefined

  const flush = () => {
    timer = undefined
    const keys = Array.from(pending.values())
    pending.clear()
    for (const queryKey of keys) {
      qc.invalidateQueries({ queryKey })
    }
  }

  return {
    enqueue(queryKey) {
      pending.set(JSON.stringify(queryKey), queryKey)
      if (timer === undefined) timer = setTimeout(flush, INVALIDATION_BATCH_MS)
    },
    dispose() {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      pending.clear()
    },
  }
}

function invalidateFile(
  batch: InvalidationBatch,
  base: string,
  workspaceId: string | null,
  path: string,
): void {
  batch.enqueue([base, workspaceId, FILES_QUERY_KEY_SEGMENT, path])
  batch.enqueue([base, workspaceId, "stat", path])
}

/**
 * Tree listing queries are keyed `[base, ws, "tree", dir]` — invalidate
 * only the listing that actually shows the changed path: its parent.
 * Matches `parentDir` in `file-tree/treeModel.ts` ("." for top-level).
 */
function treeParentDir(path: string): string {
  const i = path.lastIndexOf("/")
  return i > 0 ? path.slice(0, i) : "."
}

function invalidateTree(
  batch: InvalidationBatch,
  base: string,
  workspaceId: string | null,
  path: string,
): void {
  batch.enqueue([base, workspaceId, "tree", treeParentDir(path)])
}

function invalidateSearch(
  batch: InvalidationBatch,
  base: string,
  workspaceId: string | null,
): void {
  batch.enqueue([base, workspaceId, "search"])
}
