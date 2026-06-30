"use client"

import { useEffect } from "react"
import { useQueryClient, type QueryClient } from "@tanstack/react-query"
import { events } from "../../../../front/events"
import { useApiBaseUrl, useWorkspaceRequestId } from "./DataProvider"
import { filesystemEvents } from "../../shared/events"
import { normalizeUiFilesystem, type FilesystemId } from "../../../../shared/types/filesystem"
import { FILES_QUERY_KEY_SEGMENT } from "../../shared/constants"
import { parentDir } from "../file-tree/treeModel"
import type { FileEntry } from "./types"

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
 *   filesystem:file.moved        → tree(parents of from+to) + files(from+to) + stat(from+to)
 *                                  + everything cached under from/ (dir moves) + search
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
    const settledTimers = new Set<ReturnType<typeof setTimeout>>()
    const runAfterFsSettles = (fn: () => void) => {
      const timer = setTimeout(() => {
        settledTimers.delete(timer)
        fn()
      }, SETTLED_REMOTE_FS_INVALIDATION_MS)
      settledTimers.add(timer)
    }

    const offChanged = events.on(filesystemEvents.changed, (e) => {
      invalidateFile(batch, base, workspaceId, e.path, e.filesystem)
    })
    const offCreated = events.on(filesystemEvents.created, (e) => {
      upsertTreeCache(queryClient, base, workspaceId, e.filesystem, {
        name: basename(e.path),
        kind: e.kind,
        path: e.path,
      })
      const invalidate = () => {
        invalidateTree(batch, base, workspaceId, e.path, e.filesystem)
        if (e.kind === "file") {
          invalidateFile(batch, base, workspaceId, e.path, e.filesystem)
        }
      }
      invalidate()
      if (e.cause === "remote") runAfterFsSettles(invalidate)
    })
    const offMoved = events.on(filesystemEvents.moved, (e) => {
      const movedEntry = getTreeCacheEntry(queryClient, base, workspaceId, e.from, e.filesystem)
      removeTreeCacheEntry(queryClient, base, workspaceId, e.from, e.filesystem)
      if (movedEntry) {
        upsertTreeCache(queryClient, base, workspaceId, e.filesystem, {
          ...movedEntry,
          name: basename(e.to),
          path: e.to,
        })
      }
      const invalidate = () => {
        invalidateTree(batch, base, workspaceId, e.from, e.filesystem)
        invalidateTree(batch, base, workspaceId, e.to, e.filesystem)
        invalidateFile(batch, base, workspaceId, e.from, e.filesystem)
        invalidateFile(batch, base, workspaceId, e.to, e.filesystem)
        invalidateMovedDescendants(batch, base, workspaceId, e.from, e.filesystem)
        invalidateSearch(batch, base, workspaceId)
      }
      invalidate()
      if (e.cause === "remote") runAfterFsSettles(invalidate)
    })
    const offDeleted = events.on(filesystemEvents.deleted, (e) => {
      removeTreeCacheEntry(queryClient, base, workspaceId, e.path, e.filesystem)
      const invalidate = () => {
        invalidateTree(batch, base, workspaceId, e.path, e.filesystem)
        invalidateFile(batch, base, workspaceId, e.path, e.filesystem)
        invalidateSearch(batch, base, workspaceId)
      }
      invalidate()
      if (e.cause === "remote") runAfterFsSettles(invalidate)
    })
    return () => {
      offChanged()
      offCreated()
      offMoved()
      offDeleted()
      for (const timer of settledTimers) clearTimeout(timer)
      settledTimers.clear()
      batch.dispose()
    }
  }, [queryClient, base, workspaceId])
}

const INVALIDATION_BATCH_MS = 25
const SETTLED_REMOTE_FS_INVALIDATION_MS = 250

type QueryKey = readonly unknown[]

type InvalidateFilter = Parameters<QueryClient["invalidateQueries"]>[0]

interface InvalidationBatch {
  enqueue(queryKey: QueryKey): void
  /** Filter-based invalidation; `dedupeKey` coalesces repeats within a batch window. */
  enqueueFilter(dedupeKey: string, filter: InvalidateFilter): void
  dispose(): void
}

