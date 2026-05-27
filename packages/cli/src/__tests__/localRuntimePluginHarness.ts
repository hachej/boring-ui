import { homedir } from "node:os"
import { basename, join, resolve } from "node:path"
import fastify, { type FastifyInstance } from "fastify"
import { createAgentApp } from "../../../agent/src/server/createAgentApp"
import { registerAgentRoutes } from "../../../agent/src/server/registerAgentRoutes"
import {
  BoringPluginAssetManager,
  boringPluginRoutes,
  collectRestartWarnings,
  createInMemoryBridge,
  createWorkspaceUiTools,
  uiRoutes,
} from "../../../workspace/src/server/index"
import type { LoadBoringAssetsResult } from "../../../workspace/src/server/agentPlugins/manager"
import { createPluginFrontRuntimeHost } from "../server/pluginFrontRuntime"
import { createLocalWorkspaceRegistry, type LocalWorkspace } from "../server/localWorkspaces"

const FOLDER_RUNTIME_PLUGIN_WORKSPACE_ID = "folder"
const RUNTIME_PLUGIN_TRUST_LABEL = "Trusted local runtime plugins"
const RUNTIME_PLUGIN_TRUST_DESCRIPTION = "Loads plugin UI code from trusted local Pi extension roots through the CLI-owned runtime module host."

function getGlobalPiExtensionsRoot(): string {
  return resolve(join(homedir(), ".pi", "agent", "extensions"))
}

