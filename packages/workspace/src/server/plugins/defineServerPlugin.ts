import type { RuntimeProvisioningContribution } from "@boring/agent/server"
import type { FastifyPluginAsync } from "fastify"
import type { AgentTool } from "../../shared/types/agent-tool"

export interface WorkspaceServerPlugin {
  id: string
  label?: string
  systemPrompt?: string
  agentTools?: AgentTool[]
  provisioning?: RuntimeProvisioningContribution
  routes?: FastifyPluginAsync
}

export function defineServerPlugin<T extends WorkspaceServerPlugin>(plugin: T): T {
  return plugin
}
