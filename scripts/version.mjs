/**
 * Bump version across all publishable packages.
 * Usage: node scripts/version.mjs [patch|minor|major]
 */
import { readFileSync, writeFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { execSync } from "node:child_process"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, "..")

const PUBLISHABLE = [
  "packages/core",
  "packages/workspace",
  "packages/agent",
  "packages/ui",
  "packages/cli",
]

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n")
}

function bumpVersion(version, type) {
  const [major, minor, patch] = version.split(".").map(Number)
  if (type === "major") return `${major + 1}.0.0`
  if (type === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

const type = process.argv[2] ?? "patch"
if (!["patch", "minor", "major"].includes(type)) {
  console.error(`Unknown bump type: ${type}. Use patch, minor, or major.`)
  process.exit(1)
}

// Read current version from first publishable package
const firstPkg = readJson(resolve(root, PUBLISHABLE[0], "package.json"))
const current = firstPkg.version
const next = bumpVersion(current, type)

console.log(`${current} → ${next} (${type})`)

for (const pkg of PUBLISHABLE) {
  const path = resolve(root, pkg, "package.json")
  const json = readJson(path)
  json.version = next
  writeJson(path, json)
  console.log(`  updated ${json.name}`)
}

// Reinstall to update lockfile
execSync("pnpm install", { cwd: root, stdio: "inherit" })

console.log(`\nDone. Commit, tag v${next}, and push to release.`)
