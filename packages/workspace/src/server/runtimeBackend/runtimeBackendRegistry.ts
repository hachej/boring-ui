import { ErrorCode } from "@hachej/boring-agent/shared"
import { importServerModule } from "../pluginImports/importServerModule"
import type { BoringPluginSource } from "../agentPlugins/types"
import type { LoadedBoringPluginInspection } from "../agentPlugins/manager"
import {
  isRuntimePluginResponse,
  validateRuntimeServerPlugin,
  type PluginLogger,
  type RuntimePluginContext,
  type RuntimePluginResponse,
  type RuntimeServerPlugin,
} from "./defineRuntimeServerPlugin"
import { captureRuntimeRoutes, runtimeRouteKey, type CapturedRuntimeRoute } from "./routerCapture"

export interface RuntimeBackendDiagnostic {
  pluginId?: string
  source: string
  code: ErrorCode
  message: string
}

export interface RuntimeBackendReloadResult {
  ok: boolean
  diagnostics: RuntimeBackendDiagnostic[]
}

export interface RuntimeBackendDispatchRequest {
  pluginId: string
  method: string
  path: string
  query: URLSearchParams
  headers: Headers
  signal: AbortSignal
  body: unknown
  logger: PluginLogger
  workspaceId?: string
}

export interface RuntimeBackendDispatchResponse {
  status: number
  headers: Record<string, string>
  body?: unknown
}

interface RuntimeBackendSnapshot {
  pluginId: string
  source: BoringPluginSource
  module: RuntimeServerPlugin
  routes: Map<string, CapturedRuntimeRoute>
}

export class RuntimeBackendError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly statusCode: number,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = "RuntimeBackendError"
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error)
}

function moduleValue(mod: { default?: unknown } | unknown): unknown {
  return typeof mod === "object" && mod !== null && "default" in mod
    ? (mod as { default?: unknown }).default
    : mod
}

function toRouteMap(routes: CapturedRuntimeRoute[]): Map<string, CapturedRuntimeRoute> {
  const map = new Map<string, CapturedRuntimeRoute>()
  for (const route of routes) map.set(runtimeRouteKey(route.method, route.path), route)
  return map
}

