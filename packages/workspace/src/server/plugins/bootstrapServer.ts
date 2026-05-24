import type { ProvisionWorkspaceRuntimeOptions } from "@hachej/boring-agent/server"
import type { FastifyPluginAsync } from "fastify"
import type { AgentTool } from "../../shared/types/agent-tool"
import {
  validateServerPlugin,
  type WorkspaceServerPlugin,
} from "./defineServerPlugin"
import {
  compactPiPackages,
  type WorkspacePiPackageSource,
} from "./piPackages"
export {
  defineServerPlugin,
  validateServerPlugin,
} from "./defineServerPlugin"
export { compactPiPackages } from "./piPackages"
export type { WorkspaceServerPlugin } from "./defineServerPlugin"
export type { WorkspacePiPackageSource } from "./piPackages"

export interface ServerBootstrapOptions {
  plugins?: WorkspaceServerPlugin[]
  defaults?: WorkspaceServerPlugin[]
  excludeDefaults?: string[]
}

export type WorkspaceRuntimeProvisioningPlugin = ProvisionWorkspaceRuntimeOptions["plugins"][number]

export type WorkspaceProvisioningContribution = {
  id: string
  provisioning: NonNullable<WorkspaceRuntimeProvisioningPlugin["provisioning"]>
}

export type WorkspaceRouteContribution = {
  id: string
  routes: FastifyPluginAsync
}

export interface ServerBootstrapResult {
  registered: string[]
  systemPromptAppend: string
  piPackages: WorkspacePiPackageSource[]
  extensionPaths: string[]
  agentTools: AgentTool[]
  runtimePlugins: WorkspaceRuntimeProvisioningPlugin[]
  provisioningContributions: WorkspaceProvisioningContribution[]
  routeContributions: WorkspaceRouteContribution[]
  preservedUiStateKeys: string[]
}

export function bootstrapServer(options: ServerBootstrapOptions): ServerBootstrapResult {
  const excludedDefaults = new Set(options.excludeDefaults ?? [])
  const finalPlugins = [
    ...(options.defaults ?? []).filter((p) => !excludedDefaults.has(p.id)),
    ...(options.plugins ?? []),
  ]

  const seenIds = new Set<string>()
  for (const plugin of finalPlugins) {
    validateServerPlugin(plugin)
    if (seenIds.has(plugin.id)) {
      throw new Error(`plugin "${plugin.id}" registered twice`)
    }
    seenIds.add(plugin.id)
  }

  const agentTools: AgentTool[] = []
  for (const plugin of finalPlugins) {
    for (const tool of plugin.agentTools ?? []) {
      agentTools.push(tool)
    }
  }

  const systemPromptAppend = finalPlugins
    .filter((p) => p.systemPrompt && p.systemPrompt.trim())
    .map((p) => p.systemPrompt!.trim())
    .join("\n\n")

  const piPackages = compactPiPackages(finalPlugins.flatMap((plugin) => plugin.piPackages ?? []))

  const extensionPaths = finalPlugins.flatMap((p) => p.extensionPaths ?? [])

  const provisioningContributions = finalPlugins
    .filter((p) => p.provisioning)
    .map((p) => ({ id: p.id, provisioning: p.provisioning! }))

  const runtimePlugins = finalPlugins.map((plugin) => ({
    id: plugin.id,
    ...(plugin.skills ? { skills: plugin.skills } : {}),
    ...(plugin.provisioning ? { provisioning: plugin.provisioning } : {}),
  }))

  const routeContributions = finalPlugins
    .filter((p) => p.routes)
    .map((p) => ({ id: p.id, routes: p.routes! }))

  const preservedUiStateKeys = [...new Set(finalPlugins.flatMap((p) => p.preservedUiStateKeys ?? []))]

  return {
    registered: finalPlugins.map((p) => p.id),
    systemPromptAppend,
    piPackages,
    extensionPaths,
    agentTools,
    runtimePlugins,
    provisioningContributions,
    routeContributions,
    preservedUiStateKeys,
  }
}
