import { createHash } from "node:crypto"
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { isValidBoringPluginId } from "../../shared/plugins/manifest"
import { createCapturingBoringServerAPI } from "./serverApi"
import { preflightBoringPlugins, readBoringPlugins, type BoringPluginPreflightResult } from "./scan"
import type {
  BoringPluginEvent,
  BoringPluginListEntry,
  BoringServerPluginManifest,
  BoringServerFactory,
  BoringServerRouteHandler,
} from "./types"

interface LoadedPluginRecord extends BoringServerPluginManifest {
  revision: number
  signature: string
}

export interface BoringPluginAssetManagerOptions {
  pluginDirs: string[]
  errorRoot?: string
}

export interface LoadBoringAssetsError {
  id: string
  revision: number
  message: string
}

export interface LoadBoringAssetsResult {
  loaded: BoringPluginListEntry[]
  events: BoringPluginEvent[]
  errors: LoadBoringAssetsError[]
}

type Listener = (event: BoringPluginEvent) => void

function routeKey(method: string, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`
  return `${method.toUpperCase()} ${normalizedPath}`
}

function preflightErrorId(pluginDir: string): string {
  return `preflight-${createHash("sha256").update(pluginDir).digest("hex").slice(0, 12)}`
}

const require = createRequire(import.meta.url)

function optionalJitiImport(serverPath: string): Promise<{ default?: BoringServerFactory }> | null {
  try {
    const jitiModule = require("jiti") as { createJiti?: (url: string, opts?: { moduleCache?: boolean }) => { import: (path: string) => Promise<unknown> } }
    const createJiti = jitiModule.createJiti
    if (!createJiti) return null
    return createJiti(import.meta.url, { moduleCache: false }).import(serverPath) as Promise<{ default?: BoringServerFactory }>
  } catch {
    return null
  }
}

function fileSignature(path: string | undefined): string {
  if (!path || !existsSync(path)) return "missing"
  const stat = statSync(path)
  const hash = createHash("sha256")
  hash.update(String(stat.mtimeMs))
  hash.update(String(stat.size))
  hash.update(readFileSync(path))
  return hash.digest("hex")
}

function directorySignature(root: string | undefined): string {
  if (!root || !existsSync(root)) return "missing"
  const hash = createHash("sha256")
  // Symlinks: follow ONCE via realpath, dedupe via a visited Set.
  // Without this, pnpm `link:` workflows (where plugin sources live
  // behind a symlinked package root) silently never trigger reload.
  // Caps prevent runaway walks if a symlink chain re-enters itself.
  const visited = new Set<string>()
  const rootReal = realpathSync(root)
  visited.add(rootReal)
  let count = 0
  const visit = (dir: string, depth: number) => {
    if (depth > 8 || count > 50_000) return
    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith(".") && entry.name !== "node_modules")
      .sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      count++
      const path = join(dir, entry.name)
      const rel = relative(root, path)
      const stat = lstatSync(path)
      if (stat.isSymbolicLink()) {
        let target: string
        try { target = realpathSync(path) } catch { continue }
        if (visited.has(target)) {
          hash.update(rel); hash.update("symlink-cycle")
          continue
        }
        visited.add(target)
        const targetStat = statSync(target)
        hash.update(rel); hash.update("symlink:"); hash.update(target)
        if (targetStat.isDirectory()) visit(target, depth + 1)
        else if (targetStat.isFile()) hash.update(readFileSync(target))
        continue
      }
      hash.update(rel)
      hash.update(String(stat.mtimeMs))
      hash.update(String(stat.size))
      if (stat.isDirectory()) {
        visit(path, depth + 1)
      } else if (stat.isFile()) {
        hash.update(readFileSync(path))
      }
    }
  }
  visit(root, 0)
  return hash.digest("hex")
}

function pluginSignature(plugin: BoringServerPluginManifest): string {
  return createHash("sha256")
    .update(JSON.stringify(plugin.boring))
    .update(JSON.stringify(plugin.pi ?? {}))
    .update(plugin.version)
    .update(plugin.frontPath ?? "")
    .update(fileSignature(plugin.frontPath))
    .update(directorySignature(plugin.frontPath ? dirname(plugin.frontPath) : undefined))
    .update(directorySignature(join(plugin.rootDir, "shared")))
    .update(plugin.serverPath ?? "")
    .update(fileSignature(plugin.serverPath))
    .update(directorySignature(plugin.serverPath ? dirname(plugin.serverPath) : undefined))
    .update((plugin.extensionPaths ?? []).join("\0"))
    .update((plugin.skillPaths ?? []).join("\0"))
    .digest("hex")
}

async function importServerModule(serverPath: string, href: string): Promise<{ default?: BoringServerFactory }> {
  // jiti handles both fresh re-imports (moduleCache:false) and npm bare-
  // specifier resolution (essential for plugins that import from
  // @hachej/boring-workspace/server etc.). Same path is used inside
  // VITEST — the data:URL shortcut we previously had there couldn't
  // resolve npm specifiers and silently lost packages with deps.
  const jitiImport = optionalJitiImport(serverPath)
  if (jitiImport) return await jitiImport
  return await import(/* @vite-ignore */ href) as { default?: BoringServerFactory }
}

export class BoringPluginAssetManager {
  private readonly pluginDirs: string[]
  private readonly errorRoot: string
  private readonly loaded = new Map<string, LoadedPluginRecord>()
  private readonly revisions = new Map<string, number>()
  private readonly serverHandlers = new Map<string, Map<string, BoringServerRouteHandler>>()
  private readonly listeners = new Set<Listener>()
  private loading: Promise<LoadBoringAssetsResult> | null = null
  private reloadQueued = false

  constructor(options: BoringPluginAssetManagerOptions) {
    this.pluginDirs = options.pluginDirs
    this.errorRoot = options.errorRoot ?? join(process.cwd(), ".pi", "extensions")
  }

  preflight(): BoringPluginPreflightResult {
    return preflightBoringPlugins(this.pluginDirs)
  }

  list(): BoringPluginListEntry[] {
    return [...this.loaded.values()].map((plugin) => ({
      id: plugin.id,
      boring: plugin.boring,
      ...(plugin.pi ? { pi: plugin.pi } : {}),
      version: plugin.version,
      revision: plugin.revision,
      ...(plugin.frontUrl ? { frontUrl: plugin.frontUrl } : {}),
    }))
  }

  getError(pluginId: string): string | null {
    const path = this.errorPath(pluginId)
    if (!path || !existsSync(path)) return null
    return readFileSync(path, "utf8")
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async load(): Promise<LoadBoringAssetsResult> {
    if (this.loading) {
      this.reloadQueued = true
      return this.loading
    }
    this.loading = this.drainLoads().finally(() => {
      this.loading = null
    })
    return this.loading
  }

  private async drainLoads(): Promise<LoadBoringAssetsResult> {
    let result: LoadBoringAssetsResult
    do {
      this.reloadQueued = false
      result = await this.doLoadOnce()
    } while (this.reloadQueued)
    return result!
  }

  private async doLoadOnce(): Promise<LoadBoringAssetsResult> {
    const preflight = this.preflight()
    if (!preflight.ok) return this.reportPreflightErrors(preflight)
    const nextPlugins = readBoringPlugins(this.pluginDirs)
    const nextIds = new Set(nextPlugins.map((plugin) => plugin.id))
    const events: BoringPluginEvent[] = []
    const errors: LoadBoringAssetsError[] = []

    for (const id of [...this.loaded.keys()]) {
      if (nextIds.has(id)) continue
      const revision = this.bumpRevision(id)
      this.loaded.delete(id)
      this.serverHandlers.delete(id)
      const event: BoringPluginEvent = { type: "boring.plugin.unload", id, revision }
      events.push(event)
      this.emit(event)
    }

    for (const plugin of nextPlugins) {
      try {
        const signature = pluginSignature(plugin)
        const previous = this.loaded.get(plugin.id)
        if (previous?.signature === signature) continue
        if (plugin.serverPath) {
          this.serverHandlers.set(plugin.id, await this.loadServerHandlers(plugin.serverPath))
        } else {
          this.serverHandlers.delete(plugin.id)
        }
        const revision = this.bumpRevision(plugin.id)
        const record: LoadedPluginRecord = { ...plugin, revision, signature }
        this.loaded.set(plugin.id, record)
        this.clearError(plugin.id)
        const event: BoringPluginEvent = {
          type: "boring.plugin.load",
          id: plugin.id,
          boring: plugin.boring,
          version: plugin.version,
          revision,
          ...(plugin.frontUrl ? { frontUrl: plugin.frontUrl } : {}),
        }
        events.push(event)
        this.emit(event)
      } catch (error) {
        const revision = this.bumpRevision(plugin.id)
        const message = error instanceof Error ? error.stack ?? error.message : String(error)
        this.writeError(plugin.id, message)
        const event: BoringPluginEvent = { type: "boring.plugin.error", id: plugin.id, revision, message }
        errors.push({ id: plugin.id, revision, message })
        events.push(event)
        this.emit(event)
      }
    }

    return { loaded: this.list(), events, errors }
  }

  private reportPreflightErrors(preflight: BoringPluginPreflightResult): LoadBoringAssetsResult {
    const errors: LoadBoringAssetsError[] = []
    const events: BoringPluginEvent[] = []
    for (const error of preflight.errors) {
      const id = error.pluginId ?? preflightErrorId(error.pluginDir)
      const revision = this.bumpRevision(id)
      const message = `${error.code}: ${error.message}\n\nPlugin dir: ${error.pluginDir}`
      const loadError = { id, revision, message }
      errors.push(loadError)
      this.writeError(id, message)
      const event: BoringPluginEvent = { type: "boring.plugin.error", id, revision, message }
      events.push(event)
      this.emit(event)
    }
    return { loaded: this.list(), events, errors }
  }

  async dispatch(pluginId: string, method: string, path: string, request: Parameters<BoringServerRouteHandler>[0], reply: Parameters<BoringServerRouteHandler>[1]): Promise<unknown> {
    const handlers = this.serverHandlers.get(pluginId)
    const handler = handlers?.get(routeKey(method, path))
    if (!handler) return reply.status(404).send({ error: "not_found" })
    return await handler(request, reply)
  }

  private async loadServerHandlers(serverPath: string): Promise<Map<string, BoringServerRouteHandler>> {
    const cacheBust = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const href = `${pathToFileURL(serverPath).href}?v=${cacheBust}`
    const handlers = new Map<string, BoringServerRouteHandler>()
    const mod = await importServerModule(serverPath, href)
    if (typeof mod.default !== "function") {
      throw new Error(`server plugin ${serverPath} must default-export a BoringServerFactory`)
    }
    // Discriminate between the two `boring.server` default-export
    // contracts by arity:
    //   - `BoringServerFactory = (api) => void` — length 1 (or 0). The
    //     asset manager owns route registration. We call it here.
    //   - `(options, ctx) => WorkspaceServerPlugin` — length 2. Handled
    //     by the pluginEntryResolver path (loaded as a DirPluginEntry
    //     when listed in `defaultPluginPackages` or `plugins:`). We
    //     skip route registration here; the WorkspaceServerPlugin's
    //     own `routes` field is registered via Fastify by the bootstrap.
    if (mod.default.length >= 2) {
      return handlers
    }
    const api = createCapturingBoringServerAPI()
    await mod.default(api)
    for (const route of api.flush()) {
      handlers.set(routeKey(route.method, route.path), route.handler)
    }
    return handlers
  }

  private bumpRevision(id: string): number {
    const next = (this.revisions.get(id) ?? 0) + 1
    this.revisions.set(id, next)
    return next
  }

  private emit(event: BoringPluginEvent): void {
    for (const listener of [...this.listeners]) {
      try { listener(event) } catch { /* ignore bad clients */ }
    }
  }

  private errorPath(pluginId: string): string | null {
    if (!isValidBoringPluginId(pluginId)) return null
    const root = resolve(this.errorRoot)
    const path = resolve(root, pluginId, ".error")
    const rel = relative(root, path)
    if (rel.startsWith("..") || isAbsolute(rel)) return null
    return path
  }

  private writeError(pluginId: string, message: string): void {
    const path = this.errorPath(pluginId)
    if (!path) return
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, message, "utf8")
  }

  private clearError(pluginId: string): void {
    const path = this.errorPath(pluginId)
    if (path && existsSync(path)) rmSync(path, { force: true })
  }
}
