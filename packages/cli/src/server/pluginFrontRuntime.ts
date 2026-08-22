import type { FastifyInstance } from "fastify"
import { dirname, resolve as resolvePath } from "node:path"
import { ErrorCode } from "@hachej/boring-agent/shared"
import type { BoringServerPluginManifest } from "@hachej/boring-workspace/server"
import { diagnostic, PluginFrontRuntimeError, toApiError, type PluginFrontRuntimeDiagnostic } from "./pluginFrontRuntime/diagnostics.js"
import { resolveRuntimeHostLayout } from "./pluginFrontRuntime/hostLayout.js"
import { HOST_SINGLETON_MODULES, type HostProvidedModule } from "./pluginFrontRuntime/hostModules.js"
import { MintedSupportPaths } from "./pluginFrontRuntime/mintedSupportPaths.js"
import { isRuntimeAssetPath, runtimeAssetContentType, runtimeAssetModuleCode } from "./pluginFrontRuntime/runtimeAssets.js"
import {
  assertRuntimeFrontEntrySubpath,
  buildRuntimeUrl,
  ensureSafeId,
  hasFrontDirectorySegment,
  isWithin,
  normalizeBasePath,
  normalizeRequestSubpath,
  normalizeSearch,
  parseRevision,
  parseRuntimeContext,
  PLUGIN_FRONT_RUNTIME_BASE_PATH,
  realpathIfExists,
  type RuntimeContext,
} from "./pluginFrontRuntime/runtimePaths.js"
import { registerRuntimeRoutes } from "./pluginFrontRuntime/routes.js"
import { runtimeSingletonModuleCodeFor } from "./pluginFrontRuntime/singletonModuleCode.js"
import { snapshotRuntimeSourceFiles } from "./pluginFrontRuntime/sourceSnapshot.js"
import { TrackedPluginRegistry, type TrackedPluginRecord } from "./pluginFrontRuntime/trackedPlugins.js"
import { TransformLimiter } from "./pluginFrontRuntime/transformLimiter.js"
import { createRuntimeViteServer } from "./pluginFrontRuntime/viteServer.js"
import { assertNoUnsafeFsSupportReference, rewriteViteSupportUrls } from "./pluginFrontRuntime/viteSupportUrls.js"
import type {
  CreatePluginFrontRuntimeHostOptions,
  PluginFrontRuntimeHost,
  PluginFrontRuntimeResponse,
  PluginFrontRuntimeServeRequest,
  PluginFrontTargetResolver,
} from "./pluginFrontRuntime/types.js"

export { PLUGIN_FRONT_RUNTIME_BASE_PATH } from "./pluginFrontRuntime/runtimePaths.js"
export { HOST_SINGLETON_MODULES } from "./pluginFrontRuntime/hostModules.js"
export type { PluginFrontRuntimeDiagnostic } from "./pluginFrontRuntime/diagnostics.js"
export type {
  CreatePluginFrontRuntimeHostOptions,
  PluginFrontRuntimeHost,
  PluginFrontRuntimeResponse,
  PluginFrontRuntimeServeRequest,
} from "./pluginFrontRuntime/types.js"

const DEFAULT_MAX_TRANSFORM_CONCURRENCY = 8

interface ValidatedRuntimeRequest {
  workspaceId: string
  pluginId: string
  revision: number
  requestedPath: string
  resolvedPath: string
  runtimeId: string
  cacheKey: string
  tracked: TrackedPluginRecord
}

interface TransformCacheEntry {
  runtimeId: string
  promise: Promise<PluginFrontRuntimeResponse>
}

export function __testingRuntimeSingletonModuleCode(source: HostProvidedModule): string | undefined {
  return runtimeSingletonModuleCodeFor(source)
}

/**
 * Serves plugin front modules to the browser out of immutable per-revision
 * snapshots, transformed on demand by a dedicated Vite server.
 *
 * The host owns request validation, the transform cache, and the plugin
 * tracking lifecycle; the module-graph policy lives in ./pluginFrontRuntime/.
 */
