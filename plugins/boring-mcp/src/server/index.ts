import { defineServerPlugin } from "@hachej/boring-workspace/server"
import { BORING_MCP_PLUGIN_ID, type McpProviderTemplate, type McpSourceRegistry, type McpTransportClient } from "../shared"
import type { McpProviderHardeningOptions } from "./hardening"
import type { McpReadonlyCallAuditSink } from "./readonlyCall"
import { createBoringMcpAgentTools, type BoringMcpAgentToolActorResolver } from "./agentTools"

export interface CreateBoringMcpServerPluginOptions {
  systemPrompt?: string
  registry?: McpSourceRegistry
  transport?: McpTransportClient
  resolveActor?: BoringMcpAgentToolActorResolver
  templates?: readonly McpProviderTemplate[]
  maxReadonlyInputBytes?: number
  audit?: McpReadonlyCallAuditSink
  hardening?: McpProviderHardeningOptions
}

export function createBoringMcpServerPlugin(options: CreateBoringMcpServerPluginOptions = {}) {
  const hasAgentToolWiring = Boolean(options.registry && options.transport && options.resolveActor)
  return defineServerPlugin({
    id: BORING_MCP_PLUGIN_ID,
    label: "Sources",
    systemPrompt: options.systemPrompt ?? "Use boring-mcp bridge tools only when an app has enabled them. Treat MCP sources as read-only unless a tool is explicitly allowed.",
    agentTools: hasAgentToolWiring ? createBoringMcpAgentTools({
      registry: options.registry!,
      transport: options.transport!,
      resolveActor: options.resolveActor!,
      templates: options.templates,
      maxReadonlyInputBytes: options.maxReadonlyInputBytes,
      audit: options.audit,
      hardening: options.hardening,
    }) : undefined,
  })
}

export default createBoringMcpServerPlugin()
export * from "./appServerBinding"
export * from "./agentBridge"
export * from "./agentTools"
export * from "./composioManagedConnector"
export * from "./hardening"
export * from "./managedConnectorAdapter"
export * from "./managedConnectorPreflight"
export * from "./mcpSdkTransport"
export * from "./sourceAccess"
export * from "./sourceHandlers"
export * from "./readonlyCall"
export * from "./toolCatalog"
export * from "../shared"
