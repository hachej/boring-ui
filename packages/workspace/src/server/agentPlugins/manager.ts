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
  BoringPluginFrontTarget,
  BoringPluginFrontTargetResolver,
  BoringPluginListEntry,
  BoringPluginSource,
  BoringPluginSourceInput,
  BoringServerPluginManifest,
  PluginRestartSurface,
} from "./types"
import { normalizeBoringPluginPiPackages } from "./piPackages"
import { compactPiPackages, type WorkspacePiPackageSource } from "../plugins/bootstrapServer"

function skillPathForPiLoader(path: string): string {
  return existsSync(join(path, "SKILL.md")) ? dirname(path) : path
}

interface LoadedPluginRecord extends BoringServerPluginManifest {
  revision: number
  signature: string
  frontTarget?: BoringPluginFrontTarget
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
  pluginDirs: BoringPluginSourceInput[]
  /**
   * Root directory for per-plugin `.error` sidecar files written by the
   * asset manager and read by verify-plugin. Defaults to `<cwd>/.pi/extensions`.
   * Multi-tenant / non-standard layouts MUST provide an explicit path —
   * the default assumes workspace root equals `process.cwd()`.
   */
  errorRoot?: string
  /**
   * Optional host-owned runtime front-target resolver. When omitted, list/event
   * payloads preserve the existing `frontUrl` (`/@fs/...`) fallback only.
   */
  frontTargetResolver?: BoringPluginFrontTargetResolver
  /**
   * Keep legacy `/@fs/...` frontUrl payloads alongside frontTarget. Defaults
   * to true for back-compat; packaged CLI folder/workspaces mode can disable it.
   */
  includeLegacyFrontUrl?: boolean
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

export interface LoadedBoringPluginInspection {
  id: string
  version: string
  revision: number
  rootDir: string
  frontPath?: string
  frontTarget?: BoringPluginFrontTarget
  serverPath?: string
  source: BoringPluginSource
}

export interface LoadedBoringPluginPiSnapshot {
  additionalSkillPaths: string[]
  packages: WorkspacePiPackageSource[]
  extensionPaths: string[]
  systemPromptAppend?: string
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

function normalizePluginSubpath(rootDir: string, path: string): string {
  return relative(rootDir, path).replaceAll("\\", "/")
}

function frontSignatureRoot(plugin: BoringServerPluginManifest): string | undefined {
  if (!plugin.frontPath) return undefined
  const frontRoot = join(plugin.rootDir, "front")
  const rel = relative(frontRoot, plugin.frontPath)
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
    ? frontRoot
    : dirname(plugin.frontPath)
}

function pluginSignature(plugin: BoringServerPluginManifest): string {
  return createHash("sha256")
    .update(JSON.stringify(plugin.boring))
    .update(JSON.stringify(plugin.pi ?? {}))
    .update(plugin.version)
    .update(JSON.stringify(plugin.source))
    .update(plugin.frontPath ?? "")
    .update(pluginFileSignature(plugin.frontPath))
    .update(directorySignature(frontSignatureRoot(plugin)))
    .update(directorySignature(join(plugin.rootDir, "shared")))
    .update(plugin.serverPath ?? "")
    .update(pluginFileSignature(plugin.serverPath))
    .update(directorySignature(plugin.serverPath ? dirname(plugin.serverPath) : undefined))
    .update((plugin.extensionPaths ?? []).join("\0"))
    .update((plugin.skillPaths ?? []).join("\0"))
    .digest("hex")
}

/**
 * Compare the previous + new manifest's static server-side surfaces.
 * Returns the surfaces whose changes can't be hot-reloaded because the
 * trusted app/internal plugin path wires Fastify routes + agentTools once
 * at boot. Workspace-local runtime plugins (`source.kind === "external"`)
 * are handled by RuntimeBackendRegistry and do hot-reload via `/reload`,
 * so they must not produce restart warnings.
 *
 * First-time loads (no `previous`) don't set this — agentTools/routes
 * are correctly in place from the initial boot.
 */
function computeRequiresRestart(
  previous: LoadedPluginRecord | undefined,
  next: BoringServerPluginManifest,
): PluginRestartSurface[] {
  if (!previous) return []
  if (previous.source.kind === "external" && next.source.kind === "external") return []
  const prevHasServer = !!previous.serverPath
  const nextHasServer = !!next.serverPath
  if (!prevHasServer && !nextHasServer) return []
  // Server added or removed mid-session — both static surfaces need a
  // restart to take effect.
  if (prevHasServer !== nextHasServer) return ["routes", "agentTools"]
  // Both present — we can't compare the PREVIOUS file's content (it's
  // been overwritten), so compare the cached load-time signature against
  // the current on-disk signature.
  const nextSig = pluginFileSignature(next.serverPath)
  if (previous.serverSignature === nextSig) return []
  return ["routes", "agentTools"]
}

export class BoringPluginAssetManager {
  private readonly pluginDirs: BoringPluginSourceInput[]
  private readonly errorRoot: string
  private readonly frontTargetResolver?: BoringPluginFrontTargetResolver
  private readonly includeLegacyFrontUrl: boolean
  private readonly loaded = new Map<string, LoadedPluginRecord>()
  private readonly revisions = new Map<string, number>()
  private readonly listeners = new Set<Listener>()
  private readonly lastErrors = new Map<string, LoadBoringAssetsError>()
  private loading: Promise<LoadBoringAssetsResult> | null = null
  private reloadQueued = false

