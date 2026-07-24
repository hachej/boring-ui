import type { FastifyInstance, FastifyRequest } from "fastify"
import type { WorkspaceAgentServerPluginContext } from "@hachej/boring-workspace/app/server"
import type {
  ProvisionWorkspaceRuntimeOptions,
  RuntimeModeAdapter,
  RuntimeModeId,
  WorkspaceAgentDispatcherResolver,
  WorkspaceProvisioningAdapter,
  WorkspaceProvisioningResult,
} from "@hachej/boring-agent/server"
import { getBoringAgentRuntimePaths, type BoringAgentRuntimePaths } from "@hachej/boring-sandbox/providers/node-workspace"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { basename, isAbsolute, join, resolve } from "node:path"
import { createLocalWorkspaceRegistry, type LocalWorkspace } from "./localWorkspaces.js"
import { registerWorkspacePluginConfigRoutes, registerWorkspaceTaskRoutes } from "./workspacePluginRoutes.js"
import type {
  RuntimePluginDiagnosticsResponse,
  RuntimePluginFrontError,
  RuntimePluginHostSnapshot,
  RuntimePluginServerSnapshotEntry,
} from "../shared/runtimePluginDiagnostics.js"
import { resolveBoringUiCliPackageRoot } from "./pluginDiscovery.js"
import type { readCliPluginPiSnapshot as readCliPluginPiSnapshotFn } from "./pluginDiscovery.js"

type CliPluginPiSnapshot = ReturnType<typeof readCliPluginPiSnapshotFn>

export const MODE_MAP = {
  "local": "direct", // no sandbox, full network access
  "local-sandbox": "local", // bwrap isolated, no network (Linux only)
} as const

export type CliMode = keyof typeof MODE_MAP
export type RuntimeMode = typeof MODE_MAP[CliMode]

const require = createRequire(import.meta.url)
const PLUGIN_CLI_PACKAGE_NAME = "@hachej/boring-ui-plugin-cli"

export const CLI_VERSION = (() => {
  try {
    const pkg = require("../../package.json") as { version?: string }
    return pkg.version ?? "0.0.0"
  } catch {
    return "0.0.0"
  }
})()
function httpError(message: string, statusCode: number): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number }
  error.statusCode = statusCode
  return error
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (!Array.isArray(value)) return undefined
  return value.find((item): item is string => typeof item === "string")
}

function resolveWorkspaceIdFromRequest(request: { headers?: Record<string, unknown>; query?: unknown }): string {
  const headers = request.headers ?? {}
  const headerValue = headers["x-boring-workspace-id"]
    ?? Object.entries(headers).find(([key]) => key.toLowerCase() === "x-boring-workspace-id")?.[1]
  const query = request.query as Record<string, unknown> | undefined
  const raw = firstString(headerValue) ?? firstString(query?.workspaceId) ?? ""
  const workspaceId = raw.trim()
  if (!workspaceId) throw httpError("workspace id is required", 400)
  if (
    workspaceId.includes("\0")
    || workspaceId.includes("/")
    || workspaceId.includes("\\")
    || workspaceId.includes("..")
    || isAbsolute(workspaceId)
  ) {
    throw httpError("invalid workspace id", 400)
  }
  return workspaceId
}

function toCoreWorkspace(workspace: LocalWorkspace) {
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.id,
    isDefault: false,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
    unavailable: !workspace.available,
    path: workspace.path,
  }
}
function isUsableBoringUiPluginCliPackageRoot(candidate: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(candidate, "package.json"), "utf8")) as { name?: string }
    return pkg.name === PLUGIN_CLI_PACKAGE_NAME
      && existsSync(join(candidate, "dist", "bin.js"))
  } catch {
    return false
  }
}

export function resolveBoringUiPluginCliPackageRoot(): string | null {
  const cliRoot = resolveBoringUiCliPackageRoot()
  const candidate = resolve(cliRoot, "..", "plugin-cli")
  return isUsableBoringUiPluginCliPackageRoot(candidate) ? candidate : null
}

export function createBoringUiCliRuntimePlugin(): ProvisionWorkspaceRuntimeOptions["plugins"][number] {
  const useLocal = process.env.BORING_USE_LOCAL_PACKAGES === "1"
  const packageRoot = useLocal ? resolveBoringUiPluginCliPackageRoot() : null
  return {
    id: "boring-ui-plugin-cli-runtime",
    provisioning: {
      nodePackages: [{
        id: "boring-ui-plugin-cli",
        packageName: PLUGIN_CLI_PACKAGE_NAME,
        ...(packageRoot ? { packageRoot } : { version: CLI_VERSION }),
        expectedBins: ["boring-ui-plugin"],
      }],
    },
  }
}

export async function provisionCliWorkspaceRuntime(opts: {
  workspaceRoot: string
  mode: RuntimeModeId
  provisionWorkspace?: boolean
  plugins?: ProvisionWorkspaceRuntimeOptions["plugins"]
  adapter?: WorkspaceProvisioningAdapter
  modeAdapter?: Pick<RuntimeModeAdapter, "create" | "runtimeHost">
  runtimeLayout?: BoringAgentRuntimePaths
}): Promise<WorkspaceProvisioningResult | undefined> {
  if (opts.provisionWorkspace === false) return undefined
  const [agent, workspaceHost] = await Promise.all([
    import("@hachej/boring-agent/server"),
    import("@hachej/boring-workspace/app/server"),
  ])
  const runtimeLayout = opts.runtimeLayout ?? getBoringAgentRuntimePaths(opts.workspaceRoot)
  let scopedRuntime: Awaited<ReturnType<RuntimeModeAdapter['create']>> | undefined
  let operationError: unknown
  try {
    let adapter = opts.adapter
    if (!adapter) {
      const modeAdapter = opts.modeAdapter
        ?? workspaceHost.createSandboxRuntimeModeAdapter(opts.mode as 'direct' | 'local' | 'vercel-sandbox')
      scopedRuntime = await modeAdapter.create({
        workspaceRoot: opts.workspaceRoot,
        workspaceId: opts.workspaceRoot,
        sessionId: opts.workspaceRoot,
      })
      adapter = scopedRuntime.provisioningAdapter
    }
    if (!adapter) {
      throw new Error(`runtime mode ${opts.mode} does not support workspace provisioning`)
    }
    const result = await agent.provisionWorkspaceRuntime({
      plugins: [createBoringUiCliRuntimePlugin(), ...(opts.plugins ?? [])],
      adapter,
      runtimeLayout,
      runtimeHost: opts.modeAdapter?.runtimeHost ?? workspaceHost.sandboxRuntimeHostOperations,
    })
    return {
      ...result,
      env: {
        ...result.env,
        BORING_AGENT_WORKSPACE_LOCAL_PLUGIN_ROOTS: opts.mode === "direct" || opts.mode === "local" ? "1" : "0",
      },
    }
  } catch (error) {
    operationError = error
    throw error
  } finally {
    try {
      await scopedRuntime?.disposeRuntime?.()
    } catch (error) {
      if (operationError === undefined) throw error
    }
  }
}
const FOLDER_RUNTIME_PLUGIN_WORKSPACE_ID = "folder"
const RUNTIME_PLUGIN_TRUST_LABEL = "Trusted local runtime plugins"
const RUNTIME_PLUGIN_TRUST_DESCRIPTION = "Loads plugin UI code from trusted local Pi extension roots through the CLI-owned runtime module host."

