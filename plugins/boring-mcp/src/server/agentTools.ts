import type { AgentTool, ToolExecContext, ToolResult } from "@hachej/boring-workspace"
import type { McpActor, McpProviderTemplate, McpSourceRegistry, McpTransportClient } from "../shared"
import { createBoringMcpAgentBridgeRegistry, listBoringMcpAgentBridgeTools } from "./agentBridge"
import type { McpProviderHardeningOptions } from "./hardening"
import type { McpReadonlyCallAuditSink } from "./readonlyCall"
import { createBoringMcpSourceHandlers } from "./sourceHandlers"

export type BoringMcpAgentToolActorResolver = (
  params: Record<string, unknown>,
  ctx: ToolExecContext,
) => McpActor | Promise<McpActor>

export interface CreateBoringMcpAgentToolsOptions {
  registry: McpSourceRegistry
  transport: McpTransportClient
  resolveActor: BoringMcpAgentToolActorResolver
  templates?: readonly McpProviderTemplate[]
  maxReadonlyInputBytes?: number
  audit?: McpReadonlyCallAuditSink
  hardening?: McpProviderHardeningOptions
}

function toolResult(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] }
}

export function createBoringMcpAgentTools(options: CreateBoringMcpAgentToolsOptions): AgentTool[] {
  const handlers = createBoringMcpSourceHandlers(options)
  const bridge = createBoringMcpAgentBridgeRegistry(handlers)
  return listBoringMcpAgentBridgeTools(bridge).map((tool): AgentTool => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    promptSnippet: `${tool.name}: ${tool.description}`,
    async execute(params, ctx) {
      const actor = await options.resolveActor(params, ctx)
      return toolResult(await tool.invoke({ actor }, params))
    },
  }))
}
