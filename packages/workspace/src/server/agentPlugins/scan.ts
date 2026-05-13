import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"
import {
  isSafePluginRelativePath,
  isValidBoringPluginId,
  validateBoringPluginManifest,
  type BoringPackagePiField,
  type BoringPluginPackageJson,
} from "../../shared/plugins/manifest"
import type { BoringServerPluginManifest } from "./types"

export interface BoringPluginPreflightIssue {
  pluginDir: string
  pluginId?: string
  code: "MISSING_PACKAGE_JSON" | "INVALID_PACKAGE_JSON" | "INVALID_PLUGIN_METADATA"
  message: string
}

export interface BoringPluginPreflightResult {
  ok: boolean
  errors: BoringPluginPreflightIssue[]
}

interface DiscoveredBoringPluginDirs {
  dirs: string[]
  missingPackageJson: string[]
}

function pluginIdFromPackageJson(pkg: { name?: string }, rootDir: string): string {
  const name = typeof pkg.name === "string" && pkg.name.trim() ? pkg.name.trim() : undefined
  return (name ?? rootDir.split(/[\/]/).at(-1) ?? "plugin").replace(/^@/, "").replaceAll("/", "-")
}

function safePluginIdFromPackageJson(pkg: BoringPluginPackageJson | Record<string, unknown>, rootDir: string): string | undefined {
  const id = pluginIdFromPackageJson(pkg as { name?: string }, rootDir)
  return isValidBoringPluginId(id) ? id : undefined
}

function parsePackageJson(rootDir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")) as Record<string, unknown>
}

function hasPluginMetadata(pkg: Record<string, unknown>): boolean {
  return pkg.boring !== undefined || pkg.pi !== undefined
}

function isInsideRoot(rootReal: string, targetReal: string): boolean {
  const rel = relative(rootReal, targetReal)
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}

function nearestExistingAncestor(path: string, rootDir: string): string | undefined {
  let current = path
  const root = resolve(rootDir)
  while (!existsSync(current)) {
    const parent = dirname(current)
    if (parent === current) return undefined
    if (!isInsideRoot(root, parent) && parent !== root) return undefined
    current = parent
  }
  return current
}

function containedPluginPath(rootDir: string, value: string): string | undefined {
  const resolved = resolve(rootDir, value)
  const rootReal = realpathSync(rootDir)
  const existing = nearestExistingAncestor(resolved, rootDir)
  if (!existing) return undefined
  const existingReal = realpathSync(existing)
  if (!isInsideRoot(rootReal, existingReal)) return undefined
  return existsSync(resolved) ? realpathSync(resolved) : resolved
}

function resolvePluginPath(rootDir: string, value: string | undefined): string | undefined {
  if (!value || !isSafePluginRelativePath(value)) return undefined
  return containedPluginPath(rootDir, value)
}

function resolvePluginPaths(rootDir: string, values: string[] | undefined): string[] {
  return (values ?? [])
    .map((value) => resolvePluginPath(rootDir, value))
    .filter((value): value is string => Boolean(value))
}

function pathContainmentIssue(rootDir: string, value: string | undefined, field: string): BoringPluginPreflightIssue | undefined {
  if (!value || !isSafePluginRelativePath(value)) return undefined
  if (containedPluginPath(rootDir, value)) return undefined
  return {
    pluginDir: rootDir,
    code: "INVALID_PLUGIN_METADATA",
    message: `${field}: resolved path escapes plugin root`,
  }
}

function packagePathContainmentIssues(rootDir: string, pkg: BoringPluginPackageJson): BoringPluginPreflightIssue[] {
  const issues: BoringPluginPreflightIssue[] = []
  const boring = pkg.boring
  const pi = pkg.pi
  const pluginId = safePluginIdFromPackageJson(pkg, rootDir)
  const push = (issue: BoringPluginPreflightIssue | undefined) => {
    if (issue) issues.push({ ...issue, ...(pluginId ? { pluginId } : {}) })
  }
  push(pathContainmentIssue(rootDir, boring?.front, "boring.front"))
  if (boring?.server !== false) {
    if (boring?.server !== undefined) {
      push(pathContainmentIssue(rootDir, boring.server, "boring.server"))
    } else {
      push(pathContainmentIssue(rootDir, "server/index.ts", "boring.server"))
      push(pathContainmentIssue(rootDir, "server/index.js", "boring.server"))
    }
  }
  pi?.extensions?.forEach((value, index) => push(pathContainmentIssue(rootDir, value, `pi.extensions[${index}]`)))
  pi?.skills?.forEach((value, index) => push(pathContainmentIssue(rootDir, value, `pi.skills[${index}]`)))
  return issues
}

function discoverBoringPluginDirs(pluginDirs: string[]): DiscoveredBoringPluginDirs {
  const out = new Set<string>()
  const missingPackageJson: string[] = []
  for (const raw of pluginDirs) {
    const dir = resolve(raw)
    if (!existsSync(dir)) continue
    const info = statSync(dir)
    if (!info.isDirectory()) continue

    const hasPackageJson = existsSync(join(dir, "package.json"))
    const childPackageDirs: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue
      const child = join(dir, entry.name)
      if (existsSync(join(child, "package.json"))) childPackageDirs.push(child)
    }

    if (hasPackageJson) out.add(dir)
    for (const child of childPackageDirs) out.add(child)

    // Parent collection directories such as .pi/extensions are valid even when empty.
    // A non-collection directory with no package.json and no package children is treated
    // as an explicitly supplied plugin dir and reported to the caller.
    if (!hasPackageJson && childPackageDirs.length === 0 && basename(dir) !== "extensions") {
      missingPackageJson.push(dir)
    }
  }
  return { dirs: [...out].sort(), missingPackageJson: [...new Set(missingPackageJson)].sort() }
}

