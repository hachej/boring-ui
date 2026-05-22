import { createHash } from "node:crypto"
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { isValidBoringPluginId } from "../../shared/plugins/manifest"
import { preflightBoringPlugins, scanBoringPlugins, type BoringPluginPreflightResult } from "./scan"
import {
  clearPluginSignatureCache,
  pluginFileSignature,
  writePluginSignatureCache,
} from "./signatureCache"
import type {
  BoringPluginEvent,
  BoringPluginListEntry,
  BoringServerPluginManifest,
  PluginRestartSurface,
} from "./types"

interface LoadedPluginRecord extends BoringServerPluginManifest {
  revision: number
  signature: string
  /**
   * pluginFileSignature(serverPath) captured at load time, or `null` when
   * the plugin has no server entry. Lets computeRequiresRestart() decide
   * whether the server file changed between this revision and the next
   * without re-reading the prior file's bytes (they've been overwritten
   * by then).
   */
  serverSignature: string | null
}

export interface BoringPluginAssetManagerOptions {
  pluginDirs: string[]
  /**
   * Root directory for per-plugin `.error` sidecar files written by the
   * asset manager and read by verify-plugin. Defaults to `<cwd>/.pi/extensions`.
   * Multi-tenant / non-standard layouts MUST provide an explicit path —
   * the default assumes workspace root equals `process.cwd()`.
   */
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

function preflightErrorId(pluginDir: string): string {
  return `preflight-${createHash("sha256").update(pluginDir).digest("hex").slice(0, 12)}`
}

// `pluginFileSignature` is imported from `./signatureCache` so verify-plugin
// computes identical signatures when comparing what the manager loaded vs
// what's on disk now.

function directorySignature(root: string | undefined): string {
  if (!root || !existsSync(root)) return "missing"
  const hash = createHash("sha256")
  // Symlinks: follow ONCE via realpath, dedupe via a visited Set.
  // Without this, pnpm `link:` workflows (where plugin sources live
  // behind a symlinked package root) silently never trigger reload.
  // Caps prevent runaway walks if a symlink chain re-enters itself.
  //
  // We hash (rel-path, mtimeMs, size) per file, NOT the file contents,
  // because reading every file's bytes per /reload is O(total bytes) and
  // synchronous — measurably bad for plugin dirs with built artifacts.
  // mtime+size catches every edit through the write/edit tools.
  //
  // realpath of root can throw if the dir vanishes between the existsSync
  // check above and this call (concurrent uninstall). Treat that as
  // "missing" instead of crashing the whole reload pipeline.
  const visited = new Set<string>()
  let rootReal: string
  try { rootReal = realpathSync(root) } catch { return "missing" }
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
        else if (targetStat.isFile()) {
          hash.update(String(targetStat.mtimeMs))
          hash.update(String(targetStat.size))
        }
        continue
      }
      hash.update(rel)
      hash.update(String(stat.mtimeMs))
      hash.update(String(stat.size))
      if (stat.isDirectory()) {
        visit(path, depth + 1)
      }
      // For regular files, mtime+size above is enough — no readFileSync.
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
    .update(pluginFileSignature(plugin.frontPath))
    .update(directorySignature(plugin.frontPath ? dirname(plugin.frontPath) : undefined))
    .update(directorySignature(join(plugin.rootDir, "shared")))
    .update(plugin.serverPath ?? "")
    .update(pluginFileSignature(plugin.serverPath))
    .update(directorySignature(plugin.serverPath ? dirname(plugin.serverPath) : undefined))
    .update((plugin.extensionPaths ?? []).join("\0"))
    .update((plugin.skillPaths ?? []).join("\0"))
    .digest("hex")
}

/**
 * Compare the previous + new manifest's server-side surfaces. Returns
 * the surfaces whose changes can't be hot-reloaded (the workspace
 * wires routes + agentTools once at boot). Cheap heuristic: any
 * change to the server file (signature) AND server file is present
 * in either revision = both surfaces flagged.
 *
 * First-time loads (no `previous`) don't set this — agentTools/routes
 * are correctly in place from the initial boot.
 */
function computeRequiresRestart(
  previous: LoadedPluginRecord | undefined,
  next: BoringServerPluginManifest,
): PluginRestartSurface[] {
  if (!previous) return []
  const prevHasServer = !!previous.serverPath
  const nextHasServer = !!next.serverPath
  if (!prevHasServer && !nextHasServer) return []
  // Server added or removed mid-session — both surfaces need a restart
  // to take effect.
  if (prevHasServer !== nextHasServer) return ["routes", "agentTools"]
  // Both present — we can't compare the PREVIOUS file's content (it's
  // been overwritten), so compare the cached load-time signature against
  // the current on-disk signature.
  const nextSig = pluginFileSignature(next.serverPath)
  if (previous.serverSignature === nextSig) return []
  return ["routes", "agentTools"]
}

