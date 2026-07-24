import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import {
  isSafePluginRelativePath,
  isValidBoringPluginId,
  validateBoringPluginManifest,
  type BoringPackagePiField,
  type BoringPluginPackageJson,
} from "../../shared/plugins/manifest"
import type { BoringPluginSource, BoringPluginSourceInput, BoringServerPluginManifest } from "./types"
import { assertCanonicalPluginId, extractDefinePluginId } from "./canonicalPluginId"
import { resolveContainedPluginPath } from "./pluginPaths"

export interface BoringPluginPreflightIssue {
  pluginDir: string
  pluginId?: string
  code: "MISSING_PLUGIN_DIR" | "MISSING_PACKAGE_JSON" | "INVALID_PACKAGE_JSON" | "INVALID_PLUGIN_METADATA"
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
  sources: BoringPluginSource[]
  missingPackageJson: string[]
  /** Registered source dirs that do not exist on disk. */
  missingDirs: string[]
}

function normalizeBoringPluginSource(input: BoringPluginSourceInput): BoringPluginSource {
  if (typeof input === "string") return { rootDir: resolve(input), kind: "internal" }
  return {
    rootDir: resolve(input.rootDir),
    kind: input.kind,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    ...(input.registered ? { registered: true } : {}),
  }
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
  pi?.extensions?.forEach((value, index) => push(pathPreflightIssue(rootDir, value, `pi.extensions[${index}]`, { mustExist: true })))
  pi?.skills?.forEach((value, index) => push(pathPreflightIssue(rootDir, value, `pi.skills[${index}]`, { mustExist: true })))
  return issues
}

function discoverBoringPluginDirs(pluginDirs: BoringPluginSourceInput[]): DiscoveredBoringPluginDirs {
  const out = new Map<string, BoringPluginSource>()
  const missingPackageJson: string[] = []
  const missingDirs: string[] = []
  for (const raw of pluginDirs) {
    const source = normalizeBoringPluginSource(raw)
    const dir = source.rootDir
    if (!existsSync(dir)) {
      if (source.registered) missingDirs.push(dir)
      continue
    }
    const info = statSync(dir)
    if (!info.isDirectory()) continue

    const hasPackageJson = existsSync(join(dir, "package.json"))
    const childPackageDirs: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue
      const child = join(dir, entry.name)
      if (existsSync(join(child, "package.json"))) childPackageDirs.push(child)
    }

    if (hasPackageJson && !out.has(dir)) out.set(dir, source)
    for (const child of childPackageDirs) {
      if (!out.has(child)) out.set(child, { ...source, rootDir: child })
    }

    // Parent collection directories such as .pi/extensions are valid even when empty.
    // A non-collection directory with no package.json and no package children is treated
    // as an explicitly supplied plugin dir and reported to the caller. Registered
    // sources always point at a single plugin root, so a missing package.json is an
    // error there regardless of name or children.
    const collectionDirNames = new Set(["extensions", "npm", "git"])
    if (!hasPackageJson && (source.registered || (childPackageDirs.length === 0 && !collectionDirNames.has(basename(dir))))) {
      missingPackageJson.push(dir)
    }
  }
  return {
    sources: [...out.values()].sort((a, b) => a.rootDir.localeCompare(b.rootDir)),
    missingPackageJson: [...new Set(missingPackageJson)].sort(),
    missingDirs: [...new Set(missingDirs)].sort(),
  }
}

