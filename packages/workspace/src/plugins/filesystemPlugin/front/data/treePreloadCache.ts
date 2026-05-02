import type { FileEntry } from "./types"

const preloadedTrees = new Map<string, FileEntry[]>()

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
  preloadedTrees.set(treeKey(apiBaseUrl, workspaceId, dir), entries)
}

export function getPreloadedTreeEntries(
  apiBaseUrl: string | null | undefined,
  workspaceId: string | null | undefined,
  dir: string | null | undefined,
): FileEntry[] | undefined {
  return preloadedTrees.get(treeKey(apiBaseUrl, workspaceId, dir))
}
