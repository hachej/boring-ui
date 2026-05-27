import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import {
  isSafePluginRelativePath,
  isValidBoringPluginId,
  validateBoringPluginManifest,
  type BoringPackagePiField,
  type BoringPluginPackageJson,
} from "../../shared/plugins/manifest"
import type { BoringServerPluginManifest } from "./types"
import { resolveContainedPluginPath } from "./pluginPaths"

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

export interface BoringPluginScanResult {
  preflight: BoringPluginPreflightResult
  plugins: BoringServerPluginManifest[]
}

interface DiscoveredBoringPluginDirs {
  dirs: string[]
  missingPackageJson: string[]
}

function pluginIdFromPackageJson(pkg: { name?: string; boring?: { id?: string } }, rootDir: string): string {
  const explicitId = typeof pkg.boring?.id === "string" && pkg.boring.id.trim() ? pkg.boring.id.trim() : undefined
  if (explicitId) return explicitId
  const name = typeof pkg.name === "string" && pkg.name.trim() ? pkg.name.trim() : undefined
  // Split on / OR \\ so the fallback id works on Windows (basename of
  // C:\path\to\plugin should be "plugin", not the full path).
  return (name ?? rootDir.split(/[\\/]/).at(-1) ?? "plugin").replace(/^@/, "").replaceAll("/", "-")
}

function safePluginIdFromPackageJson(pkg: BoringPluginPackageJson | Record<string, unknown>, rootDir: string): string | undefined {
  const id = pluginIdFromPackageJson(pkg as { name?: string; boring?: { id?: string } }, rootDir)
  return isValidBoringPluginId(id) ? id : undefined
}

function parsePackageJson(rootDir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")) as Record<string, unknown>
}

function hasPluginMetadata(pkg: Record<string, unknown>): boolean {
  return pkg.boring !== undefined || pkg.pi !== undefined
}

function resolvePluginPath(rootDir: string, value: string | undefined, options: { mustExist?: boolean } = {}): string | undefined {
  return resolveContainedPluginPath(rootDir, value, options)
}

function resolvePluginPaths(rootDir: string, values: string[] | undefined): string[] {
  return (values ?? [])
    .map((value) => resolvePluginPath(rootDir, value))
    .filter((value): value is string => Boolean(value))
}

function pathPreflightIssue(
  rootDir: string,
  value: string | undefined,
  field: string,
  options: { mustExist?: boolean } = {},
): BoringPluginPreflightIssue | undefined {
  if (!value || !isSafePluginRelativePath(value)) return undefined
  const containedPath = resolveContainedPluginPath(rootDir, value)
  if (!containedPath) {
    return {
      pluginDir: rootDir,
      code: "INVALID_PLUGIN_METADATA",
      message: `${field}: resolved path escapes plugin root`,
    }
  }
  if (options.mustExist && !existsSync(containedPath)) {
    return {
      pluginDir: rootDir,
      code: "INVALID_PLUGIN_METADATA",
      message: `${field}: declared path does not exist: ${value}`,
    }
  }
  return undefined
}

function packagePathContainmentIssues(rootDir: string, pkg: BoringPluginPackageJson): BoringPluginPreflightIssue[] {
  const issues: BoringPluginPreflightIssue[] = []
  const boring = pkg.boring
  const pi = pkg.pi
  const pluginId = safePluginIdFromPackageJson(pkg, rootDir)
  const push = (issue: BoringPluginPreflightIssue | undefined) => {
    if (issue) issues.push({ ...issue, ...(pluginId ? { pluginId } : {}) })
  }
  push(pathPreflightIssue(rootDir, boring?.front, "boring.front", { mustExist: true }))
  if (boring?.server !== false && boring?.server !== undefined) {
    push(pathPreflightIssue(rootDir, boring.server, "boring.server"))
  }
  pi?.extensions?.forEach((value, index) => push(pathPreflightIssue(rootDir, value, `pi.extensions[${index}]`)))
  pi?.skills?.forEach((value, index) => push(pathPreflightIssue(rootDir, value, `pi.skills[${index}]`)))
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

export function scanBoringPlugins(pluginDirs: string[]): BoringPluginScanResult {
  const errors: BoringPluginPreflightIssue[] = []
  const plugins: BoringServerPluginManifest[] = []
  const seenIds = new Map<string, string>()
  const discovered = discoverBoringPluginDirs(pluginDirs)

  for (const pluginDir of discovered.missingPackageJson) {
    errors.push({ pluginDir, code: "MISSING_PACKAGE_JSON", message: "package.json is missing" })
  }

  for (const rootDir of discovered.dirs) {
    let raw: Record<string, unknown>
    try {
      raw = parsePackageJson(rootDir)
    } catch (error) {
      errors.push({
        pluginDir: rootDir,
        code: "INVALID_PACKAGE_JSON",
        message: error instanceof Error ? error.message : "invalid package.json",
      })
      continue
    }
    if (!hasPluginMetadata(raw)) continue

    const result = validateBoringPluginManifest(raw)
    if (!result.valid) {
      const pluginId = safePluginIdFromPackageJson(raw, rootDir)
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
    let canAddPlugin = true
    if (!isValidBoringPluginId(id)) {
      errors.push({
        pluginDir: rootDir,
        code: "INVALID_PLUGIN_METADATA",
        message: `effective plugin id "${id}" must start with a letter or number and use only letters, numbers, dot, underscore, colon, or dash`,
      })
      canAddPlugin = false
    } else {
      const previous = seenIds.get(id)
      if (previous) {
        errors.push({
          pluginDir: rootDir,
          pluginId: id,
          code: "INVALID_PLUGIN_METADATA",
          message: `duplicate plugin id "${id}" also declared by ${previous}`,
        })
        const previousPluginIndex = plugins.findIndex((plugin) => plugin.id === id)
        if (previousPluginIndex >= 0) plugins.splice(previousPluginIndex, 1)
        canAddPlugin = false
      } else {
        seenIds.set(id, rootDir)
      }
    }

    const containmentIssues = packagePathContainmentIssues(rootDir, result.packageJson)
    if (containmentIssues.length > 0) {
      errors.push(...containmentIssues)
      canAddPlugin = false
    }
    if (!canAddPlugin) continue

    const pkg = result.packageJson
    const boring = pkg.boring ?? {}
    const pi = pkg.pi as BoringPackagePiField | undefined
    const frontPath = resolvePluginPath(rootDir, boring.front, { mustExist: true })
    const serverPath = typeof boring.server === "string"
      ? resolvePluginPath(rootDir, boring.server)
      : undefined
    const version = pkg.version ?? "0.0.0"
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

  const preflight = { ok: errors.length === 0, errors }
  return { preflight, plugins }
}

export function preflightBoringPlugins(pluginDirs: string[]): BoringPluginPreflightResult {
  return scanBoringPlugins(pluginDirs).preflight
}

export function readBoringPlugins(pluginDirs: string[]): BoringServerPluginManifest[] {
  const scan = scanBoringPlugins(pluginDirs)
  return scan.preflight.ok ? scan.plugins : []
}

export function pluginRootFromExtensionPath(extensionPath: string): string {
  const resolved = resolve(extensionPath)
  const agentDir = dirname(resolved)
  if (basename(agentDir) !== "agent") {
    throw new Error(`boring plugin extension path must follow <pluginRoot>/agent/<entry>: ${extensionPath}`)
  }
  return dirname(agentDir)
}
