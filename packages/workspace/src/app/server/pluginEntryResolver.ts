/**
 * Directory-source plugin resolution.
 *
 * Resolves `{ dir, options?, hotReload? }` plugin entries into a
 * `WorkspaceServerPlugin` by reading the plugin's `package.json` and
 * importing its server entry:
 *
 *  1. Require an explicit manifest field (`package.json#boring.server`).
 *     Declared-but-missing fails loudly — no silent fallback.
 *  2. `hotReload: true` uses jiti with `moduleCache: false` to re-evaluate
 *     on every call. `hotReload: false` uses regular `import()`.
 */
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { validateServerPlugin, type WorkspaceServerPlugin } from "../../server/plugins/bootstrapServer"
import type { BoringPluginPackageJson } from "../../shared/plugins/manifest"
import { resolveSafePluginEntryPath } from "../../server/agentPlugins/pluginPaths"
import { importServerModule } from "../../server/pluginImports/importServerModule"
import { assertCanonicalPluginId, extractDefinePluginId } from "../../server/agentPlugins/canonicalPluginId"

/**
 * Directory-source entry: `{ dir, options?, hotReload? }`. Resolved via
 * jiti when `hotReload: true`, native `import()` otherwise.
 */
export interface DirPluginEntry {
  dir: string
  options?: unknown
  hotReload?: boolean
  /**
   * Directory-source plugins are untrusted for host bridge handler registration
   * unless the app explicitly marks the entry as internal at boot. This keeps
   * user/workspace plugin packages from self-registering privileged host RPCs.
   */
  trust?: "internal"
}

type MaybePromise<T> = T | Promise<T>
type ServerPluginFactory = (options: unknown, ctx: PluginResolveContext) => MaybePromise<WorkspaceServerPlugin>

function readPluginPackageJson(dir: string): BoringPluginPackageJson | null {
  const pkgPath = resolve(dir, "package.json")
  if (!existsSync(pkgPath)) return null
  try {
    return JSON.parse(readFileSync(pkgPath, "utf8")) as BoringPluginPackageJson
  } catch {
    return null
  }
}

/**
 * Directory-source server entries are manifest-only: missing declarations mean
 * the package is front/Pi-only, while declared-but-missing entries throw loudly.
 */
/**
 * Context the resolver hands to plugin factories. Same shape as the
 * top-level `WorkspaceAgentServerPluginContext` (workspaceRoot + bridge)
 * — keeping a single name here would create a circular type import,
 * but the structural type is identical and callers cast between them.
 */
export interface PluginResolveContext {
  workspaceRoot: string
  bridge: unknown
}

function resolveDirFrontPluginId(dir: string, pkg: BoringPluginPackageJson): string | undefined {
  if (typeof pkg.boring?.front !== "string") return undefined
  const frontPath = resolveSafePluginEntryPath({
    rootDir: dir,
    explicit: pkg.boring.front,
    conventions: [],
    field: "boring.front",
    manifestPath: join(dir, "package.json"),
  })
  if (!frontPath) return undefined
  return extractDefinePluginId(readFileSync(frontPath, "utf8"))
}

function resolveDirServerEntryPath(dir: string): string | null {
  const rootDir = resolve(dir)
  const pkg = readPluginPackageJson(rootDir)
  if (!pkg) throw new Error(`boring plugin: no package.json found in ${rootDir}`)
  return resolveSafePluginEntryPath({
    rootDir,
    explicit: pkg.boring?.server,
    conventions: [],
    field: "boring.server",
    manifestPath: join(rootDir, "package.json"),
  })
}

/**
 * Returns true when a directory-source package has an importable server entry.
 * Missing package.json, unsafe explicit entries, and declared-but-missing
 * entries still throw — only the legitimate "front/Pi-only package" case
 * (no manifest server) returns false.
 */
export function hasDirServerPlugin(entry: DirPluginEntry): boolean {
  const rootDir = resolve(entry.dir)
  const pkg = readPluginPackageJson(rootDir)
  if (!pkg) throw new Error(`boring plugin: no package.json found in ${rootDir}`)
  if (pkg.boring?.server === undefined || pkg.boring.server === false) return false
  return resolveDirServerEntryPath(rootDir) !== null
}

async function resolveDirServerPlugin(
  entry: DirPluginEntry,
  ctx: PluginResolveContext,
): Promise<WorkspaceServerPlugin> {
  const dir = resolve(entry.dir)
  const pkg = readPluginPackageJson(dir) ?? {}
  const frontId = resolveDirFrontPluginId(dir, pkg)
  const serverPath = resolveDirServerEntryPath(dir)
  if (!serverPath) {
    throw new Error(
      `boring plugin: no server entry resolved for ${dir}\n` +
        `  set "boring.server" in package.json to a safe relative server entry`,
    )
  }
  const mod = await importServerModule(serverPath, entry.hotReload === true)
  const value =
    typeof mod === "object" && mod !== null && "default" in mod
      ? (mod as { default?: unknown }).default
      : mod
  if (typeof value === "function") {
    const plugin = await (value as ServerPluginFactory)(entry.options, ctx)
    validateServerPlugin(plugin)
    assertCanonicalPluginId({
      packageJson: pkg,
      frontId,
      serverId: plugin.id,
      source: dir,
    })
    return plugin
  }
  if (value && typeof value === "object") {
    const plugin = value as WorkspaceServerPlugin
    validateServerPlugin(plugin)
    assertCanonicalPluginId({
      packageJson: pkg,
      frontId,
      serverId: plugin.id,
      source: dir,
    })
    return plugin
  }
  throw new Error(`boring plugin: ${serverPath} default export is neither a function nor a plugin object`)
}

export function isDirEntry(entry: unknown): entry is DirPluginEntry {
  return typeof entry === "object" && entry !== null && "dir" in entry
}

export function isTrustedWorkspaceBridgeHandlerEntry(entry: unknown): boolean {
  // Pre-built plugin objects can only be supplied by host/app code, not by a
  // user-authored package manifest, so they are trusted at this boundary.
  if (!isDirEntry(entry)) return true
  return entry.trust === "internal"
}

export function assertWorkspaceBridgeHandlersTrusted(
  plugin: WorkspaceServerPlugin,
  entry: unknown,
): void {
  if ((plugin.workspaceBridgeHandlers?.length ?? 0) === 0) return
  if (isTrustedWorkspaceBridgeHandlerEntry(entry)) return
  const label = isDirEntry(entry) ? resolve(entry.dir) : plugin.id
  throw new Error(
    `server plugin "${plugin.id}" from ${label} declares workspaceBridgeHandlers, ` +
      `but host bridge handlers are only allowed for pre-built host plugins or ` +
      `directory entries marked trust: "internal"`,
  )
}

/**
 * Single dispatch point for any entry shape:
 *   - WorkspaceServerPlugin object → pass through
 *   - DirPluginEntry → jiti/import + factory
 *
 * Used by both initial install (createWorkspaceAgentServer) and rebuild
 * (rebuildServerPlugins) so the dispatch lives in one place.
 */
export async function resolveOnePluginEntry<TPlugin extends WorkspaceServerPlugin>(
  entry: unknown,
  ctx: PluginResolveContext,
): Promise<TPlugin> {
  if (isDirEntry(entry)) return (await resolveDirServerPlugin(entry, ctx)) as TPlugin
  return entry as TPlugin
}
