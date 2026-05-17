/**
 * Directory-source plugin resolution.
 *
 * Resolves `{ dir, options?, hotReload? }` plugin entries into a
 * `WorkspaceServerPlugin` by reading the plugin's `package.json` and
 * importing its server entry:
 *
 *  1. Manifest field wins (`package.json#boring.server`). Declared-but-missing
 *     fails loudly — no silent fallback.
 *  2. Convention fallback (`dist/server/index.js`, `src/server/index.ts`)
 *     only kicks in when no manifest field is set.
 *  3. `hotReload: true` uses jiti with `moduleCache: false` to re-evaluate
 *     on every call. `hotReload: false` uses regular `import()`.
 */
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import type { WorkspaceServerPlugin } from "../../server/plugins/bootstrapServer"

/**
 * Directory-source entry: `{ dir, options?, hotReload? }`. Resolved via
 * jiti when `hotReload: true`, native `import()` otherwise.
 */
export interface DirPluginEntry {
  dir: string
  options?: unknown
  hotReload?: boolean
}

/**
 * Module-source entry: `{ module, options? }`. The `module` thunk returns
 * a module namespace (`{ default: X }`) or a bare value; both forms are
 * unwrapped by `instantiatePluginExport`.
 */
export interface ModulePluginEntry {
  module: () => unknown | Promise<unknown>
  options?: unknown
}

export interface BoringPackageJsonField {
  front?: string
  server?: string
  label?: string
  derivesFrom?: string
}

export interface PluginPackageJson {
  name?: string
  boring?: BoringPackageJsonField
  pi?: Record<string, unknown>
}

const SERVER_CONVENTIONS = ["dist/server/index.js", "src/server/index.ts"] as const

export function readPluginPackageJson(dir: string): PluginPackageJson | null {
  const pkgPath = resolve(dir, "package.json")
  if (!existsSync(pkgPath)) return null
  try {
    return JSON.parse(readFileSync(pkgPath, "utf8")) as PluginPackageJson
  } catch {
    return null
  }
}

/**
 * Pi parity (`core/package-manager.js:resolveExtensionEntries`):
 * - explicit manifest field FIRST; missing-but-declared throws loudly.
 * - conventions fallback only when no explicit field.
 * - returns `null` if neither is present.
 */
export function resolvePluginEntryPath(
  dir: string,
  explicit: string | undefined,
  conventions: readonly string[],
): string | null {
  if (explicit) {
    const path = resolve(dir, explicit)
    if (!existsSync(path)) {
      throw new Error(
        `boring plugin entry declared but not found: ${path}\n` +
          `  declared in: ${resolve(dir, "package.json")}#boring`,
      )
    }
    return path
  }
  for (const candidate of conventions) {
    const path = resolve(dir, candidate)
    if (existsSync(path)) return path
  }
  return null
}

// Manifest-first + convention-fallback (Pi parity:
// `core/package-manager.js`) is implemented inline in
// `resolveDirServerPlugin` below — single caller, no wrapper.

const require = createRequire(import.meta.url)

let warnedJitiMissing = false
function warnJitiUnavailable(serverPath: string, reason: string): void {
  if (warnedJitiMissing) return
  warnedJitiMissing = true
  // eslint-disable-next-line no-console
  console.warn(
    `[boring-workspace] hotReload requested but jiti is unavailable (${reason}). ` +
      `Falling back to native import() for ${serverPath}; subsequent reloads will NOT pick up source changes ` +
      `because Node's module cache will return the same module. Install jiti or set hotReload: false.`,
  )
}

function jitiImport(serverPath: string): Promise<unknown> | null {
  try {
    const jitiModule = require("jiti") as {
      createJiti?: (url: string, opts?: { moduleCache?: boolean }) => { import: (path: string) => Promise<unknown> }
    }
    const create = jitiModule.createJiti
    if (!create) {
      warnJitiUnavailable(serverPath, "createJiti not exported")
      return null
    }
    return create(import.meta.url, { moduleCache: false }).import(serverPath)
  } catch (err) {
    warnJitiUnavailable(serverPath, err instanceof Error ? err.message : String(err))
    return null
  }
}

