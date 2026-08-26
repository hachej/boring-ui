import { existsSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, resolve as resolvePath } from "node:path"
import { ErrorCode } from "@hachej/boring-agent/shared"
import { PluginFrontRuntimeError } from "./diagnostics.js"
import { packageNameFromBareSpecifier } from "./hostModules.js"
import { importResolutionCandidates } from "./importCandidates.js"
import { isWithin, resolveRealLike } from "./runtimePaths.js"
import type { TrackedPluginRecord } from "./trackedPlugins.js"

/**
 * Imports of a plugin's own node_modules. They are served as virtual modules
 * (rather than runtime URLs) because they live outside the plugin's snapshot
 * subtree, and every resolution is proved to land inside the plugin-local
 * node_modules before it is served.
 */

const PLUGIN_DEPENDENCY_ID_PREFIX = "\0boring-plugin-dependency:"

export interface PluginDependencyContext {
  workspaceId: string
  pluginId: string
  revision: number
  resolvedPath: string
}

function pluginDependencyVirtualId(record: TrackedPluginRecord, resolvedPath: string): string {
  return `${PLUGIN_DEPENDENCY_ID_PREFIX}${encodeURIComponent(record.workspaceId)}:${encodeURIComponent(record.pluginId)}:${record.revision}:${encodeURIComponent(resolvedPath)}`
}

export function parsePluginDependencyVirtualId(id: string): PluginDependencyContext | null {
  if (!id.startsWith(PLUGIN_DEPENDENCY_ID_PREFIX)) return null
  const raw = id.slice(PLUGIN_DEPENDENCY_ID_PREFIX.length)
  if (!raw) return null
  const parts = raw.split(":")
  if (parts.length < 4) return null
  const [workspaceIdRaw, pluginIdRaw, revisionRaw, ...pathParts] = parts
  const revision = Number(revisionRaw)
  if (!Number.isInteger(revision) || revision < 1) return null
  return {
    workspaceId: decodeURIComponent(workspaceIdRaw),
    pluginId: decodeURIComponent(pluginIdRaw),
    revision,
    resolvedPath: decodeURIComponent(pathParts.join(":")),
  }
}

// Cache of nodeModulesDir → real paths of all top-level package entries.
// Built once per plugin instance; pnpm symlinks make the real path of each dep
// land in the global content-addressable store (outside node_modules), so we
// resolve every entry up-front and check containment against those real roots.
//
// This cache is intentionally unbounded and never invalidated. If a user runs
// `npm install` inside a plugin dir mid-session, they must restart the CLI for
// the new dep to be importable — the server's module graph has the same
// constraint — so a stale cache cannot be reached in normal use.
const pluginPackageRootsCache = new Map<string, Promise<ReadonlySet<string>>>()

async function buildPluginPackageRoots(nodeModulesDir: string): Promise<ReadonlySet<string>> {
  const roots = new Set<string>()
  let entries: string[]
  try {
    entries = readdirSync(nodeModulesDir)
  } catch {
    return roots
  }
  for (const entry of entries) {
    if (entry.startsWith(".")) continue // skip .pnpm, .modules.yaml, etc.
    const entryPath = resolvePath(nodeModulesDir, entry)
    if (entry.startsWith("@")) {
      // Scoped namespace directory — resolve each package inside it
      let scopedEntries: string[]
      try {
        scopedEntries = readdirSync(entryPath)
      } catch {
        continue
      }
      for (const scopedEntry of scopedEntries) {
        roots.add(await resolveRealLike(resolvePath(entryPath, scopedEntry)))
      }
    } else {
      roots.add(await resolveRealLike(entryPath))
    }
  }
  return roots
}

function getPluginPackageRoots(nodeModulesDir: string): Promise<ReadonlySet<string>> {
  let cached = pluginPackageRootsCache.get(nodeModulesDir)
  if (!cached) {
    cached = buildPluginPackageRoots(nodeModulesDir)
    pluginPackageRootsCache.set(nodeModulesDir, cached)
  }
  return cached
}

/** Proves `resolvedPath` is a file the plugin actually installed, and returns its real path. */
export async function ensurePluginDependencyPath(record: TrackedPluginRecord, source: string, importer: string | undefined, resolvedPath: string): Promise<string> {
  const nodeModulesDir = resolvePath(record.rootDir, "node_modules")
  if (!existsSync(nodeModulesDir)) {
    throw new PluginFrontRuntimeError(
      ErrorCode.enum.PATH_NOT_FOUND,
      404,
      "resolve",
      "runtime plugin dependency is not installed; run npm install in the plugin directory",
      { source, importer, pluginRoot: record.rootDir },
    )
  }

  const nodeModulesReal = await resolveRealLike(nodeModulesDir)
  const resolvedReal = await resolveRealLike(resolvedPath)
  if (!isWithin(nodeModulesReal, resolvedReal)) {
    // pnpm stores packages in a global content-addressable store and symlinks
    // them from node_modules. The real path of any pnpm-managed dep (including
    // files reachable via relative imports within that dep) lives outside
    // node_modules, so isWithin() always fails. Fall back to a cached set of
    // real package roots derived from the node_modules symlink targets: if
    // resolvedReal is inside any of those roots, it's legitimately installed.
    const packageRoots = await getPluginPackageRoots(nodeModulesDir)
    const isInstalledPackage = Array.from(packageRoots).some(
      (root) => root === resolvedReal || isWithin(root, resolvedReal),
    )
    if (!isInstalledPackage) {
      throw new PluginFrontRuntimeError(
        ErrorCode.enum.PLUGIN_RUNTIME_UNSAFE_IMPORT,
        400,
        "resolve",
        "runtime plugin dependency resolved outside the plugin-local node_modules directory",
        { source, importer, resolvedPath, pluginNodeModules: nodeModulesDir },
      )
    }
  }
  return resolvedReal
}

/** Resolves a bare specifier (`lodash`, `es-toolkit/compat`) against the plugin's node_modules. */
export async function resolvePluginLocalBareImport(record: TrackedPluginRecord, source: string, importer: string | undefined, importerFile = resolvePath(record.rootDir, "package.json")): Promise<string> {
  let resolvedPath: string
  try {
    resolvedPath = createRequire(importerFile).resolve(source)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new PluginFrontRuntimeError(
      ErrorCode.enum.PATH_NOT_FOUND,
      404,
      "resolve",
      "runtime plugin dependency could not be resolved from the plugin directory",
      { source, importer, pluginRoot: record.rootDir, message, installHint: `cd ${record.rootDir} && npm install ${packageNameFromBareSpecifier(source)}` },
    )
  }

  return pluginDependencyVirtualId(record, await ensurePluginDependencyPath(record, source, importer, resolvedPath))
}

/** Resolves a relative import made from inside an already-resolved dependency module. */
export async function resolvePluginLocalRelativeDependencyImport(record: TrackedPluginRecord, source: string, context: PluginDependencyContext): Promise<string> {
  const rawTarget = resolvePath(dirname(context.resolvedPath), source)

  for (const candidate of importResolutionCandidates(rawTarget, resolvePath)) {
    if (!existsSync(candidate)) continue
    return pluginDependencyVirtualId(record, await ensurePluginDependencyPath(record, source, context.resolvedPath, candidate))
  }

  throw new PluginFrontRuntimeError(ErrorCode.enum.PATH_NOT_FOUND, 404, "resolve", "plugin dependency import not found in plugin-local node_modules", {
    importer: context.resolvedPath,
    source,
  })
}
