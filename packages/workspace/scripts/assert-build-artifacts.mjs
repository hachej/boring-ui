import { access } from "node:fs/promises"
import { constants } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)

// Every entry declared in package.json#exports must produce a real file.
// Mismatch between exports and what's built is the bug this script
// catches — the failure mode that motivated cleanup-plan Phase 0.
const requiredFiles = [
  "dist/workspace.js",
  "dist/workspace.d.ts",
  "dist/testing.js",
  "dist/testing.d.ts",
  "dist/ui-shadcn.js",
  "dist/ui-shadcn.d.ts",
  "dist/app-front.js",
  "dist/app-front.d.ts",
  "dist/app-server.js",
  "dist/app-server.d.ts",
  "dist/server.js",
  "dist/server.d.ts",
  "dist/shared.js",
  "dist/shared.d.ts",
  "dist/events.js",
  "dist/events.d.ts",
]

async function exists(rel) {
  try {
    await access(path.resolve(packageRoot, rel), constants.F_OK)
    return true
  } catch {
    return false
  }
}

const missing = []
for (const rel of requiredFiles) {
  if (!(await exists(rel))) missing.push(rel)
}

if (missing.length > 0) {
  console.error(
    `assert-build-artifacts: missing ${missing.length} required artifact(s):`,
  )
  for (const m of missing) console.error(`  - ${m}`)
  console.error(
    "\nFix: ensure tsup.config.ts emits server + shared, and " +
      "vite.config.ts emits workspace + testing + ui-shadcn.",
  )
  process.exit(1)
}

console.log(
  `assert-build-artifacts: all ${requiredFiles.length} artifacts present`,
)
