/**
 * Phase 1 of the unified plugin plan: directory-source resolution.
 *
 * Resolves `{ spec: { dir }, options?, hotReload? }` plugin entries into a
 * `WorkspaceServerPlugin` by reading the plugin's `package.json` and
 * importing its server entry. Mirrors Pi's resolution shape from
 * `@mariozechner/pi-coding-agent` core/package-manager.js:resolveExtensionEntries:
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

export interface DirSpec {
  dir: string
}

export interface ModuleSpec {
  module: () => unknown | Promise<unknown>
}

export type PluginSpec = DirSpec | ModuleSpec

// (Phase 1 review — Gemini 3.1: the `DirPluginEntry` interface was exported
// but never used; the canonical shape lives inline on `WorkspacePluginEntry`
// in createWorkspaceAgentServer.ts. Removed to prevent drift.)

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
const FRONT_CONVENTIONS = ["dist/front/index.js", "src/front/index.tsx", "src/front/index.ts"] as const

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

/**
 * Returns the resolved file paths for a directory-source plugin's server
 * and front entries. Pi parity (`core/package-manager.js`).
 *
 * (Renamed from `resolvePluginEntries` per Phase 1 review feedback —
 * disambiguates from the entry-resolution dispatcher in
 * `createWorkspaceAgentServer.ts`.)
 */
export function resolvePluginEntryPaths(dir: string): {
  pkg: PluginPackageJson | null
  serverPath: string | null
  frontPath: string | null
} {
  const pkg = readPluginPackageJson(dir)
  // Gemini 3.1 Phase 1 review: no package.json → no chance of resolving any
  // entry. Short-circuit to avoid wasted existsSync calls on conventions
  // for a dir that's not a plugin anyway. The caller (resolveDirServerPlugin)
  // already throws on missing pkg.
  if (!pkg) return { pkg: null, serverPath: null, frontPath: null }
  return {
    pkg,
    serverPath: resolvePluginEntryPath(dir, pkg.boring?.server, SERVER_CONVENTIONS),
    frontPath: resolvePluginEntryPath(dir, pkg.boring?.front, FRONT_CONVENTIONS),
  }
}

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

export interface ResolveDirServerPluginContext {
  workspaceRoot: string
  bridge: unknown
}

/**
 * Unwraps the `default` export from an imported module. Handles the
 * common namespace shape `{ default: X }` and the bare-value shape `X`.
 * Then applies the factory contract: function → call with `(options, ctx)`;
 * object → use as a pre-built plugin.
 */
function instantiatePluginExport(
  exported: unknown,
  options: unknown,
  ctx: ResolveDirServerPluginContext,
  source: string,
): WorkspaceServerPlugin {
  const value =
    typeof exported === "object" && exported !== null && "default" in exported
      ? (exported as { default?: unknown }).default
      : exported
  if (typeof value === "function") {
    return (value as (options: unknown, ctx: ResolveDirServerPluginContext) => WorkspaceServerPlugin)(options, ctx)
  }
  if (value && typeof value === "object") return value as WorkspaceServerPlugin
  throw new Error(`boring plugin: ${source} default export is neither a function nor a plugin object`)
}

/**
 * Resolves a directory-source entry to a `WorkspaceServerPlugin` by reading
 * the plugin's package.json, locating its server entry (manifest first,
 * convention fallback, declared-but-missing throws), importing it (jiti
 * when `hotReload`, otherwise regular `import()`), and applying the factory
 * contract. Throws when no package.json or server entry is resolved.
 */
export async function resolveDirServerPlugin(
  entry: { spec: DirSpec; options?: unknown; hotReload?: boolean },
  ctx: ResolveDirServerPluginContext,
): Promise<WorkspaceServerPlugin> {
  const dir = resolve(entry.spec.dir)
  const { pkg, serverPath } = resolvePluginEntryPaths(dir)
  if (!pkg) throw new Error(`boring plugin: no package.json found in ${dir}`)
  if (!serverPath) {
    throw new Error(
      `boring plugin: no server entry resolved for ${dir}\n` +
        `  set "boring.server" in package.json or add one of: ${SERVER_CONVENTIONS.join(", ")}`,
    )
  }
  const mod = await importServerModule(serverPath, entry.hotReload === true)
  return instantiatePluginExport(mod, entry.options, ctx, serverPath)
}

/**
 * Resolves a `{ spec: { module } }` entry. The `module` thunk returns
 * either an imported module (`{ default: X }`) or a bare value `X`.
 * Either shape resolves through `instantiatePluginExport`.
 */
export async function resolveModuleServerPlugin(
  entry: { spec: ModuleSpec; options?: unknown },
  ctx: ResolveDirServerPluginContext,
): Promise<WorkspaceServerPlugin> {
  const result = await entry.spec.module()
  return instantiatePluginExport(result, entry.options, ctx, "module-spec")
}

export function isDirEntry(entry: unknown): entry is { spec: DirSpec; options?: unknown; hotReload?: boolean } {
  if (typeof entry !== "object" || entry === null) return false
  const candidate = entry as { spec?: unknown }
  return typeof candidate.spec === "object" && candidate.spec !== null && "dir" in candidate.spec
}

export function isModuleEntry(entry: unknown): entry is { spec: ModuleSpec; options?: unknown } {
  if (typeof entry !== "object" || entry === null) return false
  const candidate = entry as { spec?: unknown }
  return typeof candidate.spec === "object" && candidate.spec !== null && "module" in candidate.spec
}
