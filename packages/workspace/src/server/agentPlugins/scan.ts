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
  sources: BoringPluginSource[]
  missingPackageJson: string[]
}

interface BoringPluginScanCandidate {
  plugin: BoringServerPluginManifest
  source: BoringPluginSource
}

function normalizeBoringPluginSource(input: BoringPluginSourceInput): BoringPluginSource {
  if (typeof input === "string") return { rootDir: resolve(input), kind: "internal" }
  return {
    rootDir: resolve(input.rootDir),
    kind: input.kind,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
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
  pi?.extensions?.forEach((value, index) => push(pathPreflightIssue(rootDir, value, `pi.extensions[${index}]`)))
  pi?.skills?.forEach((value, index) => push(pathPreflightIssue(rootDir, value, `pi.skills[${index}]`)))
  return issues
}

function externalSourcePriority(source: BoringPluginSource): number | undefined {
  if (source.kind !== "external") return undefined
  return source.workspaceId ? 2 : 1
}

function selectPluginCandidates(candidates: BoringPluginScanCandidate[]): {
  plugins: BoringServerPluginManifest[]
  errors: BoringPluginPreflightIssue[]
} {
  const plugins: BoringServerPluginManifest[] = []
  const errors: BoringPluginPreflightIssue[] = []
  const groups = new Map<string, BoringPluginScanCandidate[]>()
  for (const candidate of candidates) {
    groups.set(candidate.plugin.id, [...(groups.get(candidate.plugin.id) ?? []), candidate])
  }

  for (const group of groups.values()) {
    if (group.length === 1) {
      plugins.push(group[0]!.plugin)
      continue
    }

    const priorities = group.map((candidate) => externalSourcePriority(candidate.source))
    const canUseExternalPriority = priorities.every((priority): priority is number => priority !== undefined)
    if (canUseExternalPriority) {
      const bestPriority = Math.max(...priorities)
      const winners = group.filter((candidate) => externalSourcePriority(candidate.source) === bestPriority)
      if (winners.length === 1) {
        plugins.push(winners[0]!.plugin)
        continue
      }
    }

    const id = group[0]!.plugin.id
    const firstRoot = group[0]!.plugin.rootDir
    for (const duplicate of group.slice(1)) {
      errors.push({
        pluginDir: duplicate.plugin.rootDir,
        pluginId: id,
        code: "INVALID_PLUGIN_METADATA",
        message: `duplicate plugin id "${id}" also declared by ${firstRoot}`,
      })
    }
  }

  return { plugins, errors }
}

function discoverBoringPluginDirs(pluginDirs: BoringPluginSourceInput[]): DiscoveredBoringPluginDirs {
  const out = new Map<string, BoringPluginSource>()
  const missingPackageJson: string[] = []
  for (const raw of pluginDirs) {
    const source = normalizeBoringPluginSource(raw)
    const dir = source.rootDir
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

    if (hasPackageJson && !out.has(dir)) out.set(dir, source)
    for (const child of childPackageDirs) {
      if (!out.has(child)) out.set(child, { ...source, rootDir: child })
    }

    // Parent collection directories such as .pi/extensions/.pi/npm/.pi/git are valid even when empty.
    // A non-collection directory with no package.json and no package children is treated
    // as an explicitly supplied plugin dir and reported to the caller.
    if (!hasPackageJson && childPackageDirs.length === 0 && !["extensions", "npm", "git"].includes(basename(dir))) {
      missingPackageJson.push(dir)
    }
  }
  return {
    sources: [...out.values()].sort((a, b) => a.rootDir.localeCompare(b.rootDir)),
    missingPackageJson: [...new Set(missingPackageJson)].sort(),
  }
}

export function scanBoringPlugins(pluginDirs: BoringPluginSourceInput[]): BoringPluginScanResult {
  const errors: BoringPluginPreflightIssue[] = []
  const candidates: BoringPluginScanCandidate[] = []
  const discovered = discoverBoringPluginDirs(pluginDirs)

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
    candidates.push({
      source,
      plugin: {
        id,
        rootDir,
        version,
        boring,
        ...(pi ? { pi } : {}),
        ...(frontPath ? { frontPath, frontUrl: `/@fs/${frontPath}` } : {}),
        ...(serverPath ? { serverPath } : {}),
        ...(extensionPaths.length > 0 ? { extensionPaths } : {}),
        ...(skillPaths.length > 0 ? { skillPaths } : {}),
        source,
      },
    })
  }

  const selected = selectPluginCandidates(candidates)
  errors.push(...selected.errors)
  const preflight = { ok: errors.length === 0, errors }
  return { preflight, plugins: selected.plugins }
}

export function preflightBoringPlugins(pluginDirs: BoringPluginSourceInput[]): BoringPluginPreflightResult {
  return scanBoringPlugins(pluginDirs).preflight
}

export function readBoringPlugins(pluginDirs: BoringPluginSourceInput[]): BoringServerPluginManifest[] {
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
