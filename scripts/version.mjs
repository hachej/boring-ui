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
  "packages/plugin-cli", // @hachej/boring-ui-plugin-cli
  "packages/workspace",
  "packages/agent",
  "packages/ui",
  "plugins/deck",
  "plugins/ask-user",
  "plugins/diagram",
  "plugins/tasks",
  "packages/cli", // @hachej/boring-ui-cli
  "plugins/data-explorer",
  "plugins/data-catalog",
  "plugins/generated-pane",
  "plugins/data-bridge",
  "plugins/bi-dashboard",
  "packages/boring-bash",
  "plugins/boring-governance",
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

function readPublishableVersions() {
  return PUBLISHABLE.map((pkg) => {
    const json = readJson(resolve(root, pkg, "package.json"))
    return { dir: pkg, name: json.name, version: json.version }
  })
}

function assertAlignedVersions() {
  const versions = readPublishableVersions()
  const unique = new Set(versions.map((pkg) => pkg.version))
  if (unique.size === 1) return versions[0].version

  console.error("Publishable package versions are not aligned:")
  for (const pkg of versions) console.error(`  ${pkg.name} (${pkg.dir}) ${pkg.version}`)
  process.exit(1)
}

if (process.argv[2] === "--check") {
  const current = assertAlignedVersions()
  console.log(`Publishable package versions are aligned at ${current}`)
  process.exit(0)
}

const type = process.argv[2] ?? "patch"
if (!["patch", "minor", "major"].includes(type)) {
  console.error(`Unknown bump type: ${type}. Use patch, minor, major, or --check.`)
  process.exit(1)
}

const current = assertAlignedVersions()
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