export class BoringPluginAssetManager {
  private readonly pluginDirs: string[]
  private readonly errorRoot: string
  private readonly loaded = new Map<string, LoadedPluginRecord>()
  private readonly revisions = new Map<string, number>()
  private readonly listeners = new Set<Listener>()
  private loading: Promise<LoadBoringAssetsResult> | null = null
  private reloadQueued = false

  constructor(options: BoringPluginAssetManagerOptions) {
    this.pluginDirs = options.pluginDirs
    this.errorRoot = options.errorRoot ?? join(process.cwd(), ".pi", "extensions") // callers MUST override errorRoot in non-trivial deployments
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
    const scan = scanBoringPlugins(this.pluginDirs)
    const nextPlugins = scan.plugins
    const nextIds = new Set(nextPlugins.map((plugin) => plugin.id))
    const invalidPluginDirs = new Set(scan.preflight.errors.map((error) => resolve(error.pluginDir)))
    const events: BoringPluginEvent[] = []
    const errors: LoadBoringAssetsError[] = []
    this.collectPreflightErrors(scan.preflight, events, errors)

    for (const id of [...this.loaded.keys()]) {
      if (nextIds.has(id)) continue
      const previous = this.loaded.get(id)
      if (previous && invalidPluginDirs.has(resolve(previous.rootDir))) continue
      const revision = this.bumpRevision(id)
      this.loaded.delete(id)
      // Stale cache outlives the plugin — verify-plugin would otherwise
      // compare against a serverSignature for code that's no longer
      // loaded. Best-effort: don't fail unload if rm fails.
      if (previous) {
        try { clearPluginSignatureCache(previous.rootDir) } catch {}
      }
      const event: BoringPluginEvent = { type: "boring.plugin.unload", id, revision }
      events.push(event)
      this.emit(event)
    }

    for (const plugin of nextPlugins) {
      try {
        const signature = pluginSignature(plugin)
        const previous = this.loaded.get(plugin.id)
        if (previous?.signature === signature) continue
        const revision = this.bumpRevision(plugin.id)
        const serverSignature = plugin.serverPath ? pluginFileSignature(plugin.serverPath) : null
        const record: LoadedPluginRecord = { ...plugin, revision, signature, serverSignature }
        this.loaded.set(plugin.id, record)
        this.clearError(plugin.id)
        // Persist the load-time server signature so verify-plugin can
        // detect server-file drift between this load and the next user
        // invocation. Best-effort: a failed write must not abort the
        // load (the in-memory record is authoritative for the running
        // process; the cache is purely advisory for the CLI).
        try {
          writePluginSignatureCache(plugin.rootDir, { serverSignature })
        } catch {}
        // requiresRestart: only set when the server file's signature
        // changed between revisions. The asset manager re-imports the
        // FRONT mid-session via jiti+Vite, but server-side surfaces
        // (Fastify routes, registered agent tools) are wired ONCE at
        // boot — any server-file change carries stale code until the
        // user restarts. We compute server-only signature changes by
        // comparing the prior record's serverPath fileSignature to the
        // current one. We emit BOTH surfaces because we can't cheaply
        // distinguish "routes changed" from "agentTools changed" — both
        // are wired the same way and any server-source change is
        // suspect.
        const requiresRestart = computeRequiresRestart(previous, plugin)
        const event: BoringPluginEvent = {
          type: "boring.plugin.load",
          id: plugin.id,
          boring: plugin.boring,
          version: plugin.version,
          revision,
          ...(plugin.frontUrl ? { frontUrl: plugin.frontUrl } : {}),
          ...(requiresRestart.length > 0 ? { requiresRestart } : {}),
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

  private collectPreflightErrors(
    preflight: BoringPluginPreflightResult,
    events: BoringPluginEvent[],
    errors: LoadBoringAssetsError[],
  ): void {
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
  }

  private bumpRevision(id: string): number {
    const next = (this.revisions.get(id) ?? 0) + 1
    this.revisions.set(id, next)
    return next
  }

  private emit(event: BoringPluginEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event)
      } catch (error) {
        // Don't let one bad listener block others, but DO log so SSE
        // bugs are visible. Use stderr directly — manager.ts has no
        // logger dependency by design.
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[BoringPluginAssetManager] listener threw on ${event.type} for ${event.id}: ${message}`)
      }
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