  constructor(options: BoringPluginAssetManagerOptions) {
    this.pluginDirs = options.pluginDirs
    this.errorRoot = options.errorRoot ?? join(process.cwd(), ".pi", "extensions") // callers MUST override errorRoot in non-trivial deployments
    this.frontTargetResolver = options.frontTargetResolver
    this.includeLegacyFrontUrl = options.includeLegacyFrontUrl ?? true
  }

  preflight(): BoringPluginPreflightResult {
    return preflightBoringPlugins(this.pluginDirs)
  }

  list(): BoringPluginListEntry[] {
    return [...this.loaded.values()].map((plugin) => this.toListEntry(plugin))
  }

  /**
   * Plugins whose front lifecycle the SSE channel owns. Internal plugins are
   * app code — their front is statically bundled by the host app and must
   * never be re-imported through the hot-reload pipeline (a second module
   * instance would carry a fresh React context identity, breaking
   * provider ↔ panel lookups). They are loaded server-side (routes, agent
   * tools, Pi snapshot) but excluded from SSE replay and live events.
   */
  listExternal(): BoringPluginListEntry[] {
    return [...this.loaded.values()]
      .filter((plugin) => plugin.source.kind === "external")
      .map((plugin) => this.toListEntry(plugin))
  }

  getError(pluginId: string): string | null {
    const path = this.errorPath(pluginId)
    if (!path || !existsSync(path)) return null
    return readFileSync(path, "utf8")
  }

  getErrors(): LoadBoringAssetsError[] {
    return [...this.lastErrors.values()]
  }

  inspectLoaded(): LoadedBoringPluginInspection[] {
    return [...this.loaded.values()].map((plugin) => ({
      id: plugin.id,
      version: plugin.version,
      revision: plugin.revision,
      rootDir: plugin.rootDir,
      source: plugin.source,
      ...(plugin.frontPath ? { frontPath: plugin.frontPath } : {}),
      ...(plugin.frontTarget ? { frontTarget: plugin.frontTarget } : {}),
      ...(plugin.serverPath ? { serverPath: plugin.serverPath } : {}),
    }))
  }

