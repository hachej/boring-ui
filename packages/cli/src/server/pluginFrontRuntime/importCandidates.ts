import { extname } from "node:path"

const IMPORT_RESOLVE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".json", ".svg"]
const DIRECTORY_INDEX_CANDIDATES = [
  "index.ts",
  "index.tsx",
  "index.js",
  "index.jsx",
  "index.mjs",
  "index.cjs",
  "index.css",
]

/**
 * Node/Vite-style resolution candidates for an extensionless import target:
 * the target itself, then each known extension, then each directory index
 * file. `join` supplies the flavour of path arithmetic (snapshot subpaths vs
 * absolute filesystem paths).
 */
export function importResolutionCandidates(rawTarget: string, join: (base: string, part: string) => string): Set<string> {
  const candidates = new Set<string>([rawTarget])
  if (extname(rawTarget) === "") {
    for (const suffix of IMPORT_RESOLVE_EXTENSIONS) candidates.add(`${rawTarget}${suffix}`)
    for (const indexFile of DIRECTORY_INDEX_CANDIDATES) candidates.add(join(rawTarget, indexFile))
  }
  return candidates
}