async function importServerModule(serverPath: string, hotReload: boolean): Promise<{ default?: unknown }> {
  if (hotReload) {
    const jiti = jitiImport(serverPath)
    if (jiti) return (await jiti) as { default?: unknown }
  }
  const href = pathToFileURL(serverPath).href
  return (await import(/* @vite-ignore */ href)) as { default?: unknown }
}

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

/**
 * Unwraps `{ default: X }` namespace or bare value, then applies the
 * factory contract: function → call with `(options, ctx)`; object → use
 * as a pre-built plugin.
 */
function instantiatePluginExport(
  exported: unknown,
  options: unknown,
  ctx: PluginResolveContext,
  source: string,
): WorkspaceServerPlugin {
  const value =
    typeof exported === "object" && exported !== null && "default" in exported
      ? (exported as { default?: unknown }).default
      : exported
  if (typeof value === "function") {
    return (value as (options: unknown, ctx: PluginResolveContext) => WorkspaceServerPlugin)(options, ctx)
  }
  if (value && typeof value === "object") return value as WorkspaceServerPlugin
  throw new Error(`boring plugin: ${source} default export is neither a function nor a plugin object`)
}

export async function resolveDirServerPlugin(
  entry: DirPluginEntry,
  ctx: PluginResolveContext,
): Promise<WorkspaceServerPlugin> {
  const dir = resolve(entry.dir)
  const pkg = readPluginPackageJson(dir)
  if (!pkg) throw new Error(`boring plugin: no package.json found in ${dir}`)
  const serverPath = resolvePluginEntryPath(dir, pkg.boring?.server, SERVER_CONVENTIONS)
  if (!serverPath) {
    throw new Error(
      `boring plugin: no server entry resolved for ${dir}\n` +
        `  set "boring.server" in package.json or add one of: ${SERVER_CONVENTIONS.join(", ")}`,
    )
  }
  const mod = await importServerModule(serverPath, entry.hotReload === true)
  return instantiatePluginExport(mod, entry.options, ctx, serverPath)
}

export async function resolveModuleServerPlugin(
  entry: ModulePluginEntry,
  ctx: PluginResolveContext,
): Promise<WorkspaceServerPlugin> {
  const result = await entry.module()
  return instantiatePluginExport(result, entry.options, ctx, "module-spec")
}

export function isDirEntry(entry: unknown): entry is DirPluginEntry {
  return typeof entry === "object" && entry !== null && "dir" in entry
}

export function isModuleEntry(entry: unknown): entry is ModulePluginEntry {
  return typeof entry === "object" && entry !== null && "module" in entry && typeof (entry as ModulePluginEntry).module === "function"
}

/**
 * Single dispatch point for any entry shape:
 *   - WorkspaceServerPlugin object → pass through
 *   - factory function → call with ctx
 *   - DirPluginEntry → jiti/import + factory
 *   - ModulePluginEntry → thunk + factory
 *
 * Used by both initial install (createWorkspaceAgentServer) and rebuild
 * (rebuildServerPlugins) so the dispatch lives in one place.
 */
export async function resolveOnePluginEntry<TPlugin extends WorkspaceServerPlugin>(
  entry: unknown,
  ctx: PluginResolveContext,
): Promise<TPlugin> {
  if (typeof entry === "function") return (entry as (ctx: PluginResolveContext) => TPlugin)(ctx)
  if (isDirEntry(entry)) return (await resolveDirServerPlugin(entry, ctx)) as TPlugin
  if (isModuleEntry(entry)) return (await resolveModuleServerPlugin(entry, ctx)) as TPlugin
  return entry as TPlugin
}