export function scanBoringPlugins(pluginDirs: BoringPluginSourceInput[]): BoringPluginScanResult {
  const errors: BoringPluginPreflightIssue[] = []
  const plugins: BoringServerPluginManifest[] = []
  const seenIds = new Map<string, string>()
  const discovered = discoverBoringPluginDirs(pluginDirs)

  for (const pluginDir of discovered.missingDirs) {
    errors.push({ pluginDir, code: "MISSING_PLUGIN_DIR", message: "registered plugin source directory does not exist" })
  }
  for (const pluginDir of discovered.missingPackageJson) {
    errors.push({ pluginDir, code: "MISSING_PACKAGE_JSON", message: "package.json is missing" })
  }

  for (const source of discovered.sources) {
    const rootDir = source.rootDir
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
    if (!hasPluginMetadata(raw)) {
      if (source.registered) {
        errors.push({
          pluginDir: rootDir,
          code: "INVALID_PLUGIN_METADATA",
          message: 'package.json has no "boring" or "pi" plugin metadata',
        })
      }
      continue
    }

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
        const previousPluginIndex = plugins.findIndex((plugin) => plugin.id === id)
        const previousPlugin = previousPluginIndex >= 0 ? plugins[previousPluginIndex] : undefined
        const currentIsWorkspaceLocal = Boolean(source.workspaceId)
        const previousIsWorkspaceLocal = Boolean(previousPlugin?.source.workspaceId)
        const currentMayShadowPrevious = source.kind === "external"
          && currentIsWorkspaceLocal
          && previousPlugin?.source.kind === "external"
          && !previousIsWorkspaceLocal
        if (currentMayShadowPrevious) {
          if (previousPluginIndex >= 0) plugins.splice(previousPluginIndex, 1)
          seenIds.set(id, rootDir)
        } else if (!currentIsWorkspaceLocal && previousIsWorkspaceLocal) {
          canAddPlugin = false
        } else {
          errors.push({
            pluginDir: rootDir,
            pluginId: id,
            code: "INVALID_PLUGIN_METADATA",
            message: `duplicate plugin id "${id}" also declared by ${previous}`,
          })
          if (previousPluginIndex >= 0) plugins.splice(previousPluginIndex, 1)
          canAddPlugin = false
        }
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
    const hasBoring = pkg.boring !== undefined
    const boring = pkg.boring ?? {}
    const pi = pkg.pi as BoringPackagePiField | undefined
    const frontPath = resolvePluginPath(rootDir, boring.front, { mustExist: true })
    const serverPath = typeof boring.server === "string"
      ? resolvePluginPath(rootDir, boring.server)
      : undefined
    try {
      assertCanonicalPluginId({
        packageJson: pkg,
        ...(frontPath ? { frontId: extractDefinePluginId(readFileSync(frontPath, "utf8")) } : {}),
        source: rootDir,
      })
    } catch (error) {
      errors.push({
        pluginDir: rootDir,
        pluginId: id,
        code: "INVALID_PLUGIN_METADATA",
        message: error instanceof Error ? error.message : "canonical plugin ID mismatch",
      })
      continue
    }
    const version = pkg.version ?? "0.0.0"
    const extensionPaths = resolvePluginPaths(rootDir, pi?.extensions)
    const skillPaths = resolvePluginPaths(rootDir, pi?.skills)
    plugins.push({
      id,
      rootDir,
      version,
      boring,
      hasBoring,
      ...(pi ? { pi } : {}),
      ...(frontPath ? { frontPath, frontUrl: `/@fs/${frontPath}` } : {}),
      ...(serverPath ? { serverPath } : {}),
      ...(extensionPaths.length > 0 ? { extensionPaths } : {}),
      ...(skillPaths.length > 0 ? { skillPaths } : {}),
      source,
    })
  }

  const preflight = { ok: errors.length === 0, errors }
  return { preflight, plugins }
}

export function preflightBoringPlugins(pluginDirs: BoringPluginSourceInput[]): BoringPluginPreflightResult {
  return scanBoringPlugins(pluginDirs).preflight
}

export function readBoringPlugins(pluginDirs: BoringPluginSourceInput[]): BoringServerPluginManifest[] {
  const scan = scanBoringPlugins(pluginDirs)
  return scan.preflight.ok ? scan.plugins.filter((plugin) => plugin.hasBoring) : []
}

export function pluginRootFromExtensionPath(extensionPath: string): string {
  const resolved = resolve(extensionPath)
  const agentDir = dirname(resolved)
  if (basename(agentDir) !== "agent") {
    throw new Error(`boring plugin extension path must follow <pluginRoot>/agent/<entry>: ${extensionPath}`)
  }
  return dirname(agentDir)
}