export async function createPluginFrontRuntimeHost(
  options: CreatePluginFrontRuntimeHostOptions = {},
): Promise<PluginFrontRuntimeHost> {
  const basePath = normalizeBasePath(options.basePath ?? PLUGIN_FRONT_RUNTIME_BASE_PATH)
  const emit = (entry: Omit<PluginFrontRuntimeDiagnostic, "prefix">) => {
    options.onDiagnostic?.(diagnostic(entry))
  }
  const layout = resolveRuntimeHostLayout()
  const registry = new TrackedPluginRegistry()
  const transformCache = new Map<string, TransformCacheEntry>()
  const minted = new MintedSupportPaths(basePath)
  const limiter = new TransformLimiter(Math.max(1, options.maxTransformConcurrency ?? DEFAULT_MAX_TRANSFORM_CONCURRENCY))
  let closed = false

  const vite = await createRuntimeViteServer({ basePath, layout, registry })

  async function invalidateMatching(predicate: (context: RuntimeContext) => boolean): Promise<void> {
    for (const [cacheKey, entry] of [...transformCache.entries()]) {
      const context = parseRuntimeContext(entry.runtimeId, basePath)
      if (!context || !predicate(context)) continue
      transformCache.delete(cacheKey)
      minted.drop(cacheKey)
      const moduleNode = vite.moduleGraph.getModuleById(entry.runtimeId)
      if (moduleNode) vite.moduleGraph.invalidateModule(moduleNode)
      emit({
        level: "info",
        stage: "cleanup",
        outcome: "disposed",
        msg: "disposed runtime transform cache entry",
        workspaceId: context.workspaceId,
        pluginId: context.pluginId,
        revision: context.revision,
        requestedPath: context.subpath,
      })
    }
  }

  async function validateRequest(request: PluginFrontRuntimeServeRequest): Promise<ValidatedRuntimeRequest> {
    if (closed) {
      throw new PluginFrontRuntimeError(ErrorCode.enum.INTERNAL_ERROR, 503, "serve", "plugin front runtime host is closed")
    }
    const workspaceId = ensureSafeId("workspace", request.workspaceId)
    if (registry.isDisposed(workspaceId)) {
      throw new PluginFrontRuntimeError(ErrorCode.enum.PATH_NOT_FOUND, 404, "validate", "plugin runtime workspace was evicted", { workspaceId })
    }
    const pluginId = ensureSafeId("plugin", request.pluginId)
    const revision = parseRevision(request.revision)
    const requestedPath = normalizeRequestSubpath(request.subpath)
    const tracked = registry.requireRevision(workspaceId, pluginId, revision)
    if (!tracked.sourceSnapshot.has(requestedPath)) {
      throw new PluginFrontRuntimeError(ErrorCode.enum.PATH_NOT_FOUND, 404, "validate", "plugin runtime file was not captured in this revision", {
        workspaceId,
        pluginId,
        requestedRevision: revision,
        path: requestedPath,
      })
    }
    const search = normalizeSearch(request.search)
    return {
      workspaceId,
      pluginId,
      revision,
      requestedPath,
      resolvedPath: resolvePath(tracked.rootDir, requestedPath),
      runtimeId: `${buildRuntimeUrl(basePath, workspaceId, pluginId, revision, requestedPath)}${search}`,
      cacheKey: `${workspaceId}:${pluginId}:${revision}:${requestedPath}${search}`,
      tracked,
    }
  }

  /** Produces the response body for one runtime module; runs under the concurrency limiter. */
  async function transformRuntimeModule(runtimeRequest: ValidatedRuntimeRequest, rawSearch: string | undefined): Promise<PluginFrontRuntimeResponse> {
    const transformStartedAt = Date.now()
    try {
      if (isRuntimeAssetPath(runtimeRequest.requestedPath)) {
        const bytes = runtimeRequest.tracked.sourceSnapshot.get(runtimeRequest.requestedPath)
        if (bytes === undefined) {
          throw new PluginFrontRuntimeError(ErrorCode.enum.PATH_NOT_FOUND, 404, "validate", "plugin runtime file was not captured in this revision")
        }
        const assetAsModule = new URLSearchParams((rawSearch ?? "").replace(/^\?/, "")).has("module")
        return {
          body: assetAsModule ? runtimeAssetModuleCode(runtimeRequest.requestedPath, bytes) : bytes,
          contentType: assetAsModule ? "application/javascript; charset=utf-8" : runtimeAssetContentType(runtimeRequest.requestedPath),
          cacheKey: runtimeRequest.cacheKey,
        }
      }
      const transformed = await vite.transformRequest(runtimeRequest.runtimeId)
      if (!transformed?.code) {
        throw new PluginFrontRuntimeError(
          ErrorCode.enum.PLUGIN_RUNTIME_TRANSFORM_FAILED,
          500,
          "transform",
          "plugin runtime transform returned no module code",
          { runtimeId: runtimeRequest.runtimeId },
        )
      }
      emit({
        level: "info",
        stage: "transform",
        outcome: "served",
        msg: "transformed runtime plugin module",
        workspaceId: runtimeRequest.workspaceId,
        pluginId: runtimeRequest.pluginId,
        revision: runtimeRequest.revision,
        requestedPath: runtimeRequest.requestedPath,
        resolvedPath: runtimeRequest.resolvedPath,
        durationMs: Date.now() - transformStartedAt,
      })
      const rewritten = rewriteViteSupportUrls(transformed.code, basePath, {
        hostNodeModulesRoots: layout.hostNodeModulesRoots,
        allowHostNodeModulesFs: layout.trustedHostPackageRoots.some((root) => isWithin(root, realpathIfExists(runtimeRequest.tracked.rootDir))),
      })
      assertNoUnsafeFsSupportReference(rewritten.code, {
        runtimeId: runtimeRequest.runtimeId,
        workspaceId: runtimeRequest.workspaceId,
        pluginId: runtimeRequest.pluginId,
        revision: runtimeRequest.revision,
        path: runtimeRequest.requestedPath,
      })
      minted.record(runtimeRequest.cacheKey, rewritten.mintedPaths)
      return {
        body: rewritten.code,
        contentType: "application/javascript; charset=utf-8",
        cacheKey: runtimeRequest.cacheKey,
      }
    } catch (error) {
      if (error instanceof PluginFrontRuntimeError) throw error
      throw new PluginFrontRuntimeError(
        ErrorCode.enum.PLUGIN_RUNTIME_TRANSFORM_FAILED,
        500,
        "transform",
        error instanceof Error ? error.message : String(error),
        { runtimeId: runtimeRequest.runtimeId },
      )
    }
  }

  async function serve(request: PluginFrontRuntimeServeRequest): Promise<PluginFrontRuntimeResponse> {
    const startedAt = Date.now()
    let validated: ValidatedRuntimeRequest | undefined
    try {
      const runtimeRequest = await validateRequest(request)
      validated = runtimeRequest
      const epochAtValidation = registry.disposalEpoch(runtimeRequest.workspaceId)
      const cached = transformCache.get(runtimeRequest.cacheKey)
      if (cached) {
        emit({
          level: "info",
          stage: "cache",
          outcome: "cache-hit",
          msg: "served runtime module from transform cache",
          workspaceId: runtimeRequest.workspaceId,
          pluginId: runtimeRequest.pluginId,
          revision: runtimeRequest.revision,
          requestedPath: runtimeRequest.requestedPath,
          resolvedPath: runtimeRequest.resolvedPath,
        })
        return await cached.promise
      }

      emit({
        level: "info",
        stage: "cache",
        outcome: "cache-miss",
        msg: "runtime transform cache miss",
        workspaceId: runtimeRequest.workspaceId,
        pluginId: runtimeRequest.pluginId,
        revision: runtimeRequest.revision,
        requestedPath: runtimeRequest.requestedPath,
        resolvedPath: runtimeRequest.resolvedPath,
      })

      const promise = limiter.run(() => transformRuntimeModule(runtimeRequest, request.search))
      // Swallow rejections here so an epoch-stale discard below (which never
      // awaits `promise`) can't surface as an unhandled promise rejection;
      // the real result/error is still surfaced via the `await promise`
      // (or re-thrown) path when we do use it.
      promise.catch(() => {})

      // Re-check the workspace's disposal epoch right before publishing to
      // the cache. validateRequest() above proved the plugin was tracked at
      // *that* instant, but disposeWorkspace() can run its point-in-time
      // transformCache cleanup in the gap between that check and this line
      // (e.g. a fire-and-forget warmupWorkspace() call racing a concurrent
      // workspace eviction). If the epoch moved, the workspace was evicted
      // mid-flight — don't resurrect a cache entry cleanup already ran past.
      if (registry.disposalEpoch(runtimeRequest.workspaceId) !== epochAtValidation) {
        throw new PluginFrontRuntimeError(ErrorCode.enum.PATH_NOT_FOUND, 404, "validate", "plugin runtime workspace was evicted while serving", {
          workspaceId: runtimeRequest.workspaceId,
          pluginId: runtimeRequest.pluginId,
        })
      }
      transformCache.set(runtimeRequest.cacheKey, { runtimeId: runtimeRequest.runtimeId, promise })
      const response = await promise
      emit({
        level: "info",
        stage: "serve",
        outcome: "served",
        msg: "served runtime plugin module",
        workspaceId: runtimeRequest.workspaceId,
        pluginId: runtimeRequest.pluginId,
        revision: runtimeRequest.revision,
        requestedPath: runtimeRequest.requestedPath,
        resolvedPath: runtimeRequest.resolvedPath,
        durationMs: Date.now() - startedAt,
      })
      return response
    } catch (error) {
      if (validated) {
        transformCache.delete(validated.cacheKey)
        minted.drop(validated.cacheKey)
      }
      const apiError = toApiError(error, validated)
      emit({
        level: apiError.statusCode >= 500 ? "error" : "warn",
        stage: error instanceof PluginFrontRuntimeError ? error.stage : "transform",
        outcome: "rejected",
        msg: apiError.body.error.message,
        workspaceId: validated?.workspaceId ?? request.workspaceId,
        pluginId: validated?.pluginId ?? request.pluginId,
        revision: validated?.revision ?? (typeof request.revision === "number" ? request.revision : Number(request.revision) || undefined),
        requestedPath: validated?.requestedPath ?? request.subpath,
        resolvedPath: validated?.resolvedPath,
        durationMs: Date.now() - startedAt,
        code: apiError.body.error.code,
        details: apiError.body.error.details,
      })
      throw error
    }
  }

  async function invalidatePlugin(workspaceId: string, pluginId: string, keepRevision?: number): Promise<void> {
    await invalidateMatching((entry) => (
      entry.workspaceId === workspaceId
      && entry.pluginId === pluginId
      && (keepRevision === undefined || entry.revision !== keepRevision)
    ))
  }

  async function disposeWorkspace(rawWorkspaceId: string): Promise<void> {
    const workspaceId = ensureSafeId("workspace", rawWorkspaceId)
    registry.disposeWorkspace(workspaceId)
    await invalidateMatching((entry) => entry.workspaceId === workspaceId)
  }

  function trackPlugin(args: { workspaceId: string; plugin: BoringServerPluginManifest; revision: number; frontEntrySubpath: string }): string {
    const workspaceId = ensureSafeId("workspace", args.workspaceId)
    const pluginId = ensureSafeId("plugin", args.plugin.id)
    const revision = parseRevision(args.revision)
    const frontEntrySubpath = normalizeRequestSubpath(args.frontEntrySubpath)
    assertRuntimeFrontEntrySubpath(frontEntrySubpath)
    const entryUrl = buildRuntimeUrl(basePath, workspaceId, pluginId, revision, frontEntrySubpath)
    const rootDir = resolvePath(args.plugin.rootDir)
    // Compute the front root ONCE: source-style plugins expose
    // `front/index.tsx` (front root is `front/`); build-output plugins
    // expose `dist/front/index.js` (front root is `dist/front/`). The
    // root governs both the served allowed subtree and the source
    // snapshot, so they must agree.
    const frontRootRelative = (frontEntrySubpath === "front" || frontEntrySubpath.startsWith("front/"))
      ? "front"
      : dirname(frontEntrySubpath)
    const frontRootDir = resolvePath(rootDir, frontRootRelative)
    const record: TrackedPluginRecord = {
      workspaceId,
      pluginId,
      revision,
      rootDir,
      frontEntrySubpath,
      frontRootDir,
      sharedRootDir: resolvePath(rootDir, "shared"),
      sourceSnapshot: snapshotRuntimeSourceFiles(rootDir, frontRootDir, frontRootRelative),
    }
    registry.store(record)
    emit({
      level: "info",
      stage: "track",
      outcome: "tracked",
      msg: "tracked runtime plugin revision",
      workspaceId: record.workspaceId,
      pluginId: record.pluginId,
      revision: record.revision,
      requestedPath: record.frontEntrySubpath,
      details: {
        rootDir: record.rootDir,
        frontRootDir: record.frontRootDir,
        sharedRootDir: record.sharedRootDir,
        entryUrl,
      },
    })
    return entryUrl
  }

  function untrackPlugin(workspaceId: string, pluginId: string): void {
    const tracked = registry.untrackPlugin(workspaceId, pluginId)
    emit({
      level: "info",
      stage: "cleanup",
      outcome: "disposed",
      msg: "untracked runtime plugin revision",
      workspaceId,
      pluginId,
      revision: tracked?.revision,
      requestedPath: tracked?.frontEntrySubpath,
      details: tracked
        ? {
            rootDir: tracked.rootDir,
            frontRootDir: tracked.frontRootDir,
            sharedRootDir: tracked.sharedRootDir,
          }
        : undefined,
    })
    void invalidatePlugin(workspaceId, pluginId)
  }

  function createFrontTargetResolver(workspaceId: string): PluginFrontTargetResolver {
    const disposalEpoch = registry.disposalEpoch(workspaceId)
    return (plugin, context) => {
      // A plugin manager can finish loading after its workspace was evicted.
      // Its resolver belongs to the old runtime and must not re-track targets.
      if (registry.disposalEpoch(workspaceId) !== disposalEpoch) return undefined
      if (!plugin.frontPath) return undefined
      const frontEntrySubpath = normalizeRequestSubpath(context.frontEntrySubpath)
      if (!hasFrontDirectorySegment(frontEntrySubpath)) return undefined
      return {
        kind: "native",
        entryUrl: trackPlugin({
          workspaceId,
          plugin,
          revision: context.revision,
          frontEntrySubpath,
        }),
        revision: context.revision,
        trust: "local-trusted-native",
      }
    }
  }

  // Pre-transform the front entry (and, transitively, the react /
  // @hachej/boring-workspace singleton modules it imports) for every tracked
  // plugin in a workspace so the first browser request hits a warm transform
  // cache instead of paying ~4s of cold Vite resolve/transform that starves
  // the event loop. Fire-and-forget: failures are swallowed (the real browser
  // request will surface them) and serve()'s own promise-dedupe means a
  // concurrent browser hit reuses this in-flight transform rather than racing.
  async function warmupWorkspace(workspaceId: string): Promise<void> {
    if (closed) return
    const records = registry.workspaceRecords(workspaceId)
    await Promise.all(
      records.map(async (record) => {
        try {
          await serve({
            workspaceId,
            pluginId: record.pluginId,
            revision: record.revision,
            subpath: record.frontEntrySubpath,
          })
        } catch (error) {
          emit({
            level: "warn",
            stage: "transform",
            outcome: "rejected",
            msg: "plugin front warmup transform failed (ignored)",
            workspaceId,
            pluginId: record.pluginId,
            revision: record.revision,
            requestedPath: record.frontEntrySubpath,
            details: { error: error instanceof Error ? error.message : String(error) },
          })
        }
      }),
    )
  }

  async function close(): Promise<void> {
    if (closed) return
    closed = true
    registry.clear()
    transformCache.clear()
    minted.clear()
    emit({
      level: "info",
      stage: "cleanup",
      outcome: "closed",
      msg: "closed plugin front runtime host",
    })
    await vite.close()
  }

  async function registerRoutes(app: FastifyInstance): Promise<void> {
    await registerRuntimeRoutes(app, {
      basePath,
      vite,
      minted,
      hostNodeModulesRoots: layout.hostNodeModulesRoots,
      serve,
      close,
    })
  }

  return {
    basePath,
    singletonModules: HOST_SINGLETON_MODULES,
    createFrontTargetResolver,
    activateWorkspace: (workspaceId: string) => registry.activateWorkspace(ensureSafeId("workspace", workspaceId)),
    trackPlugin,
    untrackPlugin,
    invalidatePlugin,
    disposeWorkspace,
    serve,
    warmupWorkspace,
    registerRoutes,
    close,
  }
}
