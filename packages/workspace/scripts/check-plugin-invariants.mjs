import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const workspacePackageDir = dirname(scriptDir)

function findRepoRoot(start) {
  let current = start
  while (current !== dirname(current)) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) return current
    current = dirname(current)
  }
  throw new Error("Could not find pnpm-workspace.yaml")
}

const repoRoot = findRepoRoot(workspacePackageDir)

const sourceRoots = [
  "packages/workspace/src",
  "packages/workspace/stories",
  "plugins/_template-full/src",
  "apps/workspace-playground/src",
]
  .map((path) => join(repoRoot, path))
  .filter((path) => existsSync(path))

const sourceFilePattern = /\.(?:c|m)?(?:j|t)sx?$/
const skippedDirs = new Set(["node_modules", "dist", "build", "coverage", ".turbo"])
const failures = []

function toRepoPath(file) {
  return relative(repoRoot, file).split("\\").join("/")
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (skippedDirs.has(entry)) continue

    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      walk(fullPath, files)
      continue
    }
    if (stat.isFile() && sourceFilePattern.test(entry)) {
      files.push(fullPath)
    }
  }
  return files
}

function lineNumberFor(content, index) {
  return content.slice(0, index).split("\n").length
}

function addFailure(file, line, message, match) {
  const location = `${toRepoPath(file)}:${line}`
  failures.push(`${location} ${message}${match ? ` (${match})` : ""}`)
}

function isTestPath(repoPath) {
  return repoPath.includes("/__tests__/") || /\.(?:test|spec)\.(?:c|m)?(?:j|t)sx?$/.test(repoPath)
}

function isWorkspaceSharedPluginPath(repoPath) {
  return repoPath.startsWith("packages/workspace/src/shared/plugins/")
}

function isWorkspaceChromePath(repoPath) {
  return repoPath.startsWith("packages/workspace/src/front/chrome/")
}

function isPluginRootFile(repoPath) {
  const parts = repoPath.split("/")
  if (
    parts[0] === "packages" &&
    parts[1] === "workspace" &&
    parts[2] === "src" &&
    parts[3] === "plugins"
  ) {
    return parts.length === 6
  }

  if (parts[0] === "apps" && parts[2] === "src" && parts[3] === "plugins") {
    return parts.length === 6
  }

  if (parts[0] === "apps" && parts[2] === "src" && parts[3] === "plugin") {
    return parts.length === 5
  }

  return false
}

function pluginLayer(repoPath) {
  const parts = repoPath.split("/")

  if (
    parts[0] === "packages" &&
    parts[1] === "workspace" &&
    parts[2] === "src" &&
    parts[3] === "plugins" &&
    parts.length > 6
  ) {
    return parts[5]
  }

  if (
    parts[0] === "apps" &&
    parts[2] === "src" &&
    parts[3] === "plugins" &&
    parts.length > 6
  ) {
    return parts[5]
  }

  if (
    parts[0] === "plugins" &&
    parts[2] === "src" &&
    parts.length > 5
  ) {
    return parts[3]
  }

  return null
}

function checkRegex(file, content, regex, message) {
  for (const match of content.matchAll(regex)) {
    addFailure(file, lineNumberFor(content, match.index ?? 0), message, match[0])
  }
}

const files = sourceRoots.flatMap((root) => walk(root))

