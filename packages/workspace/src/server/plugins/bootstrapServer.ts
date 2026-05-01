import type { RuntimeProvisioningContribution } from "@boring/agent/server"
import type { FastifyPluginAsync } from "fastify"
import type { AgentTool } from "../../shared/types/agent-tool"
import type { WorkspaceServerPlugin } from "./defineServerPlugin"
export { defineServerPlugin } from "./defineServerPlugin"
export type { WorkspaceServerPlugin } from "./defineServerPlugin"

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
  agentTools: AgentTool[]
  provisioningContributions: WorkspaceProvisioningContribution[]
  routeContributions: WorkspaceRouteContribution[]
}

export function bootstrapServer(options: ServerBootstrapOptions): ServerBootstrapResult {
  const excludedDefaults = new Set(options.excludeDefaults ?? [])
  const finalPlugins = [
    ...(options.defaults ?? []).filter((p) => !excludedDefaults.has(p.id)),
    ...(options.plugins ?? []),
  ]

  const seenIds = new Set<string>()
  for (const plugin of finalPlugins) {
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

  const provisioningContributions = finalPlugins
    .filter((p) => p.provisioning)
    .map((p) => ({ id: p.id, provisioning: p.provisioning! }))

  const routeContributions = finalPlugins
    .filter((p) => p.routes)
    .map((p) => ({ id: p.id, routes: p.routes! }))

  return {
    registered: finalPlugins.map((p) => p.id),
    systemPromptAppend,
    agentTools,
    provisioningContributions,
    routeContributions,
  }
}