export function expandBoringPluginDirs(pluginDirs: string[]): string[] {
  return discoverBoringPluginDirs(pluginDirs).dirs
}

export function preflightBoringPlugins(pluginDirs: string[]): BoringPluginPreflightResult {
  const errors: BoringPluginPreflightIssue[] = []
  const seenIds = new Map<string, string>()
  const discovered = discoverBoringPluginDirs(pluginDirs)
  for (const pluginDir of discovered.missingPackageJson) {
    errors.push({ pluginDir, code: "MISSING_PACKAGE_JSON", message: "package.json is missing" })
  }
  for (const rootDir of discovered.dirs) {
    let pkg: Record<string, unknown>
    try {
      pkg = parsePackageJson(rootDir)
    } catch (error) {
      errors.push({
        pluginDir: rootDir,
        code: "INVALID_PACKAGE_JSON",
        message: error instanceof Error ? error.message : "invalid package.json",
      })
      continue
    }
    if (!hasPluginMetadata(pkg)) continue
    const result = validateBoringPluginManifest(pkg)
    if (!result.valid) {
      const pluginId = safePluginIdFromPackageJson(pkg, rootDir)
      for (const issue of result.issues) {
        errors.push({
          pluginDir: rootDir,
          ...(pluginId ? { pluginId } : {}),
          code: "INVALID_PLUGIN_METADATA",
          message: `${issue.field}: ${issue.message}`,
        })
      }
      continue
    }
    const id = pluginIdFromPackageJson(result.packageJson, rootDir)
    if (!isValidBoringPluginId(id)) {
      errors.push({
        pluginDir: rootDir,
        code: "INVALID_PLUGIN_METADATA",
        message: `effective plugin id "${id}" must start with a letter or number and use only letters, numbers, dot, underscore, colon, or dash`,
      })
    } else {
      const previous = seenIds.get(id)
      if (previous) {
        errors.push({
          pluginDir: rootDir,
          pluginId: id,
          code: "INVALID_PLUGIN_METADATA",
          message: `duplicate plugin id "${id}" also declared by ${previous}`,
        })
      } else {
        seenIds.set(id, rootDir)
      }
    }
    errors.push(...packagePathContainmentIssues(rootDir, result.packageJson))
  }
  return { ok: errors.length === 0, errors }
}

function resolveConventionalServerPath(rootDir: string): string | undefined {
  for (const candidate of ["server/index.ts", "server/index.js"]) {
    if (!existsSync(resolve(rootDir, candidate))) continue
    return resolvePluginPath(rootDir, candidate)
  }
  return undefined
}

export function readBoringPlugins(pluginDirs: string[]): BoringServerPluginManifest[] {
  if (!preflightBoringPlugins(pluginDirs).ok) return []
  const plugins: BoringServerPluginManifest[] = []
  for (const rootDir of expandBoringPluginDirs(pluginDirs)) {
    const raw = parsePackageJson(rootDir)
    if (!hasPluginMetadata(raw)) continue
    const result = validateBoringPluginManifest(raw)
    if (!result.valid) continue
    if (packagePathContainmentIssues(rootDir, result.packageJson).length > 0) continue
    const pkg = result.packageJson
    const boring = pkg.boring ?? {}
    const pi = pkg.pi as BoringPackagePiField | undefined
    const frontPath = resolvePluginPath(rootDir, boring.front)
    const serverPath = boring.server === false
      ? undefined
      : typeof boring.server === "string"
        ? resolvePluginPath(rootDir, boring.server)
        : resolveConventionalServerPath(rootDir)
    const version = pkg.version ?? "0.0.0"
    const id = pluginIdFromPackageJson({ name: pkg.name }, rootDir)
    if (!isValidBoringPluginId(id)) continue
    const extensionPaths = resolvePluginPaths(rootDir, pi?.extensions)
    const skillPaths = resolvePluginPaths(rootDir, pi?.skills)
    plugins.push({
      id,
      rootDir,
      version,
      boring,
      ...(pi ? { pi } : {}),
      ...(frontPath ? { frontPath, frontUrl: `/@fs/${frontPath}` } : {}),
      ...(serverPath ? { serverPath } : {}),
      ...(extensionPaths.length > 0 ? { extensionPaths } : {}),
      ...(skillPaths.length > 0 ? { skillPaths } : {}),
    })
  }
  return plugins
}

export function pluginRootFromExtensionPath(extensionPath: string): string {
  const resolved = resolve(extensionPath)
  const agentDir = dirname(resolved)
  if (basename(agentDir) !== "agent") {
    throw new Error(`boring plugin extension path must follow <pluginRoot>/agent/<entry>: ${extensionPath}`)
  }
  return dirname(agentDir)
}
