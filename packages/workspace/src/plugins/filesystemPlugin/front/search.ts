import type { FileEntry } from "./data/types"

export const CLIENT_FILTER_THRESHOLD = 5000

export const DEFAULT_TREE_IGNORE: ReadonlyArray<string | RegExp> = [
  "node_modules",
  ".git",
  ".boring-agent",
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

// Keep semantics in sync with @hachej/boring-agent's mention file-search
// helper. This is intentionally duplicated rather than imported across
// package boundaries so @hachej/boring-agent remains standalone and workspace
// base/plugin code stays agent-neutral.
export function toFileSearchGlob(query: string): string {
  const trimmed = query.trim()
  if (!trimmed) return trimmed
  const glob = /[*?\[\]{}]/.test(trimmed) ? trimmed : `*${trimmed}*`
  return toCaseInsensitiveGlob(glob)
}

function toCaseInsensitiveGlob(glob: string): string {
  let out = ""
  let inClass = false
  let escaped = false

  for (const char of glob) {
    if (escaped) {
      out += char
      escaped = false
      continue
    }
    if (char === "\\") {
      out += char
      escaped = true
      continue
    }
    if (char === "[" && !inClass) {
      inClass = true
      out += char
      continue
    }
    if (char === "]" && inClass) {
      inClass = false
      out += char
      continue
    }
    if (!inClass && /[a-z]/i.test(char)) {
      const lower = char.toLowerCase()
      const upper = char.toUpperCase()
      out += lower === upper ? char : `[${upper}${lower}]`
      continue
    }
    out += char
  }

  return out
}
