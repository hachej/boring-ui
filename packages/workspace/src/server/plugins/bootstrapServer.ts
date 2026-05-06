import type { RuntimeProvisioningContribution } from "@hachej/boring-agent/server"
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
  ServerPluginError,
  defineServerPlugin,
  validateServerPlugin,
} from "./defineServerPlugin"
export { composeServerPlugins } from "./composeServerPlugins"
export type { ComposeServerPluginsOptions } from "./composeServerPlugins"
export { compactPiPackages } from "./piPackages"
export type { WorkspaceServerPlugin } from "./defineServerPlugin"
export type { WorkspacePiPackageSource } from "./piPackages"

export interface ServerBootstrapOptions {
  plugins?: WorkspaceServerPlugin[]
  defaults?: WorkspaceServerPlugin[]
  excludeDefaults?: string[]
}

export type WorkspaceProvisioningContribution = {
  id: string
  provisioning: RuntimeProvisioningContribution
}

export type WorkspaceRouteContribution = {
  id: string
  routes: FastifyPluginAsync
}

export interface ServerBootstrapResult {
  registered: string[]
  systemPromptAppend: string
  piPackages: WorkspacePiPackageSource[]
  agentTools: AgentTool[]
  provisioningContributions: WorkspaceProvisioningContribution[]
  routeContributions: WorkspaceRouteContribution[]
}

function collectPiPackages(plugins: WorkspaceServerPlugin[]): WorkspacePiPackageSource[] {
  return compactPiPackages(plugins.flatMap((plugin) => plugin.piPackages ?? []))
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

  const piPackages = collectPiPackages(finalPlugins)

  const provisioningContributions = finalPlugins
    .filter((p) => p.provisioning)
    .map((p) => ({ id: p.id, provisioning: p.provisioning! }))

  const routeContributions = finalPlugins
    .filter((p) => p.routes)
    .map((p) => ({ id: p.id, routes: p.routes! }))

  return {
    registered: finalPlugins.map((p) => p.id),
    systemPromptAppend,
    piPackages,
    agentTools,
    provisioningContributions,
    routeContributions,
  }
}
