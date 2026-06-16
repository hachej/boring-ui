import { access, readFile } from "node:fs/promises"
import { constants } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Every entry declared in package.json#exports must produce a real file, and
// every @import inside a shipped stylesheet must resolve to a built sibling.
// Mismatch between exports and what's built — or a stylesheet that @imports a
// file the build forgot to copy — is the bug this script catches. That is the
// exact failure mode behind the chat-first CSS relocation (#327): styles.css
// shipped with `@import "./chatFirst/chatFirstPublicShell.css"` but the file
// wasn't copied into dist, so consumers' bundlers failed to resolve it.
//
// Intentionally dts-agnostic: type declarations are built conditionally (the
// Docker image skips them via `tsup --no-dts` for speed), so this guard checks
// only the runtime artifacts (JS + CSS) and therefore runs identically in
// `pnpm build` and the Docker build path.

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)

async function exists(rel) {
  try {
    await access(path.resolve(packageRoot, rel), constants.F_OK)
    return true
  } catch {
    return false
  }
}

// Collect every runtime artifact referenced by package.json#exports.
// - a string value that is a .css file (e.g. "./theme.css")
// - the `import` condition of an object value (the .js entry)
// `types` (.d.ts) is skipped on purpose — see header.
function collectRequiredFiles(exportsField) {
  const required = new Set()
  for (const value of Object.values(exportsField)) {
    if (typeof value === "string") {
      if (value.endsWith(".css")) required.add(value)
    } else if (value && typeof value === "object" && typeof value.import === "string") {
      required.add(value.import)
    }
  }
  return [...required].map((p) => p.replace(/^\.\//, ""))
}

const pkg = JSON.parse(
  await readFile(path.resolve(packageRoot, "package.json"), "utf8"),
)
const requiredFiles = collectRequiredFiles(pkg.exports ?? {})

const missing = []
for (const rel of requiredFiles) {
  if (!(await exists(rel))) missing.push(rel)
}

if (missing.length > 0) {
  console.error(
    `assert-build-artifacts: missing ${missing.length} exported artifact(s):`,
  )
  for (const m of missing) console.error(`  - ${m}`)
  console.error(
    "\nFix: ensure tsup emits every exports#import entry, and that tsup.config.ts's " +
      "onSuccess hook copies every hand-authored CSS file referenced by exports.",
  )
  process.exit(1)
}

// Recursively assert that every relative @import inside a shipped stylesheet
// resolves to a built file. This is the check that would have caught #327.
const IMPORT_RE = /@import\s+(?:url\()?["']([^"']+)["']\)?/g
const cssSeen = new Set()
const importMisses = []

async function assertCssImports(relCssPath) {
  if (cssSeen.has(relCssPath)) return
  cssSeen.add(relCssPath)
  const text = await readFile(path.resolve(packageRoot, relCssPath), "utf8")
  for (const match of text.matchAll(IMPORT_RE)) {
    const spec = match[1]
    // Only validate relative imports — bare specifiers (e.g. "tailwindcss",
    // "@hachej/...") are resolved by the consumer's bundler from node_modules.
    if (!spec.startsWith(".")) continue
    const target = path.join(path.dirname(relCssPath), spec)
    if (!(await exists(target))) {
      importMisses.push({ from: relCssPath, spec, target })
      continue
    }
    if (target.endsWith(".css")) await assertCssImports(target)
  }
}

for (const rel of requiredFiles) {
  if (rel.endsWith(".css")) await assertCssImports(rel)
}

if (importMisses.length > 0) {
  console.error(
    `assert-build-artifacts: ${importMisses.length} unresolved CSS @import(s):`,
  )
  for (const m of importMisses) {
    console.error(`  - ${m.from} @imports "${m.spec}" -> missing ${m.target}`)
  }
  console.error(
    "\nFix: add the missing stylesheet to tsup.config.ts's CSS_ASSETS so the " +
      "onSuccess hook copies it into dist.",
  )
  process.exit(1)
}

console.log(
  `assert-build-artifacts: all ${requiredFiles.length} exported artifact(s) present, ` +
    `${cssSeen.size} stylesheet(s) with resolvable @imports`,
)
