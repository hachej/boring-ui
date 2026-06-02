import type { FastifyInstance } from "fastify"
import type {
  BoringAgentRuntimePaths,
  ProvisionWorkspaceRuntimeOptions,
  RuntimeModeAdapter,
  RuntimeModeId,
  WorkspaceProvisioningAdapter,
  WorkspaceProvisioningResult,
} from "@hachej/boring-agent/server"
import { execSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { createLocalWorkspaceRegistry, type LocalWorkspace } from "./localWorkspaces.js"
import type {
  RuntimePluginDiagnosticsResponse,
  RuntimePluginHostSnapshot,
  RuntimePluginServerSnapshotEntry,
} from "../shared/runtimePluginDiagnostics.js"
import {
  createCliPluginAssetManager,
  getGlobalPiExtensionsRoot,
  readCliPluginPiSnapshot,
  resolveCliBoringPluginDirs,
} from "./pluginDiscovery.js"

export interface RunCliOptions {
  argv?: string[]
  publicDir: string
}

const MODE_MAP = {
  "local": "direct", // no sandbox, full network access
  "local-sandbox": "local", // bwrap isolated, no network (Linux only)
} as const

type CliMode = keyof typeof MODE_MAP
type RuntimeMode = typeof MODE_MAP[CliMode]

const require = createRequire(import.meta.url)
const CLI_PACKAGE_NAME = "@hachej/boring-ui-cli"

const CLI_VERSION = (() => {
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

function openBrowser(url: string) {
  try {
    const opener =
      process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open"
    execSync(`${opener} ${url}`, { stdio: "ignore" })
  } catch {}
}

export function resolveBoringUiCliPackageRoot(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  return resolve(__dirname, "..", "..")
}

export function createBoringUiCliRuntimePlugin(
  packageRoot = resolveBoringUiCliPackageRoot(),
): ProvisionWorkspaceRuntimeOptions["plugins"][number] {
  return {
    id: "boring-ui-cli-runtime",
    provisioning: {
      nodePackages: [{
        id: "boring-ui-cli",
        packageName: CLI_PACKAGE_NAME,
        packageRoot,
        version: CLI_VERSION,
        expectedBins: ["boring-ui"],
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
  modeAdapter?: Pick<RuntimeModeAdapter, "createProvisioningAdapter">
  runtimeLayout?: BoringAgentRuntimePaths
}): Promise<WorkspaceProvisioningResult | undefined> {
  if (opts.provisionWorkspace === false) return undefined
  const agent = await import("@hachej/boring-agent/server")
  const runtimeLayout = opts.runtimeLayout ?? agent.getBoringAgentRuntimePaths(opts.workspaceRoot)
  const adapter = opts.adapter
    ?? opts.modeAdapter?.createProvisioningAdapter?.(runtimeLayout)
    ?? agent.resolveMode(opts.mode).createProvisioningAdapter?.(runtimeLayout)
  if (!adapter) {
    throw new Error(`runtime mode ${opts.mode} does not support workspace provisioning`)
  }
  const result = await agent.provisionWorkspaceRuntime({
    plugins: [createBoringUiCliRuntimePlugin(), ...(opts.plugins ?? [])],
    adapter,
    runtimeLayout,
  })
  return {
    ...result,
    env: {
      ...result.env,
      BORING_AGENT_WORKSPACE_LOCAL_PLUGIN_ROOTS: opts.mode === "direct" || opts.mode === "local" ? "1" : "0",
    },
  }
}

function ensureFrontendBuilt(publicDir: string) {
  if (existsSync(join(publicDir, "index.html"))) return
  console.error("\nError: boring-ui frontend not found.")
  console.error("Run `pnpm build:full` in packages/cli to build it first.\n")
  process.exit(1)
}

export async function registerStatic(app: FastifyInstance, publicDir: string) {
  ensureFrontendBuilt(publicDir)
  const { default: fastifyStatic } = await import("@fastify/static")
  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: "/",
  })

  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith("/api/")) {
      return reply.code(404).send({ error: "Not found" })
    }
    return reply.sendFile("index.html", publicDir)
  })
}

const HELP_TEXT = [
  "Usage: boring-ui [workspace] [options]",
  "",
  "Commands:",
  "  boring-ui [workspace]                 Start the workspace UI for a folder",
  "  boring-ui workspaces <subcommand>     Manage saved local workspaces",
  "  boring-ui scaffold-plugin <name> [workspace]",
  "                                       Scaffold a hot-reloadable plugin",
  "  boring-ui verify-plugin [name] [workspace]",
  "                                       Validate plugin manifests/files",
  "",
  "Options:",
  "  -p, --port <port>       HTTP port (default: 5200)",
  "      --host <host>       Listen host (default: 0.0.0.0)",
  "  -m, --mode <mode>       local-sandbox or local (default: local)",
  "  -h, --help              Show this help",
].join("\n")

const AUTH_GUIDE = [
  "",
  "  ⚠  No LLM provider configured.",
  "",
  "  In another terminal, launch pi and run /login to set up an API key or",
  "  sign in to a subscription (Claude Pro/Max, ChatGPT Plus, Copilot):",
  "",
  "       pi                                    # if installed globally",
  "       npx @earendil-works/pi-coding-agent  # otherwise",
  "",
  "  Then at pi's prompt:  /login",
  "",
  "  Credentials are saved at ~/.pi/agent/auth.json. Then refresh the browser.",
  "",
].join("\n")

async function checkAuth(): Promise<number> {
  // Keep pi-coding-agent out of the CLI's top-level module graph so
  // lightweight subcommands (`scaffold-plugin`, `verify-plugin`) still run
  // from the workspace-local provisioned CLI copy, which intentionally does
  // not materialize the whole dependency tree.
  const { AuthStorage, ModelRegistry } = await import("@mariozechner/pi-coding-agent")
  const authStorage = AuthStorage.create()
  const registry = ModelRegistry.create(authStorage)
  return registry.getAvailable().length
}

const FOLDER_RUNTIME_PLUGIN_WORKSPACE_ID = "folder"
const RUNTIME_PLUGIN_TRUST_LABEL = "Trusted local runtime plugins"
const RUNTIME_PLUGIN_TRUST_DESCRIPTION = "Loads plugin UI code from trusted local Pi extension roots through the CLI-owned runtime module host."

function createRuntimePluginDiagnosticsStore() {
  const byWorkspace = new Map<string, Map<string, RuntimePluginHostSnapshot>>()

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
    disposeWorkspace(workspaceId: string) {
      byWorkspace.delete(workspaceId)
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
  return {
    workspaceId: args.workspaceId,
    plugins: [...byPlugin.values()].sort((a, b) => a.id.localeCompare(b.id)),
  }
}

export async function createFolderModeApp(opts: {
  workspaceRoot: string
  mode: RuntimeMode
  projectName?: string
  provisionWorkspace?: boolean
}): Promise<FastifyInstance> {
  const workspaceRoot = resolve(opts.workspaceRoot)
  const projectName = opts.projectName ?? (basename(workspaceRoot) || "workspace")
  const [{ createWorkspaceAgentServer, readWorkspacePluginPackageRuntimePlugins }, { createPluginFrontRuntimeHost }] = await Promise.all([
    import("@hachej/boring-workspace/app/server"),
    import("./pluginFrontRuntime.js"),
  ])
  const diagnosticsStore = createRuntimePluginDiagnosticsStore()
  const runtimeHost = await createPluginFrontRuntimeHost({
    onDiagnostic: (diagnostic) => diagnosticsStore.record(diagnostic),
  })
  const runtimeProvisioning = await provisionCliWorkspaceRuntime({
    workspaceRoot,
    mode: opts.mode,
    provisionWorkspace: opts.provisionWorkspace,
    plugins: readWorkspacePluginPackageRuntimePlugins(resolveCliBoringPluginDirs(workspaceRoot)),
  })
  const app = await createWorkspaceAgentServer({
    workspaceRoot,
    mode: opts.mode,
    logger: false,
    provisionWorkspace: false,
    runtimeProvisioning,
    additionalBoringPluginDirs: [getGlobalPiExtensionsRoot()],
    boringPluginFrontTargetResolver: runtimeHost.createFrontTargetResolver(FOLDER_RUNTIME_PLUGIN_WORKSPACE_ID),
    boringPluginIncludeLegacyFrontUrl: false,
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
    })
  })

  app.get("/api/v1/workspace/meta", async () => ({
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

async function startFolderMode(opts: {
  folderArg?: string
  publicDir: string
  port: number
  host: string
  cliMode: CliMode
  mode: RuntimeMode
}) {
  const workspaceRoot = process.env.BORING_AGENT_WORKSPACE_ROOT ?? resolve(opts.folderArg ?? process.cwd())
  const projectName = basename(resolve(workspaceRoot)) || "workspace"
  const modelCount = await checkAuth()

  const url = `http://localhost:${opts.port}`
  console.log(`\n${projectName}`)
  console.log(`  workspace  ${workspaceRoot}`)
  console.log(`  mode       ${opts.cliMode}`)
  console.log(`  port       ${opts.port}`)
  console.log(`  host       ${opts.host}`)
  if (modelCount === 0) console.log(AUTH_GUIDE)
  console.log(`\n  starting ${url} …`)

  const app = await createFolderModeApp({
    workspaceRoot,
    mode: opts.mode,
    projectName,
  })

  await registerStatic(app as FastifyInstance, opts.publicDir)
  await app.listen({ port: opts.port, host: opts.host })
  console.log(`  ${url}  ready\n`)
  openBrowser(url)
}

export async function createWorkspacesModeApp(opts: {
  mode: RuntimeMode
  registryPath?: string
  provisionWorkspace?: boolean
}): Promise<FastifyInstance> {
  const [workspaceAppServer, workspaceServer, agentServer, fastifyModule, { createPluginFrontRuntimeHost }] = await Promise.all([
    import("@hachej/boring-workspace/app/server"),
    import("@hachej/boring-workspace/server"),
    import("@hachej/boring-agent/server"),
    import("fastify"),
    import("./pluginFrontRuntime.js"),
  ])
  const registry = createLocalWorkspaceRegistry(opts.registryPath)
  const app = fastifyModule.default({ logger: false, bodyLimit: 16 * 1024 * 1024 })
  const diagnosticsStore = createRuntimePluginDiagnosticsStore()
  const runtimeHost = await createPluginFrontRuntimeHost({
    onDiagnostic: (diagnostic) => diagnosticsStore.record(diagnostic),
  })
  await runtimeHost.registerRoutes(app)
  const bridges = new Map<string, ReturnType<typeof workspaceServer.createInMemoryBridge>>()
  const workspaceEventClosers = new Map<string, Set<() => void>>()
  const pluginRuntimes = new Map<string, {
    manager: InstanceType<typeof workspaceServer.BoringPluginAssetManager>
    ensureLoaded: Promise<void>
  }>()
  const pluginPiSnapshots = new Map<string, ReturnType<typeof readCliPluginPiSnapshot>>()
  const runtimeProvisioningByWorkspace = new Map<string, WorkspaceProvisioningResult | undefined>()

  function getBridge(workspaceId: string) {
    let bridge = bridges.get(workspaceId)
    if (!bridge) {
      bridge = workspaceServer.createInMemoryBridge()
      bridges.set(workspaceId, bridge)
    }
    return bridge
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

  function pluginRuntimeKey(workspace: LocalWorkspace): string {
    return `${workspace.id}:${workspace.path}`
  }

  function syncLoadedPluginPiSnapshot(workspace: LocalWorkspace, manager: { inspectLoadedPiSnapshot(): ReturnType<typeof readCliPluginPiSnapshot> }): void {
    pluginPiSnapshots.set(pluginRuntimeKey(workspace), manager.inspectLoadedPiSnapshot())
  }

  function getOrCreatePluginRuntime(workspace: LocalWorkspace) {
    const key = pluginRuntimeKey(workspace)
    let runtime = pluginRuntimes.get(key)
    if (!runtime) {
      const manager = createCliPluginAssetManager(workspace.path, {
        frontTargetResolver: runtimeHost.createFrontTargetResolver(workspace.id),
        includeLegacyFrontUrl: false,
      })
      runtime = {
        manager,
        ensureLoaded: manager.load().then(() => {
          syncLoadedPluginPiSnapshot(workspace, manager)
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
    pluginRuntimes.delete(runtimeKey)
    pluginPiSnapshots.delete(runtimeKey)
    runtimeProvisioningByWorkspace.delete(workspace.id)
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
    const body = request.body as { path?: unknown; name?: unknown }
    if (typeof body?.path !== "string" || !body.path.trim()) {
      return reply.code(400).send({ error: "workspace path is required" })
    }
    try {
      const workspace = await registry.add(body.path, {
        name: typeof body.name === "string" ? body.name : undefined,
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

  app.get("/api/v1/workspaces", async () => ({
    workspaces: (await registry.list()).map(toCoreWorkspace),
  }))
  app.get("/api/v1/workspaces/:id", async (request, reply) => {
    const { id } = request.params as { id: string }
    const workspace = await registry.get(id)
    if (!workspace) return reply.code(404).send({ error: "workspace not found" })
    return { workspace: toCoreWorkspace(workspace), role: "owner" }
  })

  await app.register(agentServer.registerAgentRoutes, {
    mode: opts.mode,
    systemPromptAppend: workspaceAppServer.buildWorkspaceContextPrompt(),
    getSystemPromptDynamic: async ({ workspaceId }) => {
      const workspace = await requireWorkspace(workspaceId)
      await getLoadedPluginRuntime(workspace)
      return getLoadedPluginPiSnapshot(workspace).systemPromptAppend
    },
    getWorkspaceId: async (request) => (await workspaceFromRequest(request)).id,
    getWorkspaceRoot: async (workspaceId) => (await requireWorkspace(workspaceId)).path,
    getSessionNamespace: async ({ workspaceId }) => `local-workspace-${workspaceId}`,
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
        plugins: workspaceAppServer.readWorkspacePluginPackageRuntimePlugins(resolveCliBoringPluginDirs(workspaceRoot)),
      })
      runtimeProvisioningByWorkspace.set(workspaceId, provisioned)
      return provisioned
    },
    beforeReload: async ({ workspaceId }) => {
      const workspace = await requireWorkspace(workspaceId)
      const runtime = await getLoadedPluginRuntime(workspace)
      const scan = await runtime.manager.load()
      syncLoadedPluginPiSnapshot(workspace, runtime.manager)
      syncRuntimeHostFromPluginEvents(runtimeHost, workspaceId, scan.events)
      return {
        restart_warnings: workspaceServer.collectRestartWarnings(scan.events),
        diagnostics: reloadDiagnostics(scan),
      }
    },
    getPi: async ({ workspaceId, workspaceRoot }) => {
      const workspace = await requireWorkspace(workspaceId)
      await getLoadedPluginRuntime(workspace)
      return {
        additionalSkillPaths: [join(workspaceRoot, ".agents", "skills")],
        packages: [],
        extensionPaths: [],
        getHotReloadableResources: () => getLoadedPluginPiSnapshot(workspace),
      }
    },
    getExtraTools: async ({ workspaceId, workspaceRoot, workspaceFsCapability }) => [
      ...workspaceServer.createWorkspaceUiTools(getBridge(workspaceId), {
        workspaceRoot: workspaceFsCapability === "strong" ? workspaceRoot : undefined,
      }),
    ],
  })

  await app.register(workspaceServer.uiRoutes, {
    getBridge: async (request) => getBridge((await workspaceFromRequest(request)).id),
  })

  app.get("/api/v1/runtime-plugin-diagnostics", async (request) => {
    const workspace = await workspaceFromRequest(request)
    const runtime = await getLoadedPluginRuntime(workspace)
    return buildRuntimePluginDiagnosticsResponse({
      workspaceId: workspace.id,
      loaded: runtime.manager.inspectLoaded(),
      errors: runtime.manager.getErrors(),
      host: diagnosticsStore.snapshot(workspace.id),
    })
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

    for (const plugin of manager.list()) {
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

  return app
}

async function startWorkspacesMode(opts: {
  publicDir: string
  port: number
  host: string
  cliMode: CliMode
  mode: RuntimeMode
}) {
  const app = await createWorkspacesModeApp({ mode: opts.mode })
  const registry = createLocalWorkspaceRegistry()

  await registerStatic(app, opts.publicDir)
  await app.listen({ port: opts.port, host: opts.host })

  const initialWorkspace = (await registry.list()).find((workspace) => workspace.available)
  const initialUrl = initialWorkspace
    ? `http://localhost:${opts.port}/workspace/${encodeURIComponent(initialWorkspace.id)}`
    : `http://localhost:${opts.port}`

  console.log(`  workspaces ${registry.path}`)
  console.log(`  ${initialUrl}  ready\n`)
  if ((await checkAuth()) === 0) console.log(AUTH_GUIDE)
  openBrowser(initialUrl)
}

function findRepoRoot(from: string): string | null {
  let current = from
  while (true) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

// Recursively walk a directory and return relative paths to files
function walkDir(dir: string, base: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist") continue
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      walkDir(fullPath, base, out)
      continue
    }
    out.push(relative(base, fullPath))
  }
  return out
}

function replaceInFile(filePath: string, replacements: Record<string, string>) {
  let content = readFileSync(filePath, "utf8")
  for (const [from, to] of Object.entries(replacements)) {
    content = content.replaceAll(from, to)
  }
  writeFileSync(filePath, content, "utf8")
}

async function handlePluginCommand(opts: {
  positionals: string[]
  args: { path?: string }
}) {
  const subcommand = opts.positionals[1]
  if (subcommand !== "create") {
    console.log("Usage: boring-ui plugin create <name> [--path <dir>]")
    console.log("")
    console.log("Scaffold a new plugin from the template.")
    console.log("")
    console.log("Arguments:")
    console.log("  <name>        Plugin name (e.g. my-plugin)")
    console.log("  --path        Parent directory for the new plugin (default: plugins/)")
    return
  }

  const name = opts.positionals[2]
  if (!name) throw new Error("usage: boring-ui plugin create <name>")

  const __dirname = dirname(fileURLToPath(import.meta.url))
  const packageRoot = resolve(__dirname, "..", "..")
  const templateDir = join(packageRoot, "templates", "plugin")
  if (!existsSync(templateDir)) {
    throw new Error(
      `Plugin template not found at ${templateDir}.\n` +
      "This build may not include the plugin template.",
    )
  }

  const repoRoot = findRepoRoot(process.cwd())
  const customPath = opts.args.path
  const targetParent = customPath ? resolve(customPath) : join(repoRoot ?? process.cwd(), "plugins")
  const targetDir = join(targetParent, name)

  if (existsSync(targetDir)) {
    throw new Error(`Directory already exists: ${targetDir}`)
  }

  const id = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "")
  if (!id) throw new Error(`invalid plugin name: ${name}`)
  const symbolBase = id.replace(/-plugin$/, "") || id
  const pascalBase = symbolBase
    .split(/[-_]+/)
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join("")
  const camelBase = pascalBase.charAt(0).toLowerCase() + pascalBase.slice(1)
  const upperBase = symbolBase.replace(/-/g, "_").toUpperCase()

  console.log(`Scaffolding plugin "${id}" at ${targetDir}`)

  // Copy template (excluding node_modules)
  mkdirSync(targetParent, { recursive: true })
  cpSync(templateDir, targetDir, { recursive: true })

  // Walk and rename template identifiers/ids in all files.
  const files = walkDir(targetDir, targetDir)
  const pkgName = `@hachej/boring-${id}`
  for (const file of files) {
    const fullPath = join(targetDir, file)
    replaceInFile(fullPath, {
      "@hachej/boring-plugin-template": pkgName,
      "sample-plugin": id,
      "sample-panel": `${id}-panel`,
      "sample.open": `${id}.open`,
      "sample:": `${id}:`,
      '"sample"': `"${id}"`,
      "SAMPLE": upperBase,
      "Sample": pascalBase,
      "sampleSurfaceResolver": `${camelBase}SurfaceResolver`,
      "samplePanel": `${camelBase}Panel`,
    })

    if (file.includes("samplePlugin")) {
      const newFile = file.replace(/samplePlugin/g, `${camelBase}Plugin`)
      const oldPath = join(targetDir, file)
      const newPath = join(targetDir, newFile)
      if (oldPath !== newPath) {
        mkdirSync(dirname(newPath), { recursive: true })
        renameSync(oldPath, newPath)
      }
    }
  }

  console.log("")
  console.log(`✓ Created plugin \`${id}\` at ${relative(process.cwd(), targetDir)}`)
  console.log("")
  console.log("Next steps:")
  console.log(`  cd ${relative(process.cwd(), targetDir)}`)
  console.log("  pnpm install")
  console.log(`  pnpm --filter ${pkgName} typecheck`)
  console.log(`  pnpm --filter ${pkgName} test`)
}

async function handleWorkspacesCommand(opts: {
  args: { name?: string }
  positionals: string[]
  publicDir: string
  port: number
  host: string
  cliMode: CliMode
  mode: RuntimeMode
}) {
  const registry = createLocalWorkspaceRegistry()
  const subcommand = opts.positionals[1]
  if (subcommand === "add") {
    const target = opts.positionals[2]
    if (!target) throw new Error("usage: boring-ui workspaces add <folder>")
    const workspace = await registry.add(target, { name: opts.args.name })
    console.log(`${workspace.name}\n  id    ${workspace.id}\n  path  ${workspace.path}`)
    return
  }
  if (subcommand === "list") {
    const workspaces = await registry.list()
    if (workspaces.length === 0) {
      console.log("No workspaces. Add one with `boring-ui workspaces add <folder>`.")
      return
    }
    for (const workspace of workspaces) {
      console.log(`${workspace.available ? "✓" : "!"} ${workspace.name}  ${workspace.id}\n  ${workspace.path}`)
    }
    return
  }
  if (subcommand === "remove") {
    const id = opts.positionals[2]
    if (!id) throw new Error("usage: boring-ui workspaces remove <id>")
    await registry.remove(id)
    console.log(`removed ${id}`)
    return
  }
  if (subcommand === "rename") {
    const id = opts.positionals[2]
    const name = opts.positionals.slice(3).join(" ")
    if (!id || !name) throw new Error("usage: boring-ui workspaces rename <id> <name>")
    const workspace = await registry.rename(id, name)
    console.log(`renamed ${workspace.id} -> ${workspace.name}`)
    return
  }
  await startWorkspacesMode(opts)
}

export async function runCli(options: RunCliOptions): Promise<void> {
  const { values: args, positionals } = parseArgs({
    args: options.argv,
    options: {
      port: { type: "string", short: "p" },
      host: { type: "string" },
      mode: { type: "string", short: "m" },
      name: { type: "string", short: "n" },
      path: { type: "string" as const },
      json: { type: "boolean" as const },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: false,
  })

  if (args.help) {
    console.log(HELP_TEXT)
    return
  }

  const port = Number(args.port ?? process.env.PORT) || 5200
  const host = (args.host as string | undefined) ?? process.env.HOST ?? "0.0.0.0"
  const rawMode = (args.mode as string | undefined) ?? process.env.BORING_MODE
  let cliMode: CliMode
  let mode: RuntimeMode
  if (rawMode) {
    if (!(rawMode in MODE_MAP)) {
      throw new Error(`invalid --mode "${rawMode}". Valid options: ${Object.keys(MODE_MAP).join(", ")}`)
    }
    cliMode = rawMode as CliMode
    mode = MODE_MAP[cliMode]
  } else {
    // Default to direct (no sandbox) on every platform — including Linux with
    // bwrap available. Direct mode boots ~instantly (no pack/extract, no
    // sandbox spin-up); bwrap isolation is opt-in via `--mode local-sandbox`,
    // since its per-workspace first-boot provisioning cost should only be paid
    // when the caller explicitly wants the isolation (and accepts the wait).
    cliMode = "local"
    mode = "direct"
  }

  const base = {
    publicDir: options.publicDir,
    port,
    host,
    cliMode,
    mode,
  }

  if (positionals[0] === "plugin") {
    await handlePluginCommand({
      positionals,
      args: { path: args.path as string | undefined },
    })
    return
  }

  if (positionals[0] === "workspaces") {
    await handleWorkspacesCommand({
      ...base,
      args: { name: args.name as string | undefined },
      positionals,
    })
    return
  }

  if (positionals[0] === "plugin-status") {
    handlePluginStatusCommand({ json: args.json === true })
    return
  }

  if (positionals[0] === "scaffold-plugin") {
    await handleScaffoldPluginCommand({ positionals })
    return
  }

  if (positionals[0] === "verify-plugin") {
    await handleVerifyPluginCommand({ positionals })
    return
  }

  await startFolderMode({
    ...base,
    folderArg: positionals[0],
  })
}

function defaultWorkspaceRoot(): string {
  return process.env.BORING_AGENT_WORKSPACE_ROOT ?? process.cwd()
}

function workspaceLocalPluginRootsEnabled(): boolean {
  const raw = process.env.BORING_AGENT_WORKSPACE_LOCAL_PLUGIN_ROOTS
  if (raw == null || raw.trim() === "") return true
  return !["0", "false", "no", "off"].includes(raw.trim().toLowerCase())
}

function buildPluginStatus() {
  const workspaceRoot = resolve(defaultWorkspaceRoot())
  const enabled = workspaceLocalPluginRootsEnabled()
  return {
    workspaceLocalPluginRoots: enabled,
    workspaceRoot,
    extensionsDir: join(workspaceRoot, ".pi", "extensions"),
    reloadSupported: enabled,
    ...(enabled ? {} : {
      reason: "This runtime writes to a remote sandbox; host-side plugin discovery cannot load .pi/extensions from there.",
    }),
  }
}

function handlePluginStatusCommand(opts: { json: boolean }) {
  const status = buildPluginStatus()
  if (opts.json) {
    console.log(JSON.stringify(status, null, 2))
    return
  }
  console.log(status.workspaceLocalPluginRoots
    ? `workspace-local plugin roots enabled: ${status.extensionsDir}`
    : `workspace-local plugin roots disabled: ${status.reason}`)
}

async function handleVerifyPluginCommand(opts: { positionals: string[] }) {
  // Usage: `boring-ui verify-plugin [<name>] [<workspace>]`
  // No name: verify every plugin under .pi/extensions/.
  // With name: verify only `.pi/extensions/<name>/`.
  // Workspace defaults to BORING_AGENT_WORKSPACE_ROOT when invoked
  // through the workspace-local shim, then cwd as a manual fallback.
  // The flag-free positional form keeps the invocation short for the
  // agent's bash tool.
  const maybeName = opts.positionals[1]
  const maybeWorkspace = opts.positionals[2]
  const looksLikePath = maybeName && (maybeName.includes("/") || maybeName.startsWith("."))
  const name = looksLikePath ? undefined : maybeName
  const workspaceRoot = resolve(maybeWorkspace ?? (looksLikePath ? maybeName! : defaultWorkspaceRoot()))

  const { findHintForError, formatVerifyResult, verifyPlugin } = await import("./verifyPlugin.js")
  const result = verifyPlugin({ workspaceRoot, ...(name ? { name } : {}) })
  console.log(formatVerifyResult(result))
  if (!result.ok) {
    // Surface actionable hints for the well-known mistakes so the agent
    // sees a one-line "do this instead" alongside the raw error.
    const hints: string[] = []
    for (const outcome of result.outcomes) {
      for (const err of outcome.errors) {
        const hint = findHintForError(err)
        if (hint) hints.push(`  hint (${outcome.id}): ${hint}`)
      }
    }
    if (hints.length > 0) {
      console.log("")
      console.log("Suggestions:")
      for (const hint of hints) console.log(hint)
    }
    process.exit(1)
  }
}

async function handleScaffoldPluginCommand(opts: { positionals: string[] }) {
  const name = opts.positionals[1]
  if (!name) {
    throw new Error("usage: boring-ui scaffold-plugin <name> [workspace]")
  }
  const status = buildPluginStatus()
  if (!status.workspaceLocalPluginRoots) {
    throw new Error(`${status.reason} Do not scaffold into .pi/extensions in this runtime.`)
  }
  const workspaceRoot = resolve(opts.positionals[2] ?? defaultWorkspaceRoot())
  const { scaffoldPlugin } = await import("./scaffoldPlugin.js")
  const result = scaffoldPlugin({ name, workspaceRoot })
  console.log(`scaffolded ${name}`)
  console.log(`  dir   ${result.pluginDir}`)
  for (const file of result.filesCreated) {
    console.log(`  +     ${file}`)
  }
  console.log("")
  console.log("Next steps:")
  console.log(`  1. edit front/index.tsx for UI panels/commands/resolvers`)
  console.log(`  2. add pi.extensions / skills for hot-reloadable agent behavior`)
  console.log(`  3. bash \`boring-ui verify-plugin\` — confirms manifests + files are valid`)
  console.log(`  4. ask the user: /reload`)
  console.log("")
  console.log("Advanced server integration:")
  console.log("  boring.server is boot-time/static composition only. It is NOT hot-registered")
  console.log("  by /reload for .pi/extensions user plugins; use Pi extensions for agent tools.")
}