function assertJsonSerializable(value: unknown): void {
  if (value === undefined || value === null) return
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    throw new RuntimeBackendError(
      ErrorCode.enum.RUNTIME_PLUGIN_RESPONSE_UNSUPPORTED,
      500,
      "runtime plugin response is not JSON-serializable",
    )
  }
  try {
    JSON.stringify(value)
  } catch (error) {
    throw new RuntimeBackendError(
      ErrorCode.enum.RUNTIME_PLUGIN_RESPONSE_UNSUPPORTED,
      500,
      `runtime plugin response is not JSON-serializable: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function normalizeResponse(value: unknown): RuntimeBackendDispatchResponse {
  if (value === undefined || value === null) return { status: 204, headers: {} }
  if (isRuntimePluginResponse(value)) return normalizeExplicitResponse(value)
  assertJsonSerializable(value)
  return { status: 200, headers: { "content-type": "application/json; charset=utf-8" }, body: value }
}

function normalizeExplicitResponse(value: RuntimePluginResponse): RuntimeBackendDispatchResponse {
  const status = value.status ?? (value.body === undefined || value.body === null ? 204 : 200)
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new RuntimeBackendError(
      ErrorCode.enum.RUNTIME_PLUGIN_RESPONSE_UNSUPPORTED,
      500,
      "runtime plugin response status must be an integer HTTP status code",
    )
  }
  const headers: Record<string, string> = {}
  if (value.headers !== undefined) {
    for (const [name, headerValue] of Object.entries(value.headers)) {
      if (typeof headerValue !== "string") {
        throw new RuntimeBackendError(
          ErrorCode.enum.RUNTIME_PLUGIN_RESPONSE_UNSUPPORTED,
          500,
          "runtime plugin response headers must be strings",
        )
      }
      headers[name] = headerValue
    }
  }
  if (value.body === undefined || value.body === null) return { status, headers }
  assertJsonSerializable(value.body)
  if (!Object.keys(headers).some((name) => name.toLowerCase() === "content-type")) {
    headers["content-type"] = "application/json; charset=utf-8"
  }
  return { status, headers, body: value.body }
}

async function disposeSnapshot(snapshot: RuntimeBackendSnapshot): Promise<RuntimeBackendDiagnostic[]> {
  if (!snapshot.module.dispose) return []
  try {
    await snapshot.module.dispose()
    return []
  } catch (error) {
    return [{
      pluginId: snapshot.pluginId,
      source: `runtime backend dispose (${snapshot.pluginId})`,
      code: ErrorCode.enum.RUNTIME_PLUGIN_LOAD_FAILED,
      message: errorMessage(error),
    }]
  }
}

export class RuntimeBackendRegistry {
  private readonly snapshots = new Map<string, RuntimeBackendSnapshot>()
  private lastDiagnostics: RuntimeBackendDiagnostic[] = []
  private reloadQueue: Promise<RuntimeBackendReloadResult> = Promise.resolve({ ok: true, diagnostics: [] })

  getDiagnostics(): RuntimeBackendDiagnostic[] {
    return [...this.lastDiagnostics]
  }

  listPluginIds(): string[] {
    return [...this.snapshots.keys()].sort()
  }

  async reloadFromLoadedPlugins(plugins: LoadedBoringPluginInspection[]): Promise<RuntimeBackendReloadResult> {
    const run = this.reloadQueue.then(() => this.reloadOnce(plugins), () => this.reloadOnce(plugins))
    this.reloadQueue = run.then(() => ({ ok: true, diagnostics: [] }), () => ({ ok: false, diagnostics: [] }))
    return run
  }

  async close(): Promise<RuntimeBackendReloadResult> {
    const run = this.reloadQueue.then(() => this.closeOnce(), () => this.closeOnce())
    this.reloadQueue = run.then(() => ({ ok: true, diagnostics: [] }), () => ({ ok: false, diagnostics: [] }))
    return run
  }

  async dispatch(request: RuntimeBackendDispatchRequest): Promise<RuntimeBackendDispatchResponse> {
    const snapshot = this.snapshots.get(request.pluginId)
    if (!snapshot) {
      throw new RuntimeBackendError(
        ErrorCode.enum.RUNTIME_PLUGIN_NOT_FOUND,
        404,
        `runtime backend plugin not found: ${request.pluginId}`,
      )
    }
    if (snapshot.source.workspaceId && request.workspaceId && snapshot.source.workspaceId !== request.workspaceId) {
      throw new RuntimeBackendError(
        ErrorCode.enum.RUNTIME_PLUGIN_NOT_FOUND,
        404,
        `runtime backend plugin not found in workspace: ${request.pluginId}`,
      )
    }
    const route = snapshot.routes.get(runtimeRouteKey(request.method, request.path))
      ?? snapshot.routes.get(runtimeRouteKey("ALL", request.path))
    if (!route) {
      throw new RuntimeBackendError(
        ErrorCode.enum.RUNTIME_PLUGIN_ROUTE_NOT_FOUND,
        404,
        `runtime backend route not found: ${request.method.toUpperCase()} ${request.path}`,
      )
    }

    const ctx: RuntimePluginContext = {
      pluginId: request.pluginId,
      method: request.method.toUpperCase(),
      path: request.path,
      query: request.query,
      headers: request.headers,
      signal: request.signal,
      body: request.body,
      logger: request.logger,
    }

    try {
      return normalizeResponse(await route.handler(ctx))
    } catch (error) {
      if (error instanceof RuntimeBackendError) throw error
      throw new RuntimeBackendError(
        ErrorCode.enum.RUNTIME_PLUGIN_HANDLER_FAILED,
        500,
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  private async reloadOnce(plugins: LoadedBoringPluginInspection[]): Promise<RuntimeBackendReloadResult> {
    const diagnostics: RuntimeBackendDiagnostic[] = []
    const externalRuntimePlugins = plugins.filter((plugin) => plugin.source.kind === "external" && plugin.serverPath)
    const nextIds = new Set(externalRuntimePlugins.map((plugin) => plugin.id))

    for (const id of [...this.snapshots.keys()]) {
      if (nextIds.has(id)) continue
      const previous = this.snapshots.get(id)
      if (!previous) continue
      this.snapshots.delete(id)
      diagnostics.push(...await disposeSnapshot(previous))
    }

    for (const plugin of externalRuntimePlugins) {
      const serverPath = plugin.serverPath
      if (!serverPath) continue
      try {
        const mod = await importServerModule(serverPath, true)
        const runtimePlugin = validateRuntimeServerPlugin(moduleValue(mod))
        const routes = await captureRuntimeRoutes((router) => runtimePlugin.routes(router))
        const nextSnapshot: RuntimeBackendSnapshot = {
          pluginId: plugin.id,
          source: plugin.source,
          module: runtimePlugin,
          routes: toRouteMap(routes),
        }
        const previous = this.snapshots.get(plugin.id)
        this.snapshots.set(plugin.id, nextSnapshot)
        if (previous) diagnostics.push(...await disposeSnapshot(previous))
      } catch (error) {
        diagnostics.push({
          pluginId: plugin.id,
          source: `runtime backend (${plugin.id})`,
          code: ErrorCode.enum.RUNTIME_PLUGIN_LOAD_FAILED,
          message: errorMessage(error),
        })
      }
    }

    this.lastDiagnostics = diagnostics
    return { ok: diagnostics.length === 0, diagnostics }
  }

  private async closeOnce(): Promise<RuntimeBackendReloadResult> {
    const diagnostics: RuntimeBackendDiagnostic[] = []
    for (const snapshot of this.snapshots.values()) {
      diagnostics.push(...await disposeSnapshot(snapshot))
    }
    this.snapshots.clear()
    this.lastDiagnostics = diagnostics
    return { ok: diagnostics.length === 0, diagnostics }
  }
}
