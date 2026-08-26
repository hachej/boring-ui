import type { FastifyInstance } from "fastify"
import type { BoringServerPluginManifest } from "@hachej/boring-workspace/server"
import type { PluginFrontRuntimeDiagnostic } from "./diagnostics.js"

export interface CreatePluginFrontRuntimeHostOptions {
  basePath?: string
  maxTransformConcurrency?: number
  onDiagnostic?: (diagnostic: PluginFrontRuntimeDiagnostic) => void
}

export interface PluginFrontRuntimeResponse {
  body: string | Uint8Array
  contentType: string
  cacheKey: string
}

export interface PluginFrontRuntimeServeRequest {
  workspaceId: string
  pluginId: string
  revision: string | number
  subpath: string
  search?: string
}

export type PluginFrontTargetResolver = (
  plugin: BoringServerPluginManifest,
  context: { revision: number; frontEntrySubpath: string },
) => {
  kind: "native"
  entryUrl: string
  revision: number
  trust: "local-trusted-native"
} | undefined

export interface PluginFrontRuntimeHost {
  readonly basePath: string
  readonly singletonModules: readonly string[]
  createFrontTargetResolver(workspaceId: string): PluginFrontTargetResolver
  activateWorkspace(workspaceId: string): void
  trackPlugin(args: { workspaceId: string; plugin: BoringServerPluginManifest; revision: number; frontEntrySubpath: string }): string
  untrackPlugin(workspaceId: string, pluginId: string): void
  invalidatePlugin(workspaceId: string, pluginId: string, keepRevision?: number): Promise<void>
  disposeWorkspace(workspaceId: string): Promise<void>
  serve(request: PluginFrontRuntimeServeRequest): Promise<PluginFrontRuntimeResponse>
  warmupWorkspace(workspaceId: string): Promise<void>
  registerRoutes(app: FastifyInstance): Promise<void>
  close(): Promise<void>
}
