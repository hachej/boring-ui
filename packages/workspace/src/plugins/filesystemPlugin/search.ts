import type { FileEntry } from "../../front/data/types"

export const CLIENT_FILTER_THRESHOLD = 5000

export const DEFAULT_TREE_IGNORE: ReadonlyArray<string | RegExp> = [
  "node_modules",
  ".git",
  "dist",
  "test-results",
  /^\.tsbuildinfo/,
  ".vite",
  ".turbo",
  ".next",
  ".cache",
]

export function matchesAny(name: string, patterns: ReadonlyArray<string | RegExp>): boolean {
  for (const p of patterns) {
    if (typeof p === "string" ? p === name : p.test(name)) return true
  }
  return false
}

export function filterIgnoredEntries(
  entries: FileEntry[] | undefined,
  ignoreNames: ReadonlyArray<string | RegExp>,
): FileEntry[] | undefined {
  if (ignoreNames.length === 0) return entries
  return entries?.filter((entry) => !matchesAny(entry.name, ignoreNames))
}

export function toFileSearchGlob(query: string): string {
  const trimmed = query.trim()
  if (!trimmed) return trimmed
  if (/[*?\[\]{}]/.test(trimmed)) return trimmed
  return `*${trimmed}*`
}