for (const file of files) {
  const repoPath = toRepoPath(file)
  const basename = repoPath.slice(repoPath.lastIndexOf("/") + 1)
  const content = readFileSync(file, "utf8")

  checkRegex(
    file,
    content,
    /\b(?:filePatterns|fileFallback|getFileFallback|FileHandlerOutput)\b|\bPanelRegistry\s*\.\s*resolve\s*\(|["']file-handler["']/g,
    "legacy file-routing metadata is not allowed",
  )

  checkRegex(
    file,
    content,
    /\bpackages\/workspace\/src\/front\/data\b|\bsrc\/front\/data\b|from\s+["'](?:\.\.\/)+front\/data(?:\/|["'])/g,
    "front/data is not allowed; plugin data belongs under the owning plugin",
  )

  if (isWorkspaceSharedPluginPath(repoPath)) {
    checkRegex(
      file,
      content,
      /from\s+["']@hachej\/boring-agent(?:\/[^"']*)?["']|import\s*\(\s*["']@hachej\/boring-agent(?:\/[^"']*)?["']\s*\)/g,
      "workspace shared plugin contracts must not import @hachej/boring-agent",
    )
    if (!isTestPath(repoPath)) {
      checkRegex(
        file,
        content,
        /from\s+["'](?:\.\.\/)+(?:front|server)\/[^"']+["']|import\s*\(\s*["'](?:\.\.\/)+(?:front|server)\/[^"']+["']\s*\)|declare\s+module\s+["'](?:\.\.\/)+(?:front|server)\/[^"']+["']/g,
        "workspace shared plugin contracts must not import front/server modules",
      )
    }
  }

  if (
    (isWorkspaceChromePath(repoPath) ||
      repoPath.startsWith("packages/workspace/src/front/events/") ||
      repoPath.startsWith("packages/workspace/src/front/hooks/")) &&
    !isTestPath(repoPath)
  ) {
    checkRegex(
      file,
      content,
      /^\s*(?:import|export)\s+[^'"\n]*from\s+["'](?:\.\.\/)+plugins\/[^"']+["']/gm,
      "workspace core front must not import plugin-domain modules",
    )
    checkRegex(
      file,
      content,
      /import\s*\(\s*["'](?:\.\.\/)+plugins\/[^"']+["']\s*\)/g,
      "workspace core front must not import plugin-domain modules",
    )
  }

  // Reject server/sdk, server/transforms, server/workspace-template — these
  // are agent sandbox assets and must live under agent/ instead.
  if (/\/plugins\/[^/]+\/server\/(?:sdk|transforms|workspace-template)\//.test(repoPath)) {
    addFailure(
      file,
      1,
      "agent sandbox assets (sdk, transforms, workspace-template) must live under agent/, not server/",
    )
  }

  const layer = pluginLayer(repoPath)
  if (layer && !isTestPath(repoPath)) {
    if (layer === "front") {
      checkRegex(
        file,
        content,
        /from\s+["'](?:\.\.\/)+server(?:\/|["'])|import\s*\(\s*["'](?:\.\.\/)+server(?:\/|["'])|declare\s+module\s+["'](?:\.\.\/)+server(?:\/|["'])/g,
        "plugin front layer must not import plugin server layer",
      )
      checkRegex(
        file,
        content,
        /from\s+["'](?:\.\.\/)+agent(?:\/|["'])|import\s*\(\s*["'](?:\.\.\/)+agent(?:\/|["'])|declare\s+module\s+["'](?:\.\.\/)+agent(?:\/|["'])/g,
        "plugin front layer must not import plugin agent layer",
      )
    } else if (layer === "server") {
      checkRegex(
        file,
        content,
        /from\s+["'](?:\.\.\/)+front(?:\/|["'])|import\s*\(\s*["'](?:\.\.\/)+front(?:\/|["'])|declare\s+module\s+["'](?:\.\.\/)+front(?:\/|["'])/g,
        "plugin server layer must not import plugin front layer",
      )
    } else if (layer === "agent") {
      checkRegex(
        file,
        content,
        /from\s+["'](?:\.\.\/)+front(?:\/|["'])|import\s*\(\s*["'](?:\.\.\/)+front(?:\/|["'])|declare\s+module\s+["'](?:\.\.\/)+front(?:\/|["'])/g,
        "plugin agent layer must not import plugin front layer",
      )
    } else if (layer === "shared") {
      checkRegex(
        file,
        content,
        /from\s+["'](?:\.\.\/)+(?:front|server|agent)(?:\/|["'])|import\s*\(\s*["'](?:\.\.\/)+(?:front|server|agent)(?:\/|["'])|declare\s+module\s+["'](?:\.\.\/)+(?:front|server|agent)(?:\/|["'])/g,
        "plugin shared layer must not import plugin front/server/agent layers",
      )
    }
  }

  if (!isPluginRootFile(repoPath)) continue

  addFailure(file, 1, "plugin source files must live under front/, server/, agent/, or shared/")

  if (basename === "catalog.ts") {
    addFailure(file, 1, "plugin catalog files must be named catalogs.ts")
  }
  if (basename === "surfaceTargets.ts") {
    addFailure(file, 1, "plugin target constants belong in constants.ts")
  }
  if (basename === "client.ts") {
    addFailure(file, 1, "plugin client entrypoints must be index.ts or index.tsx")
  }
  if (basename === "server.ts") {
    addFailure(file, 1, "plugin server entrypoints must be server/index.ts")
  }
}

if (failures.length > 0) {
  console.error("[plugin-invariants] failed")
  for (const failure of failures) {
    console.error(`[plugin-invariants] ERR ${failure}`)
  }
  process.exit(1)
}

console.log(`[plugin-invariants] ok (${files.length} source files scanned)`)