function createRuntimePluginDiagnosticsStore() {
  const byWorkspace = new Map<string, Map<string, RuntimePluginHostSnapshot>>()
  // Browser-reported front import failures, keyed workspace -> pluginId. The
  // server stays green for these (the manifest scan and runtime transform both
  // succeed) — only the browser knows the front module failed to evaluate, so
  // it reports the failure back here for the diagnostics surfaces to render.
  const frontErrorsByWorkspace = new Map<string, Map<string, RuntimePluginFrontError>>()

  function upsert(workspaceId: string, pluginId: string): RuntimePluginHostSnapshot {
    const workspace = byWorkspace.get(workspaceId) ?? new Map<string, RuntimePluginHostSnapshot>()
    byWorkspace.set(workspaceId, workspace)
    const existing = workspace.get(pluginId) ?? {
      workspaceId,
      pluginId,
      recent: [],
    }
    workspace.set(pluginId, existing)
    return existing
  }

  return {
    record(diagnostic: {
      workspaceId?: string
      pluginId?: string
      revision?: number
      requestedPath?: string
      resolvedPath?: string
      durationMs?: number
      stage: string
      outcome: string
      code?: string
      msg: string
      details?: Record<string, unknown>
      level: string
      prefix: string
    }) {
      if (!diagnostic.workspaceId || !diagnostic.pluginId) return
      const entry = upsert(diagnostic.workspaceId, diagnostic.pluginId)
      const now = Date.now()
      entry.lastDiagnostic = diagnostic as RuntimePluginHostSnapshot["lastDiagnostic"]
      entry.recent = [...entry.recent, diagnostic as RuntimePluginHostSnapshot["recent"][number]].slice(-12)
      if (diagnostic.revision !== undefined) entry.revision = diagnostic.revision
      if (diagnostic.requestedPath) entry.lastRequestedPath = diagnostic.requestedPath
      if (diagnostic.resolvedPath) entry.lastResolvedPath = diagnostic.resolvedPath
      const details = diagnostic.details ?? {}
      if (typeof details.rootDir === "string") entry.rootDir = details.rootDir
      if (typeof details.entryUrl === "string") entry.entryUrl = details.entryUrl
      if (typeof diagnostic.requestedPath === "string") entry.frontEntrySubpath = diagnostic.requestedPath
      if (diagnostic.stage === "track" && diagnostic.outcome === "tracked") {
        entry.lastErrorCode = undefined
        entry.lastErrorMessage = undefined
        entry.lastErrorStage = undefined
        // A newer revision was tracked: any front error reported against an
        // older revision is now stale (the user likely fixed the import and
        // /reloaded). Errors for this exact revision or newer are kept until the
        // browser reports success by simply not re-POSTing a failure.
        const storedFrontError = frontErrorsByWorkspace.get(diagnostic.workspaceId)?.get(diagnostic.pluginId)
        if (storedFrontError && diagnostic.revision !== undefined && storedFrontError.revision < diagnostic.revision) {
          frontErrorsByWorkspace.get(diagnostic.workspaceId)?.delete(diagnostic.pluginId)
        }
      }
      if (diagnostic.stage === "cache") entry.lastRequestAt = now
      if (diagnostic.stage === "transform" && diagnostic.outcome === "served") {
        entry.lastTransformAt = now
        entry.lastTransformDurationMs = diagnostic.durationMs
      }
      if (diagnostic.stage === "serve" && diagnostic.outcome === "served") {
        entry.lastServeAt = now
        entry.lastServeDurationMs = diagnostic.durationMs
        entry.lastErrorCode = undefined
        entry.lastErrorMessage = undefined
        entry.lastErrorStage = undefined
      }
      if (diagnostic.outcome === "rejected") {
        entry.lastRejectedAt = now
        entry.lastErrorCode = diagnostic.code as RuntimePluginHostSnapshot["lastErrorCode"]
        entry.lastErrorMessage = diagnostic.msg
        entry.lastErrorStage = diagnostic.stage as RuntimePluginHostSnapshot["lastErrorStage"]
      }
      if (diagnostic.stage === "cleanup" && diagnostic.outcome === "disposed") {
        entry.lastDisposedAt = now
      }
    },
    snapshot(workspaceId: string): RuntimePluginHostSnapshot[] {
      return [...(byWorkspace.get(workspaceId)?.values() ?? [])]
        .map((entry) => ({ ...entry, recent: [...entry.recent] }))
        .sort((a, b) => a.pluginId.localeCompare(b.pluginId))
    },
    recordFrontError(workspaceId: string, error: RuntimePluginFrontError) {
      const forWorkspace = frontErrorsByWorkspace.get(workspaceId) ?? new Map<string, RuntimePluginFrontError>()
      frontErrorsByWorkspace.set(workspaceId, forWorkspace)
      // Only keep the latest failure at or past the last one we saw; a stale
      // retry from an older revision must not clobber a fresher report.
      const existing = forWorkspace.get(error.pluginId)
      if (existing && existing.revision > error.revision) return
      forWorkspace.set(error.pluginId, error)
    },
    clearFrontError(workspaceId: string, pluginId: string) {
      frontErrorsByWorkspace.get(workspaceId)?.delete(pluginId)
    },
    frontErrors(workspaceId: string): RuntimePluginFrontError[] {
      return [...(frontErrorsByWorkspace.get(workspaceId)?.values() ?? [])]
        .sort((a, b) => a.pluginId.localeCompare(b.pluginId))
    },
    disposeWorkspace(workspaceId: string) {
      byWorkspace.delete(workspaceId)
      frontErrorsByWorkspace.delete(workspaceId)
    },
  }
}