function resolvePluginDirs(workspaceRoot: string): string[] {
  return [getGlobalPiExtensionsRoot(), resolve(workspaceRoot, ".pi", "extensions")]
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
  if (!workspaceId) throw new Error("workspace id is required")
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

function reloadDiagnostics(scan: LoadBoringAssetsResult) {
  return scan.errors.map((error: { id: string; message: string }) => ({
    source: "workspaces-plugin-manager",
    message: error.message,
    pluginId: error.id,
  }))
}

function syncRuntimeHostFromEvents(runtimeHost: Awaited<ReturnType<typeof createPluginFrontRuntimeHost>>, workspaceId: string, events: Array<{ type: string; id: string; frontTarget?: unknown }>) {
  for (const event of events) {
    if (event.type === "boring.plugin.unload" || (event.type === "boring.plugin.load" && !event.frontTarget)) {
      runtimeHost.untrackPlugin(workspaceId, event.id)
    }
  }
}

export async function createLocalFolderModeApp(opts: {
  workspaceRoot: string
  mode: "direct" | "local" | "vercel-sandbox"
  projectName?: string
}): Promise<FastifyInstance> {
  const workspaceRoot = resolve(opts.workspaceRoot)
  const projectName = opts.projectName ?? (basename(workspaceRoot) || "workspace")
  const runtimeHost = await createPluginFrontRuntimeHost()
  const bridge = createInMemoryBridge()
  const manager = new BoringPluginAssetManager({
    pluginDirs: resolvePluginDirs(workspaceRoot),
    errorRoot: join(workspaceRoot, ".pi", "extensions"),
    frontTargetResolver: runtimeHost.createFrontTargetResolver(FOLDER_RUNTIME_PLUGIN_WORKSPACE_ID),
    includeLegacyFrontUrl: false,
  })
  const app = await createAgentApp({
    mode: opts.mode,
    workspaceRoot,
    logger: false,
    extraTools: createWorkspaceUiTools(bridge, { workspaceRoot }),
    beforeReload: async () => {
      const scan = await manager.load()
      syncRuntimeHostFromEvents(runtimeHost, FOLDER_RUNTIME_PLUGIN_WORKSPACE_ID, scan.events)
      return { restart_warnings: collectRestartWarnings(scan.events), diagnostics: reloadDiagnostics(scan) }
    },
  })
  await manager.load()
  await app.register(uiRoutes, { bridge })
  await app.register(boringPluginRoutes, {
    manager,
    rebuildPlugins: async () => ({ ok: true, diagnostics: [] }),
    enableReloadRoute: true,
  })
  await runtimeHost.registerRoutes(app as FastifyInstance)
  app.get("/api/v1/workspace/meta", async () => ({
    workspaceRoot,
    projectName,
    version: "0.1.18",
    runtimePluginFrontLoadingEnabled: true,
    runtimePluginTrustLabel: RUNTIME_PLUGIN_TRUST_LABEL,
    runtimePluginTrustDescription: RUNTIME_PLUGIN_TRUST_DESCRIPTION,
    runtimePluginDiagnosticsEnabled: false,
  }))
  return app as FastifyInstance
}

export async function createLocalWorkspacesModeApp(opts: {
  mode: "direct" | "local" | "vercel-sandbox"
  registryPath: string
}): Promise<FastifyInstance> {
  const registry = createLocalWorkspaceRegistry(opts.registryPath)
  const app = fastify({ logger: false, bodyLimit: 16 * 1024 * 1024 })
  const runtimeHost = await createPluginFrontRuntimeHost()
  await runtimeHost.registerRoutes(app)
  const bridges = new Map<string, ReturnType<typeof createInMemoryBridge>>()
  const workspaceEventClosers = new Map<string, Set<() => void>>()
  const pluginRuntimes = new Map<string, { manager: InstanceType<typeof BoringPluginAssetManager>; ensureLoaded: Promise<void> }>()

  function getBridge(workspaceId: string) {
    let bridge = bridges.get(workspaceId)
    if (!bridge) {
      bridge = createInMemoryBridge()
      bridges.set(workspaceId, bridge)
    }
    return bridge
  }

  async function requireWorkspace(workspaceId: string): Promise<LocalWorkspace> {
    const workspace = await registry.get(workspaceId)
    if (!workspace) throw new Error("unknown workspace")
    if (!workspace.available) throw new Error("workspace folder unavailable")
    return workspace
  }

  async function workspaceFromRequest(request: { headers?: Record<string, unknown>; query?: unknown }) {
    return await requireWorkspace(resolveWorkspaceIdFromRequest(request))
  }

  function pluginRuntimeKey(workspace: LocalWorkspace) {
    return `${workspace.id}:${workspace.path}`
  }

  function getOrCreatePluginRuntime(workspace: LocalWorkspace) {
    const key = pluginRuntimeKey(workspace)
    let runtime = pluginRuntimes.get(key)
    if (!runtime) {
      const manager = new BoringPluginAssetManager({
        pluginDirs: resolvePluginDirs(workspace.path),
        errorRoot: join(workspace.path, ".pi", "extensions"),
        frontTargetResolver: runtimeHost.createFrontTargetResolver(workspace.id),
        includeLegacyFrontUrl: false,
      })
      runtime = {
        manager,
        ensureLoaded: manager.load().then(() => undefined),
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

  async function disposeWorkspaceRuntime(workspace: LocalWorkspace): Promise<void> {
    for (const close of workspaceEventClosers.get(workspace.id) ?? []) {
      try { close() } catch {}
    }
    workspaceEventClosers.delete(workspace.id)
    pluginRuntimes.delete(pluginRuntimeKey(workspace))
    bridges.delete(workspace.id)
    await runtimeHost.disposeWorkspace(workspace.id)
  }

  app.get("/api/v1/local-workspaces", async () => ({
    workspaces: await registry.list(),
  }))
  app.get("/api/v1/workspaces", async () => ({
    workspaces: (await registry.list()).map(toCoreWorkspace),
  }))
  app.get("/api/v1/workspaces/:id", async (request, reply) => {
    const { id } = request.params as { id: string }
    const workspace = await registry.get(id)
    if (!workspace) return reply.code(404).send({ error: "workspace not found" })
    return { workspace: toCoreWorkspace(workspace), role: "owner" }
  })
  app.delete("/api/v1/local-workspaces/:id", async (request, reply) => {
    const { id } = request.params as { id: string }
    const workspace = await registry.get(id)
    await registry.remove(id)
    if (workspace) await disposeWorkspaceRuntime(workspace)
    return reply.send({ ok: true })
  })

  await app.register(registerAgentRoutes, {
    mode: opts.mode,
    getWorkspaceId: async (request) => (await workspaceFromRequest(request)).id,
    getWorkspaceRoot: async (workspaceId) => (await requireWorkspace(workspaceId)).path,
    getSessionNamespace: async ({ workspaceId }) => `local-workspace-${workspaceId}`,
    beforeReload: async ({ workspaceId }) => {
      const workspace = await requireWorkspace(workspaceId)
      const runtime = await getLoadedPluginRuntime(workspace)
      const scan = await runtime.manager.load()
      syncRuntimeHostFromEvents(runtimeHost, workspaceId, scan.events)
      return {
        restart_warnings: collectRestartWarnings(scan.events),
        diagnostics: reloadDiagnostics(scan),
      }
    },
    getPi: async ({ workspaceRoot }) => ({
      additionalSkillPaths: [join(workspaceRoot, ".agents", "skills")],
      packages: [],
      extensionPaths: [],
      getHotReloadableResources: () => ({
        additionalSkillPaths: [],
        packages: [],
        extensionPaths: [],
      }),
    }),
    getExtraTools: async ({ workspaceId, workspaceRoot, workspaceFsCapability }) => [
      ...createWorkspaceUiTools(getBridge(workspaceId), {
        workspaceRoot: workspaceFsCapability === "strong" ? workspaceRoot : undefined,
      }),
    ],
  })

  await app.register(uiRoutes, {
    getBridge: async (request) => getBridge((await workspaceFromRequest(request)).id),
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
      const payload = { ...event, workspaceId: workspace.id, replay: false }
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
      try { res.write(": heartbeat\n\n") } catch {}
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
    version: "0.1.18",
    runtimePluginFrontLoadingEnabled: true,
    runtimePluginTrustLabel: RUNTIME_PLUGIN_TRUST_LABEL,
    runtimePluginTrustDescription: RUNTIME_PLUGIN_TRUST_DESCRIPTION,
    runtimePluginDiagnosticsEnabled: false,
  }))

  return app
}