  inspectLoadedPiSnapshot(): LoadedBoringPluginPiSnapshot {
    const plugins = [...this.loaded.values()]
    const prompts = plugins
      .map((plugin) => plugin.pi?.systemPrompt?.trim())
      .filter((prompt): prompt is string => Boolean(prompt))
    return {
      additionalSkillPaths: [...new Set(plugins.flatMap((plugin) => plugin.skillPaths ?? []).map(skillPathForPiLoader))],
      packages: compactPiPackages(normalizeBoringPluginPiPackages(plugins)),
      extensionPaths: plugins.flatMap((plugin) => plugin.extensionPaths ?? []),
      ...(prompts.length > 0 ? { systemPromptAppend: `# Loaded boring-ui plugin context\n\n${prompts.join("\n\n")}` } : {}),
    }
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
    this.lastErrors.clear()
    const scan = scanBoringPlugins(this.pluginDirs)
    const nextPlugins = scan.plugins.filter((plugin) => plugin.hasBoring)
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
      this.lastErrors.delete(id)
      // Stale cache outlives the plugin — verify-plugin would otherwise
      // compare against a serverSignature for code that's no longer
      // loaded. Best-effort: don't fail unload if rm fails.
      if (previous) {
        try { clearPluginSignatureCache(previous.rootDir) } catch {}
      }
      this.record(events, { type: "boring.plugin.unload", id, revision }, previous?.source)
    }

    for (const plugin of nextPlugins) {
      try {
        const signature = pluginSignature(plugin)
        const previous = this.loaded.get(plugin.id)
        if (previous?.signature === signature) continue
        const revision = this.bumpRevision(plugin.id)
        const frontTarget = this.resolveFrontTarget(plugin, revision)
        const serverSignature = plugin.serverPath ? pluginFileSignature(plugin.serverPath) : null
        const record: LoadedPluginRecord = {
          ...plugin,
          revision,
          signature,
          ...(frontTarget ? { frontTarget } : {}),
          serverSignature,
        }
        this.loaded.set(plugin.id, record)
        this.lastErrors.delete(plugin.id)
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
          ...(this.frontUrlPayload(plugin.frontUrl)),
          ...(frontTarget ? { frontTarget } : {}),
          ...(requiresRestart.length > 0 ? { requiresRestart } : {}),
        }
        this.record(events, event, plugin.source)
      } catch (error) {
        const revision = this.bumpRevision(plugin.id)
        const message = error instanceof Error ? error.stack ?? error.message : String(error)
        this.writeError(plugin.id, message)
        const loadError = { id: plugin.id, revision, message }
        this.lastErrors.set(plugin.id, loadError)
        errors.push(loadError)
        this.record(events, { type: "boring.plugin.error", id: plugin.id, revision, message }, plugin.source)
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
      this.lastErrors.set(id, loadError)
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

  private toListEntry(plugin: LoadedPluginRecord): BoringPluginListEntry {
    return {
      id: plugin.id,
      boring: plugin.boring,
      ...(plugin.pi ? { pi: plugin.pi } : {}),
      version: plugin.version,
      revision: plugin.revision,
      ...(this.frontUrlPayload(plugin.frontUrl)),
      ...(plugin.frontTarget ? { frontTarget: plugin.frontTarget } : {}),
    }
  }

  private frontUrlPayload(frontUrl: string | undefined): Pick<BoringPluginListEntry, "frontUrl"> | Record<string, never> {
    if (!this.includeLegacyFrontUrl || !frontUrl) return {}
    return { frontUrl }
  }

  private resolveFrontTarget(plugin: BoringServerPluginManifest, revision: number): BoringPluginFrontTarget | undefined {
    if (!plugin.frontPath || !this.frontTargetResolver) return undefined
    const frontEntrySubpath = typeof plugin.boring.front === "string"
      ? plugin.boring.front.replace(/^\.\//, "")
      : normalizePluginSubpath(plugin.rootDir, plugin.frontPath)
    const frontTarget = this.frontTargetResolver(plugin, {
      revision,
      frontEntrySubpath,
    })
    if (!frontTarget) return undefined
    return { ...frontTarget, revision }
  }

  /**
   * Append to the load result's events array and emit on the SSE channel —
   * unless the source is internal. Internal plugins are app code: their
   * events stay in the load result (for /reload diagnostics and restart
   * warnings) but never reach SSE subscribers (see listExternal).
   */
  private record(events: BoringPluginEvent[], event: BoringPluginEvent, source: BoringPluginSource | undefined): void {
    events.push(event)
    if (source?.kind !== "internal") this.emit(event)
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