function syncRuntimeHostFromPluginEvents(
  runtimeHost: { untrackPlugin(workspaceId: string, pluginId: string): void },
  workspaceId: string,
  events: Array<{ type: string; id: string; frontTarget?: unknown }>,
): void {
  for (const event of events) {
    if (event.type === "boring.plugin.unload" || (event.type === "boring.plugin.load" && !event.frontTarget)) {
      runtimeHost.untrackPlugin(workspaceId, event.id)
    }
  }
}

function buildRuntimePluginDiagnosticsResponse(args: {
  workspaceId: string
  loaded: Array<{ id: string; version?: string; revision?: number; rootDir?: string; frontPath?: string; frontTarget?: unknown }>
  errors: Array<{ id: string; message: string }>
  host: RuntimePluginHostSnapshot[]
  frontErrors?: RuntimePluginFrontError[]
}): RuntimePluginDiagnosticsResponse {
  const byPlugin = new Map<string, RuntimePluginServerSnapshotEntry>()
  for (const plugin of args.loaded) {
    byPlugin.set(plugin.id, {
      id: plugin.id,
      ...(plugin.version ? { version: plugin.version } : {}),
      ...(plugin.rootDir ? { rootDir: plugin.rootDir } : {}),
      ...(plugin.frontPath ? { frontPath: plugin.frontPath } : {}),
      ...(plugin.frontTarget ? { frontTarget: plugin.frontTarget as RuntimePluginServerSnapshotEntry["frontTarget"] } : {}),
      ...(plugin.revision !== undefined ? { serverLoadedRevision: plugin.revision } : {}),
    })
  }
  for (const error of args.errors) {
    const current = byPlugin.get(error.id) ?? { id: error.id }
    byPlugin.set(error.id, {
      ...current,
      serverError: error.message,
    })
  }
  for (const hostEntry of args.host) {
    const current = byPlugin.get(hostEntry.pluginId) ?? { id: hostEntry.pluginId }
    byPlugin.set(hostEntry.pluginId, {
      ...current,
      ...(current.rootDir ? {} : hostEntry.rootDir ? { rootDir: hostEntry.rootDir } : {}),
      ...(current.frontPath ? {} : hostEntry.frontEntrySubpath ? { frontPath: hostEntry.frontEntrySubpath } : {}),
      ...(current.frontTarget ? {} : hostEntry.entryUrl ? { frontTarget: { kind: "native", entryUrl: hostEntry.entryUrl, revision: hostEntry.revision ?? 0, trust: "local-trusted-native" } } : {}),
      host: hostEntry,
    })
  }
  for (const frontError of args.frontErrors ?? []) {
    const current = byPlugin.get(frontError.pluginId) ?? { id: frontError.pluginId }
    byPlugin.set(frontError.pluginId, {
      ...current,
      frontError,
    })
  }
  return {
    workspaceId: args.workspaceId,
    plugins: [...byPlugin.values()].sort((a, b) => a.id.localeCompare(b.id)),
  }
}

