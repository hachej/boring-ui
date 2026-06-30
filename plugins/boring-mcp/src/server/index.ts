import { defineServerPlugin } from "@hachej/boring-workspace/server"
import { BORING_MCP_PLUGIN_ID } from "../shared"

export interface CreateBoringMcpServerPluginOptions {
  systemPrompt?: string
}

export function createBoringMcpServerPlugin(options: CreateBoringMcpServerPluginOptions = {}) {
  return defineServerPlugin({
    id: BORING_MCP_PLUGIN_ID,
    label: "Sources",
    systemPrompt: options.systemPrompt ?? "Use boring-mcp bridge tools only when an app has enabled them. Treat MCP sources as read-only unless a tool is explicitly allowed.",
  })
}

export default createBoringMcpServerPlugin()
export * from "./managedConnectorAdapter"
export * from "./managedConnectorPreflight"
export * from "./sourceHandlers"
export * from "../shared"
