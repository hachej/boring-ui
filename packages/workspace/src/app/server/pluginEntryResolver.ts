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

export interface DirPluginEntry {
  spec: PluginSpec
  options?: unknown
  hotReload?: boolean
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

export function resolvePluginEntries(dir: string): {
  pkg: PluginPackageJson | null
  serverPath: string | null
  frontPath: string | null
} {
  const pkg = readPluginPackageJson(dir)
  return {
    pkg,
    serverPath: resolvePluginEntryPath(dir, pkg?.boring?.server, SERVER_CONVENTIONS),
    frontPath: resolvePluginEntryPath(dir, pkg?.boring?.front, FRONT_CONVENTIONS),
  }
}

const require = createRequire(import.meta.url)

function jitiImport(serverPath: string): Promise<unknown> | null {
  try {
    const jitiModule = require("jiti") as {
      createJiti?: (url: string, opts?: { moduleCache?: boolean }) => { import: (path: string) => Promise<unknown> }
    }
    const create = jitiModule.createJiti
    if (!create) return null
    return create(import.meta.url, { moduleCache: false }).import(serverPath)
  } catch {
    return null
  }
}

async function importServerModule(serverPath: string, hotReload: boolean): Promise<{ default?: unknown }> {
  if (hotReload) {
    const jiti = jitiImport(serverPath)
    if (jiti) return (await jiti) as { default?: unknown }
    // Fall through to regular import if jiti unavailable in this env.
  }
  const href = pathToFileURL(serverPath).href
  return (await import(/* @vite-ignore */ href)) as { default?: unknown }
}

export interface ResolveDirServerPluginContext {
  workspaceRoot: string
  bridge: unknown
}

/**
 * Resolves a directory-source entry to a `WorkspaceServerPlugin` by:
 *  1. Reading the plugin's package.json.
 *  2. Locating its server entry (manifest first, conventions fallback).
 *  3. Importing it (jiti when `hotReload`, otherwise regular `import()`).
 *  4. Calling its `default` export with `(options, ctx)` if it's a function;
 *     otherwise treating the export as a pre-built plugin object.
 *
 * Throws when the directory has no package.json, no server entry resolves,
 * or the import fails. Failures are the caller's responsibility to convert
 * into diagnostics (Phase 5 will wrap them in the rebuild error path).
 */
export async function resolveDirServerPlugin(
  entry: { spec: DirSpec; options?: unknown; hotReload?: boolean },
  ctx: ResolveDirServerPluginContext,
): Promise<WorkspaceServerPlugin> {
  const dir = resolve(entry.spec.dir)
  const { pkg, serverPath } = resolvePluginEntries(dir)
  if (!pkg) throw new Error(`boring plugin: no package.json found in ${dir}`)
  if (!serverPath) {
    throw new Error(
      `boring plugin: no server entry resolved for ${dir}\n` +
        `  set "boring.server" in package.json or add one of: ${SERVER_CONVENTIONS.join(", ")}`,
    )
  }
  const mod = await importServerModule(serverPath, entry.hotReload === true)
  const exported = mod.default
  if (typeof exported === "function") {
    return (exported as (options: unknown, ctx: ResolveDirServerPluginContext) => WorkspaceServerPlugin)(
      entry.options,
      ctx,
    )
  }
  if (exported && typeof exported === "object") return exported as WorkspaceServerPlugin
  throw new Error(`boring plugin: ${serverPath} default export is neither a function nor a plugin object`)
}

/**
 * Resolves a `{ spec: { module } }` entry. Same factory contract as the
 * directory variant: function exports are called with `(options, ctx)`,
 * object exports are returned as-is.
 */
export async function resolveModuleServerPlugin(
  entry: { spec: ModuleSpec; options?: unknown },
  ctx: ResolveDirServerPluginContext,
): Promise<WorkspaceServerPlugin> {
  const result = await entry.spec.module()
  const exported =
    typeof result === "object" && result !== null && "default" in result
      ? (result as { default?: unknown }).default
      : result
  if (typeof exported === "function") {
    return (exported as (options: unknown, ctx: ResolveDirServerPluginContext) => WorkspaceServerPlugin)(
      entry.options,
      ctx,
    )
  }
  if (exported && typeof exported === "object") return exported as WorkspaceServerPlugin
  throw new Error(`boring plugin: module spec resolved to neither a function nor a plugin object`)
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