// Parses a browser-reported front import failure (POST body) into a stored
// diagnostic. Returns null when the payload is malformed so the route can 400.
function parseFrontErrorReport(pluginId: string, body: unknown): RuntimePluginFrontError | null {
  if (typeof body !== "object" || body === null) return null
  const record = body as Record<string, unknown>
  const message = typeof record.message === "string" ? record.message : ""
  if (!pluginId || !message) return null
  const revisionRaw = record.revision
  const revision = typeof revisionRaw === "number" && Number.isFinite(revisionRaw) ? revisionRaw : 0
  return {
    pluginId,
    revision,
    message,
    ...(typeof record.url === "string" ? { url: record.url } : {}),
    reportedAt: Date.now(),
  }
}
export async function createFolderModeApp(opts: {
  workspaceRoot: string
  mode: RuntimeMode
  projectName?: string
  provisionWorkspace?: boolean
  allowInsecureLocalBridgeAuth?: boolean
}): Promise<FastifyInstance> {
  const workspaceRoot = resolve(opts.workspaceRoot)
  const projectName = opts.projectName ?? (basename(workspaceRoot) || "workspace")
  const [{ createWorkspaceAgentServer, readWorkspacePluginPackageRuntimePlugins }, { createPluginFrontRuntimeHost }, pluginDiscovery] = await Promise.all([
    import("@hachej/boring-workspace/app/server"),
    import("./pluginFrontRuntime.js"),
    import("./pluginDiscovery.js"),
  ])
  const diagnosticsStore = createRuntimePluginDiagnosticsStore()
  const runtimeHost = await createPluginFrontRuntimeHost({
    onDiagnostic: (diagnostic) => diagnosticsStore.record(diagnostic),
  })
  const pluginDirs = pluginDiscovery.resolveCliBoringPluginDirs(workspaceRoot, { includeFolderModeAutomation: true })
  const runtimeProvisioning = await provisionCliWorkspaceRuntime({
    workspaceRoot,
    mode: opts.mode,
    provisionWorkspace: opts.provisionWorkspace,
    plugins: readWorkspacePluginPackageRuntimePlugins(pluginDirs),
  })
  const app = await createWorkspaceAgentServer({
    workspaceRoot,
    mode: opts.mode,
    logger: false,
    trustedDirectLocalNativeSessions: true,
    provisionWorkspace: false,
    runtimeProvisioning,
    // The standalone CLI runs on the user's own machine, so ambient skill
    // discovery (workspace + user-global ~/.pi skills) is on. The library
    // default is off (withPiHarnessDefaults) to keep hosted agents isolated.
    pi: { noSkills: false },
    // CLI-bundled internal plugins, resolved to absolute package dirs. This
    // drives the server-side install array (boot-time routes/agentTools);
    // additionalBoringPluginDirs only feeds the asset-manager scan.
    defaultPluginPackages: pluginDiscovery.resolveCliDefaultPluginPackagePaths({ includeFolderModeAutomation: true }),
    additionalBoringPluginDirs: pluginDirs,
    workspaceBridge: { allowInsecureLocalCliBrowserAuth: opts.allowInsecureLocalBridgeAuth === true },
    boringPluginFrontTargetResolver: runtimeHost.createFrontTargetResolver(FOLDER_RUNTIME_PLUGIN_WORKSPACE_ID),
  })
  await runtimeHost.registerRoutes(app as FastifyInstance)
  const folderAssetManager = (app as FastifyInstance & {
    __boringAssetManager?: {
      subscribe(listener: (event: { type: string; id: string; frontTarget?: unknown }) => void): () => void
    }
  }).__boringAssetManager
  const closeFolderRuntimeCleanup = folderAssetManager?.subscribe((event) => {
    syncRuntimeHostFromPluginEvents(runtimeHost, FOLDER_RUNTIME_PLUGIN_WORKSPACE_ID, [event])
  })
  if (closeFolderRuntimeCleanup) {
    app.addHook("onClose", async () => {
      closeFolderRuntimeCleanup()
    })
  }

  app.get("/api/v1/runtime-plugin-diagnostics", async () => {
    const manager = (app as FastifyInstance & {
      __boringAssetManager?: {
        inspectLoaded(): Array<{ id: string; version?: string; revision?: number; rootDir?: string; frontPath?: string; frontTarget?: unknown }>
        getErrors(): Array<{ id: string; message: string }>
      }
    }).__boringAssetManager
    return buildRuntimePluginDiagnosticsResponse({
      workspaceId: FOLDER_RUNTIME_PLUGIN_WORKSPACE_ID,
      loaded: manager?.inspectLoaded() ?? [],
      errors: manager?.getErrors() ?? [],
      host: diagnosticsStore.snapshot(FOLDER_RUNTIME_PLUGIN_WORKSPACE_ID),
      frontErrors: diagnosticsStore.frontErrors(FOLDER_RUNTIME_PLUGIN_WORKSPACE_ID),
    })
  })

  app.post("/api/v1/agent-plugins/:id/front-error", async (request, reply) => {
    const { id } = request.params as { id: string }
    const report = parseFrontErrorReport(id, request.body)
    if (!report) return reply.code(400).send({ error: "invalid_front_error_report" })
    diagnosticsStore.recordFrontError(FOLDER_RUNTIME_PLUGIN_WORKSPACE_ID, report)
    return reply.code(204).send()
  })

  app.get("/api/v1/workspace/meta", async () => ({
    workspaceId: "default",
    workspaceRoot,
    projectName,
    version: CLI_VERSION,
    runtimePluginFrontLoadingEnabled: true,
    runtimePluginTrustLabel: RUNTIME_PLUGIN_TRUST_LABEL,
    runtimePluginTrustDescription: RUNTIME_PLUGIN_TRUST_DESCRIPTION,
    runtimePluginDiagnosticsEnabled: true,
  }))

  return app as FastifyInstance
}
export async function createWorkspacesModeApp(opts: {
  mode: RuntimeMode
  registryPath?: string
  provisionWorkspace?: boolean
}): Promise<FastifyInstance> {
  const [workspaceAppServer, workspaceServer, agentServer, agentShared, fastifyModule, { createPluginFrontRuntimeHost }, { automationRoutes, createBoringAutomationTool, DueRunService, FileAutomationStore, ManualRunExecutor, resolveAutomationOperationsForActor }, pluginDiscovery] = await Promise.all([
    import("@hachej/boring-workspace/app/server"),
    import("@hachej/boring-workspace/server"),
    import("@hachej/boring-agent/server"),
    import("@hachej/boring-agent/shared"),
    import("fastify"),
    import("./pluginFrontRuntime.js"),
    import("@hachej/boring-automation/server"),
    import("./pluginDiscovery.js"),
  ])
  const registry = createLocalWorkspaceRegistry(opts.registryPath)
  const sandboxRuntimeAdapter = workspaceAppServer.createSandboxRuntimeModeAdapter(opts.mode)
  const sandboxRuntimeHost = workspaceAppServer.sandboxRuntimeHostOperations
  const app = fastifyModule.default({ logger: false, bodyLimit: 16 * 1024 * 1024 })
  // CLI workspaces mode has one trusted local actor. Pi chat routes use this
  // identity to read the same scoped session records created by automation runs.
  app.addHook("onRequest", async (request) => {
    const localRequest = request as FastifyRequest & { user?: { id: string } }
    localRequest.user ??= { id: "local" }
  })
  const diagnosticsStore = createRuntimePluginDiagnosticsStore()
  const runtimeHost = await createPluginFrontRuntimeHost({
    onDiagnostic: (diagnostic) => diagnosticsStore.record(diagnostic),
  })
  await runtimeHost.registerRoutes(app)
  // External plugin server routes (/api/v1/plugins/<id>/*). The gateway is
  // registered once; dispatch resolves the per-workspace RuntimeBackendRegistry
  // from the request's workspaceId (header), lazily booting the runtime.
  await app.register(workspaceServer.runtimeBackendGateway, {
    registry: {
      dispatch: async (dispatchRequest) => {
        if (!dispatchRequest.workspaceId) {
          throw new workspaceServer.RuntimeBackendError(
            agentShared.ErrorCode.enum.RUNTIME_PLUGIN_NOT_FOUND,
            404,
            "runtime backend dispatch requires a workspace id (x-boring-workspace-id header)",
          )
        }
        const workspace = await registry.get(dispatchRequest.workspaceId)
        if (!workspace?.available) {
          throw new workspaceServer.RuntimeBackendError(
            agentShared.ErrorCode.enum.RUNTIME_PLUGIN_NOT_FOUND,
            404,
            `runtime backend dispatch: unknown workspace ${dispatchRequest.workspaceId}`,
          )
        }
        const runtime = await getLoadedPluginRuntime(workspace)
        // Workspace-local plugin sources carry the workspace ROOT PATH as their
        // workspaceId (see resolveCliBoringPluginDirs); the HTTP request carries
        // the registry id. Each workspace has its own backendRegistry, so
        // translate id → path for the registry's scope check.
        return runtime.backendRegistry.dispatch({ ...dispatchRequest, workspaceId: resolve(workspace.path) })
      },
    },
  })
  const bridges = new Map<string, ReturnType<typeof workspaceServer.createInMemoryBridge>>()
  type WorkspaceBridgeCore = {
    registry: ReturnType<typeof workspaceServer.createWorkspaceBridgeRuntimeCore>["registry"]
    idempotencyStore: InstanceType<typeof workspaceServer.InMemoryWorkspaceBridgeIdempotencyStore>
    extraTools: NonNullable<ReturnType<typeof workspaceAppServer.collectWorkspaceAgentServerPlugins>["agentOptions"]["extraTools"]>
    preservedUiStateKeys: NonNullable<ReturnType<typeof workspaceAppServer.collectWorkspaceAgentServerPlugins>["preservedUiStateKeys"]>
  }
  const workspaceBridgeCores = new Map<string, Promise<WorkspaceBridgeCore>>()
  const workspaceEventClosers = new Map<string, Set<() => void>>()
  const pluginRuntimes = new Map<string, {
    manager: InstanceType<typeof workspaceServer.BoringPluginAssetManager>
    backendRegistry: InstanceType<typeof workspaceServer.RuntimeBackendRegistry>
    ensureLoaded: Promise<void>
  }>()
  const pluginPiSnapshots = new Map<string, CliPluginPiSnapshot>()
  const runtimeProvisioningByWorkspace = new Map<string, WorkspaceProvisioningResult | undefined>()
  const automationStores = new Map<string, InstanceType<typeof FileAutomationStore>>()
  let workspaceAgentDispatcher: WorkspaceAgentDispatcherResolver | undefined

  function getBridge(workspaceId: string) {
    let bridge = bridges.get(workspaceId)
    if (!bridge) {
      bridge = workspaceServer.createInMemoryBridge()
      bridges.set(workspaceId, bridge)
    }
    return bridge
  }

  async function getWorkspaceBridgeCore(workspace: LocalWorkspace) {
    let core = workspaceBridgeCores.get(workspace.id)
    if (core) return await core
    core = (async (): Promise<WorkspaceBridgeCore> => {
      const pluginCollection = await workspaceAppServer.resolveWorkspaceAgentServerPluginCollection({
        workspaceRoot: workspace.path,
        bridge: getBridge(workspace.id),
        trustedPluginContext: taskSessionTrustedPluginContext,
        defaultPluginPackages: pluginDiscovery.resolveCliDefaultPluginPackagePaths(),
        installPluginAuthoring: false,
        excludeDefaults: ["boring-ui-plugin-cli-package"],
      })
      const bridgeCore = workspaceServer.createWorkspaceBridgeRuntimeCore({
        ownerWorkspaceId: workspace.id,
        handlers: pluginCollection.workspaceBridgeHandlers ?? [],
      })
      return {
        registry: bridgeCore.registry,
        idempotencyStore: new workspaceServer.InMemoryWorkspaceBridgeIdempotencyStore(),
        extraTools: pluginCollection.agentOptions.extraTools ?? [],
        preservedUiStateKeys: pluginCollection.preservedUiStateKeys ?? [],
      }
    })().catch((error) => {
      workspaceBridgeCores.delete(workspace.id)
      throw error
    })
    workspaceBridgeCores.set(workspace.id, core)
    return await core
  }

  async function requireWorkspace(workspaceId: string): Promise<LocalWorkspace> {
    const workspace = await registry.get(workspaceId)
    if (!workspace) throw httpError("unknown workspace", 404)
    if (!workspace.available) throw httpError("workspace folder unavailable", 409)
    return workspace
  }

  async function workspaceFromRequest(request: { headers?: Record<string, unknown>; query?: unknown }) {
    return await requireWorkspace(resolveWorkspaceIdFromRequest(request))
  }

  function automationStore(workspace: LocalWorkspace) {
    const key = pluginRuntimeKey(workspace)
    let store = automationStores.get(key)
    if (!store) {
      store = new FileAutomationStore(join(workspace.path, ".pi", "automation"))
      automationStores.set(key, store)
    }
    return store
  }

  async function automationExecutorForRequest(request: FastifyRequest) {
    const workspace = await workspaceFromRequest(request)
    if (!workspaceAgentDispatcher) throw httpError("workspace agent dispatcher is unavailable", 503)
    return new ManualRunExecutor({
      store: automationStore(workspace),
      dispatcherResolver: workspaceAgentDispatcher,
      actorResolver: () => ({ workspaceId: workspace.id, userId: "local" }),
    })
  }

  function automationTool() {
    return createBoringAutomationTool({
      resolveOperationsForActor: async (actorContext) => resolveAutomationOperationsForActor({
        mode: "local",
        resolveStore: async (actor) => automationStore(await requireWorkspace(actor.workspaceId)),
        resolveExecutor: async (actor, store) => {
          if (!workspaceAgentDispatcher) throw httpError("workspace agent dispatcher is unavailable", 503)
          return new ManualRunExecutor({
            store,
            dispatcherResolver: workspaceAgentDispatcher,
            actorResolver: () => actor,
          })
        },
        localUserId: "local",
      }, actorContext),
    })
  }

  function pluginRuntimeKey(workspace: LocalWorkspace): string {
    return `${workspace.id}:${workspace.path}`
  }

  function syncLoadedPluginPiSnapshot(workspace: LocalWorkspace, manager: { inspectLoadedPiSnapshot(): CliPluginPiSnapshot }): void {
    pluginPiSnapshots.set(pluginRuntimeKey(workspace), manager.inspectLoadedPiSnapshot())
  }

  function getOrCreatePluginRuntime(workspace: LocalWorkspace) {
    runtimeHost.activateWorkspace(workspace.id)
    const key = pluginRuntimeKey(workspace)
    let runtime = pluginRuntimes.get(key)
    if (!runtime) {
      const manager = pluginDiscovery.createCliPluginAssetManager(workspace.path, {
        frontTargetResolver: runtimeHost.createFrontTargetResolver(workspace.id),
        includeFolderModeAutomation: true,
      })
      const backendRegistry = new workspaceServer.RuntimeBackendRegistry()
      runtime = {
        manager,
        backendRegistry,
        ensureLoaded: manager.load().then(async () => {
          syncLoadedPluginPiSnapshot(workspace, manager)
          await backendRegistry.reloadFromLoadedPlugins(manager.inspectLoaded())
          // Fire-and-forget: pre-transform the loaded plugins' front entries
          // (and their react/@hachej/boring-workspace singletons) so the first
          // browser request hits a warm Vite transform cache instead of paying
          // ~4s of cold compilation that starves the event loop and delays
          // /state, /tree, etc. Never block binding creation; swallow errors.
          void Promise.resolve()
            .then(() => runtimeHost.warmupWorkspace(workspace.id))
            .catch(() => undefined)
        }),
      }
      pluginRuntimes.set(key, runtime)
    }
    return runtime
  }

  async function getLoadedPluginRuntime(workspace: LocalWorkspace) {
    const runtime = getOrCreatePluginRuntime(workspace)
    await runtime.ensureLoaded
    return runtime
  }

  function getLoadedPluginPiSnapshot(workspace: LocalWorkspace) {
    return pluginPiSnapshots.get(pluginRuntimeKey(workspace)) ?? {
      additionalSkillPaths: [],
      packages: [],
      extensionPaths: [],
    }
  }

  async function disposeWorkspaceRuntime(workspace: LocalWorkspace): Promise<void> {
    for (const close of workspaceEventClosers.get(workspace.id) ?? []) {
      try { close() } catch {}
    }
    workspaceEventClosers.delete(workspace.id)
    const runtimeKey = pluginRuntimeKey(workspace)
    const runtime = pluginRuntimes.get(runtimeKey)
    if (runtime) {
      try { await runtime.backendRegistry.close() } catch {}
    }
    pluginRuntimes.delete(runtimeKey)
    pluginPiSnapshots.delete(runtimeKey)
    runtimeProvisioningByWorkspace.delete(workspace.id)
    automationStores.delete(runtimeKey)
    workspaceBridgeCores.delete(workspace.id)
    bridges.delete(workspace.id)
    diagnosticsStore.disposeWorkspace(workspace.id)
    await runtimeHost.disposeWorkspace(workspace.id)
  }

  function reloadDiagnostics(scan: Awaited<ReturnType<InstanceType<typeof workspaceServer.BoringPluginAssetManager>["load"]>>) {
    return scan.errors.map((error) => ({
      source: "workspaces-plugin-manager",
      message: error.message,
      pluginId: error.id,
    }))
  }

  app.get("/api/v1/local-workspaces", async () => ({
    workspaces: await registry.list(),
  }))
  app.post("/api/v1/local-workspaces", async (request, reply) => {
    const body = request.body as { path?: unknown; name?: unknown; createIfMissing?: unknown }
    if (typeof body?.path !== "string" || !body.path.trim()) {
      return reply.code(400).send({ error: "workspace path is required" })
    }
    try {
      const workspace = await registry.add(body.path, {
        name: typeof body.name === "string" ? body.name : undefined,
        createIfMissing: body.createIfMissing === true,
      })
      return { workspace }
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "unable to add workspace",
      })
    }
  })
  app.delete("/api/v1/local-workspaces/:id", async (request, reply) => {
    const { id } = request.params as { id: string }
    const workspace = await registry.get(id)
    await registry.remove(id)
    if (workspace) await disposeWorkspaceRuntime(workspace)
    return reply.send({ ok: true })
  })

  await registerWorkspacePluginConfigRoutes(app, registry)
  await registerWorkspaceTaskRoutes(app, registry)

  app.get("/api/v1/workspaces", async () => ({
    workspaces: (await registry.list()).map(toCoreWorkspace),
  }))
  app.get("/api/v1/workspaces/:id", async (request, reply) => {
    const { id } = request.params as { id: string }
    const workspace = await registry.get(id)
    if (!workspace) return reply.code(404).send({ error: "workspace not found" })
    return { workspace: toCoreWorkspace(workspace), role: "owner" }
  })

  const taskSessionTrustedPluginContext = {
    actorResolver: async (request: Parameters<NonNullable<WorkspaceAgentServerPluginContext["trusted"]>["actorResolver"]>[0]) => ({
      workspaceId: (await workspaceFromRequest(request)).id,
      userId: "local",
    }),
    actorVerifier: async (actor: { workspaceId: string; userId: string }) => (
      actor.userId === "local" && Boolean(await registry.get(actor.workspaceId))
    ),
    workspaceAgentDispatcherResolver: {
      resolve: async (actor, resolveOptions) => {
        if (!workspaceAgentDispatcher) throw new Error("workspace agent dispatcher is not ready")
        return await workspaceAgentDispatcher.resolve(actor, resolveOptions)
      },
      resolveWithWorkspace: async (actor, resolveOptions) => {
        if (!workspaceAgentDispatcher?.resolveWithWorkspace) throw new Error("workspace agent workspace resolver is not ready")
        return await workspaceAgentDispatcher.resolveWithWorkspace(actor, resolveOptions)
      },
      authorizeSession: async (actor, sessionId, resolveOptions) => {
        if (!workspaceAgentDispatcher?.authorizeSession) throw new Error("workspace agent session authorizer is not ready")
        await workspaceAgentDispatcher.authorizeSession(actor, sessionId, resolveOptions)
      },
    } satisfies WorkspaceAgentDispatcherResolver,
  } satisfies NonNullable<WorkspaceAgentServerPluginContext["trusted"]>
  await app.register(agentServer.registerAgentRoutes, {
    mode: opts.mode,
    runtimeModeAdapter: sandboxRuntimeAdapter,
    runtimeHost: sandboxRuntimeHost,
    trustedDirectLocalNativeSessions: true,
    systemPromptAppend: workspaceAppServer.buildWorkspaceContextPrompt(),
    getSystemPromptDynamic: async ({ workspaceId }) => {
      const workspace = await requireWorkspace(workspaceId)
      await getLoadedPluginRuntime(workspace)
      return getLoadedPluginPiSnapshot(workspace).systemPromptAppend
    },
    getWorkspaceId: async (request) => (await workspaceFromRequest(request)).id,
    getWorkspaceRoot: async (workspaceId) => (await requireWorkspace(workspaceId)).path,
    // Intentionally NOT namespaced by workspace id. Returning undefined makes the
    // session store fall back to defaultSessionDir(workspaceRoot), whose cwd-encoding
    // is byte-identical to pi-coding-agent's getDefaultSessionDirPath. So CLI-mode
    // sessions land in the exact ~/.pi/agent/sessions/--<path>-- folder a standalone
    // `pi` run in the same workspace uses, and the two share one session list both
    // ways. Trade-off: sessions are keyed by filesystem path, not registry id — moving
    // a workspace orphans its old sessions (acceptable; unification is the goal).
    getSessionNamespace: async () => undefined,
    provisionRuntime: async ({ workspaceId, workspaceRoot, runtimeMode, runtimeLayout, provisioningAdapter }) => {
      if (runtimeProvisioningByWorkspace.has(workspaceId)) {
        return runtimeProvisioningByWorkspace.get(workspaceId)
      }
      const provisioned = await provisionCliWorkspaceRuntime({
        workspaceRoot,
        mode: runtimeMode,
        provisionWorkspace: opts.provisionWorkspace,
        adapter: provisioningAdapter,
        runtimeLayout,
        plugins: workspaceAppServer.readWorkspacePluginPackageRuntimePlugins(pluginDiscovery.resolveCliBoringPluginDirs(workspaceRoot)),
      })
      runtimeProvisioningByWorkspace.set(workspaceId, provisioned)
      return provisioned
    },
    beforeReload: async ({ workspaceId }) => {
      const workspace = await requireWorkspace(workspaceId)
      const runtime = await getLoadedPluginRuntime(workspace)
      // Re-resolve discovery roots before rescanning: package sources in
      // .pi/settings.json can gain entries after boot (boring-ui-plugin
      // install), but the manager's dirs were resolved once when this
      // workspace runtime was created. Without this, newly installed plugin
      // sources stay invisible until a full process restart.
      runtime.manager.setPluginDirs(pluginDiscovery.resolveCliBoringPluginDirs(workspace.path, { includeFolderModeAutomation: true }))
      const scan = await runtime.manager.load()
      syncLoadedPluginPiSnapshot(workspace, runtime.manager)
      syncRuntimeHostFromPluginEvents(runtimeHost, workspaceId, scan.events)
      const backendReload = await runtime.backendRegistry.reloadFromLoadedPlugins(runtime.manager.inspectLoaded())
      return {
        restart_warnings: workspaceServer.collectRestartWarnings(scan.events),
        diagnostics: [
          ...reloadDiagnostics(scan),
          ...backendReload.diagnostics.map((diagnostic) => ({
            source: diagnostic.source,
            message: diagnostic.message,
            ...(diagnostic.pluginId ? { pluginId: diagnostic.pluginId } : {}),
          })),
        ],
      }
    },
    getPluginDiagnostics: async ({ workspaceId }) => {
      const workspace = await requireWorkspace(workspaceId)
      const runtime = await getLoadedPluginRuntime(workspace)
      return [
        ...runtime.manager.getErrors().map((error) => ({
          source: "plugin-load",
          message: error.message,
          ...(error.id ? { pluginId: error.id } : {}),
        })),
        ...runtime.manager.preflight().errors.map((error) => ({
          source: "plugin-preflight",
          message: `${error.code}: ${error.message} (${error.pluginDir})`,
          ...(error.pluginId ? { pluginId: error.pluginId } : {}),
        })),
        // Browser-reported front import failures: the server scan/transform is
        // green, so without these a plugin that never renders looks healthy to
        // the agent. The plugin_diagnostics tool consumes this array.
        ...diagnosticsStore.frontErrors(workspace.id).map((error) => ({
          source: "plugin-front",
          message: error.message,
          pluginId: error.pluginId,
        })),
      ]
    },
    getPi: async ({ workspaceId, workspaceRoot }) => {
      const workspace = await requireWorkspace(workspaceId)
      await getLoadedPluginRuntime(workspace)
      return {
        // Same policy as folder mode: the local hub runs on the user's own
        // machine, so ambient skill discovery is on (library default is off).
        noSkills: false,
        additionalSkillPaths: [join(workspaceRoot, ".agents", "skills")],
        packages: [],
        extensionPaths: [],
        getHotReloadableResources: () => getLoadedPluginPiSnapshot(workspace),
      }
    },
    onWorkspaceAgentDispatcher: (resolver) => {
      workspaceAgentDispatcher = resolver
    },
    getExtraTools: async ({ workspaceId, workspaceRoot, workspaceFsCapability }) => [
      ...workspaceServer.createWorkspaceUiTools(getBridge(workspaceId), {
        workspaceRoot: workspaceFsCapability === "strong" ? workspaceRoot : undefined,
      }),
      ...(await getWorkspaceBridgeCore(await requireWorkspace(workspaceId))).extraTools,
      automationTool(),
    ],
  })

  await automationRoutes(app, {
    store: new FileAutomationStore(join(process.cwd(), ".pi", "automation-unused")),
    storeForRequest: async (request) => automationStore(await workspaceFromRequest(request)),
    manualRunExecutorForRequest: automationExecutorForRequest,
    dueRunServiceForRequest: async (request) => {
      const workspace = await workspaceFromRequest(request)
      return new DueRunService({
        store: automationStore(workspace),
        executor: await automationExecutorForRequest(request),
      })
    },
  })

  const tasksServer = await import("@hachej/boring-tasks/server")
  tasksServer.registerTaskSessionLinkRoutes(app, taskSessionTrustedPluginContext)

  await app.register(workspaceServer.uiRoutes, {
    getWorkspaceId: async (request) => (await workspaceFromRequest(request)).id,
    getBridge: async (request) => getBridge((await workspaceFromRequest(request)).id),
    getPreserveStateKeys: async (request) => (await getWorkspaceBridgeCore(await workspaceFromRequest(request))).preservedUiStateKeys,
  })

  await app.register(workspaceServer.workspaceBridgeHttpRoutes, {
    getRegistry: async (request) => (await getWorkspaceBridgeCore(await workspaceFromRequest(request))).registry,
    getOwnerWorkspaceId: async (request) => (await workspaceFromRequest(request)).id,
    getIdempotencyStore: async (request) => (await getWorkspaceBridgeCore(await workspaceFromRequest(request))).idempotencyStore,
    browserAuthPolicy: {
      resolve(input) {
        return workspaceServer.createLocalCliBridgeAuthPolicy({ workspaceId: input.workspaceId }).resolve(input)
      },
    },
  })

  app.get("/api/v1/runtime-plugin-diagnostics", async (request) => {
    const workspace = await workspaceFromRequest(request)
    const runtime = await getLoadedPluginRuntime(workspace)
    return buildRuntimePluginDiagnosticsResponse({
      workspaceId: workspace.id,
      loaded: runtime.manager.inspectLoaded(),
      errors: runtime.manager.getErrors(),
      host: diagnosticsStore.snapshot(workspace.id),
      frontErrors: diagnosticsStore.frontErrors(workspace.id),
    })
  })

  app.post("/api/v1/agent-plugins/:id/front-error", async (request, reply) => {
    const workspace = await workspaceFromRequest(request)
    const { id } = request.params as { id: string }
    const report = parseFrontErrorReport(id, request.body)
    if (!report) return reply.code(400).send({ error: "invalid_front_error_report" })
    diagnosticsStore.recordFrontError(workspace.id, report)
    return reply.code(204).send()
  })

  app.get("/api/v1/agent-plugins", async (request) => {
    const workspace = await workspaceFromRequest(request)
    const runtime = await getLoadedPluginRuntime(workspace)
    return runtime.manager.list()
  })
  app.get("/api/v1/agent-plugins/:id/error", async (request, reply) => {
    const workspace = await workspaceFromRequest(request)
    const runtime = await getLoadedPluginRuntime(workspace)
    const { id } = request.params as { id: string }
    const error = runtime.manager.getError(id)
    if (error == null) return reply.code(404).send({ error: "not_found" })
    return reply.type("text/plain").send(error)
  })
  app.get("/api/v1/agent-plugins/events", async (request, reply) => {
    const workspace = await workspaceFromRequest(request)
    const runtime = await getLoadedPluginRuntime(workspace)
    const manager = runtime.manager

    reply.hijack()
    const res = reply.raw
    res.statusCode = 200
    res.setHeader("Content-Type", "text/event-stream")
    res.setHeader("Cache-Control", "no-cache, no-transform")
    res.setHeader("Connection", "keep-alive")
    res.setHeader("X-Accel-Buffering", "no")
    res.flushHeaders?.()

    const write = (eventName: string, payload: Record<string, unknown>) => {
      try {
        res.write(`event: ${eventName}\n`)
        res.write(`data: ${JSON.stringify(payload)}\n\n`)
      } catch {
        // client gone
      }
    }

    const liveQueue: Array<{ eventName: string; payload: Record<string, unknown> }> = []
    let replaying = true
    const unsubscribe = manager.subscribe((event) => {
      if (event.type === "boring.plugin.unload" || (event.type === "boring.plugin.load" && !event.frontTarget)) {
        runtimeHost.untrackPlugin(workspace.id, event.id)
      }
      const payload = {
        ...event,
        workspaceId: workspace.id,
        replay: false,
      }
      if (replaying) {
        liveQueue.push({ eventName: event.type, payload })
        return
      }
      write(event.type, payload)
    })

    for (const plugin of manager.listExternal()) {
      write("boring.plugin.load", {
        type: "boring.plugin.load",
        id: plugin.id,
        boring: plugin.boring,
        version: plugin.version,
        revision: plugin.revision,
        ...(plugin.frontTarget ? { frontTarget: plugin.frontTarget } : {}),
        workspaceId: workspace.id,
        replay: true,
      })
    }
    write("boring.plugin.replay-complete", {
      type: "boring.plugin.replay-complete",
      workspaceId: workspace.id,
      replay: true,
    })
    replaying = false
    for (const event of liveQueue) write(event.eventName, event.payload)

    const heartbeat = setInterval(() => {
      try { res.write(": heartbeat\n\n") } catch { /* ignore */ }
    }, 25_000)
    const closeStream = () => {
      clearInterval(heartbeat)
      unsubscribe()
      workspaceEventClosers.get(workspace.id)?.delete(closeStream)
      try { res.end() } catch {}
    }
    const closers = workspaceEventClosers.get(workspace.id) ?? new Set<() => void>()
    closers.add(closeStream)
    workspaceEventClosers.set(workspace.id, closers)
    request.raw.on("close", closeStream)
  })

  app.get("/api/v1/workspace/meta", async () => ({
    projectName: "Boring UI",
    workspacesMode: true,
    version: CLI_VERSION,
    runtimePluginFrontLoadingEnabled: true,
    runtimePluginTrustLabel: RUNTIME_PLUGIN_TRUST_LABEL,
    runtimePluginTrustDescription: RUNTIME_PLUGIN_TRUST_DESCRIPTION,
    runtimePluginDiagnosticsEnabled: true,
  }))

  // Pre-warm plugin runtimes so a freshly-restarted hub doesn't pay cold
  // plugin loads + Vite singleton transforms on the first browser request
  // (several seconds of event-loop saturation that delays /state, tree, and
  // commands). Priority: the most-recently-used workspace — the one the hub
  // opens by default and the one a user hard-refreshes after a restart —
  // warms immediately; the remaining workspaces warm afterwards in the
  // background. Serial and best-effort: a failing workspace must not block
  // the others, and a real browser request never waits on this queue — the
  // lazy path creates (or reuses the in-flight) runtime for its workspace
  // directly.
  void (async () => {
    await new Promise((resolve) => setTimeout(resolve, 250))
    try {
      const byRecency = [...await registry.list()]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      for (const workspace of byRecency) {
        if (!workspace.available) continue
        try {
          await getLoadedPluginRuntime(workspace)
        } catch (error) {
          app.log.warn({ err: error, workspaceId: workspace.id }, "[cli] workspace plugin prewarm failed")
        }
      }
    } catch (error) {
      app.log.warn({ err: error }, "[cli] workspace plugin prewarm skipped")
    }
  })()

  return app
}