function createInvalidationBatch(qc: QueryClient): InvalidationBatch {
  const pending = new Map<string, InvalidateFilter>()
  let timer: ReturnType<typeof setTimeout> | undefined

  const flush = () => {
    timer = undefined
    const filters = Array.from(pending.values())
    pending.clear()
    for (const filter of filters) {
      qc.invalidateQueries(filter)
    }
  }

  const enqueueFilter = (dedupeKey: string, filter: InvalidateFilter) => {
    pending.set(dedupeKey, filter)
    if (timer === undefined) timer = setTimeout(flush, INVALIDATION_BATCH_MS)
  }

  return {
    enqueue(queryKey) {
      enqueueFilter(JSON.stringify(queryKey), { queryKey })
    },
    enqueueFilter,
    dispose() {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      pending.clear()
    },
  }
}

function basename(path: string): string {
  const i = path.lastIndexOf("/")
  return i >= 0 ? path.slice(i + 1) : path
}

function treeKey(base: string, workspaceId: string | null, filesystem: FilesystemId | undefined, dir: string): QueryKey {
  return [base, workspaceId, "tree", normalizeUiFilesystem(filesystem), dir]
}

function getTreeCacheEntry(
  qc: QueryClient,
  base: string,
  workspaceId: string | null,
  path: string,
  filesystem?: FilesystemId,
): FileEntry | undefined {
  const entries = qc.getQueryData<FileEntry[]>(treeKey(base, workspaceId, filesystem, parentDir(path)))
  return entries?.find((entry) => entry.path === path)
}

function upsertTreeCache(
  qc: QueryClient,
  base: string,
  workspaceId: string | null,
  filesystem: FilesystemId | undefined,
  entry: FileEntry,
): void {
  qc.setQueryData<FileEntry[]>(treeKey(base, workspaceId, filesystem, parentDir(entry.path)), (entries) => {
    if (!entries) return entries
    const withoutEntry = entries.filter((candidate) => candidate.path !== entry.path)
    return [...withoutEntry, entry]
  })
}

function removeTreeCacheEntry(
  qc: QueryClient,
  base: string,
  workspaceId: string | null,
  path: string,
  filesystem?: FilesystemId,
): void {
  qc.setQueryData<FileEntry[]>(treeKey(base, workspaceId, filesystem, parentDir(path)), (entries) => {
    if (!entries) return entries
    return entries.filter((entry) => entry.path !== path)
  })
}

function invalidateFile(
  batch: InvalidationBatch,
  base: string,
  workspaceId: string | null,
  path: string,
  filesystem?: FilesystemId,
): void {
  const fs = normalizeUiFilesystem(filesystem)
  batch.enqueue([base, workspaceId, FILES_QUERY_KEY_SEGMENT, fs, path])
  batch.enqueue([base, workspaceId, "stat", fs, path])
}

/**
 * Tree listing queries are keyed `[base, ws, "tree", filesystem, dir]` — invalidate
 * only the listing that actually shows the changed path: its parent
 * (the same `parentDir` the file tree itself keys dirs with).
 */
function invalidateTree(
  batch: InvalidationBatch,
  base: string,
  workspaceId: string | null,
  path: string,
  filesystem?: FilesystemId,
): void {
  batch.enqueue(treeKey(base, workspaceId, filesystem, parentDir(path)))
}

/**
 * A directory move arrives as ONE rename event carrying only the top-
 * level from/to, but file/stat/tree queries are keyed by full path —
 * without this, an editor open on a file under the moved folder keeps
 * stale content on a dead key. Invalidate everything cached AT or
 * UNDER the old path (the dir's own tree listing dies with it too);
 * only ACTIVE queries (open editors/panes) refetch. File moves have no
 * descendants, so for them this only re-covers the exact path.
 */
function invalidateMovedDescendants(
  batch: InvalidationBatch,
  base: string,
  workspaceId: string | null,
  from: string,
  filesystem?: FilesystemId,
): void {
  const fs = normalizeUiFilesystem(filesystem)
  const prefix = `${from}/`
  batch.enqueueFilter(`descendants:${base}:${workspaceId}:${fs}:${prefix}`, {
    predicate: (query) => {
      const key = query.queryKey
      return key[0] === base
        && key[1] === workspaceId
        && (
          ((key[2] === FILES_QUERY_KEY_SEGMENT || key[2] === "stat")
            && key[3] === fs
            && typeof key[4] === "string"
            && (key[4] === from || key[4].startsWith(prefix)))
          || (key[2] === "tree"
            && key[3] === fs
            && typeof key[4] === "string"
            && (key[4] === from || key[4].startsWith(prefix)))
        )
    },
  })
}

function invalidateSearch(
  batch: InvalidationBatch,
  base: string,
  workspaceId: string | null,
): void {
  batch.enqueue([base, workspaceId, "search"])
}
