import type { FileEntry } from "./types"

interface PreloadedTree {
  entries: FileEntry[]
  /** When the snapshot was taken, so consumers can judge its age. */
  updatedAt: number
}

const preloadedTrees = new Map<string, PreloadedTree>()

function normalizeBase(apiBaseUrl: string | null | undefined): string {
  return (apiBaseUrl ?? "").replace(/\/$/, "")
}

function normalizeDir(dir: string | null | undefined): string {
  return dir && dir.length > 0 ? dir : "."
}

function treeKey(apiBaseUrl: string | null | undefined, workspaceId: string | null | undefined, dir: string | null | undefined): string {
  return `${normalizeBase(apiBaseUrl)}\u0000${workspaceId ?? ""}\u0000${normalizeDir(dir)}`
}

export function setPreloadedTreeEntries(
  apiBaseUrl: string | null | undefined,
  workspaceId: string | null | undefined,
  dir: string | null | undefined,
  entries: FileEntry[],
): void {
  preloadedTrees.set(treeKey(apiBaseUrl, workspaceId, dir), { entries, updatedAt: Date.now() })
}

export function getPreloadedTreeEntries(
  apiBaseUrl: string | null | undefined,
  workspaceId: string | null | undefined,
  dir: string | null | undefined,
): FileEntry[] | undefined {
  return preloadedTrees.get(treeKey(apiBaseUrl, workspaceId, dir))?.entries
}

/**
 * Age of the cached snapshot, for seeding a query's `initialDataUpdatedAt`.
 * Without it a preload is treated as freshly fetched every time it is read,
 * so a remount long after boot never refetches and shows a stale tree.
 */
export function getPreloadedTreeUpdatedAt(
  apiBaseUrl: string | null | undefined,
  workspaceId: string | null | undefined,
  dir: string | null | undefined,
): number | undefined {
  return preloadedTrees.get(treeKey(apiBaseUrl, workspaceId, dir))?.updatedAt
}
