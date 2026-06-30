import { describe, expect, it, vi } from "vitest"
import { BORING_MCP_AGENT_BRIDGE_TOOL_NAMES } from "../server/agentBridge"
import { createBoringMcpAgentTools } from "../server/agentTools"
import { createBoringMcpServerPlugin } from "../server/index"
import type { McpActor, McpSource, McpSourceRegistry, McpTransportClient } from "../shared"

const actor: McpActor = { userId: "user-1", workspaceId: "workspace-1" }
const source: McpSource = {
  id: "source:notion:user-1",
  workspaceId: actor.workspaceId,
  userId: actor.userId,
  provider: "notion",
  displayName: "Notion",
  status: "connected",
  ownerKind: "user",
  credentialProvider: "composio-managed",
}

function registry(): McpSourceRegistry {
  return {
    async listSources(requestActor) {
      return requestActor.userId === actor.userId && requestActor.workspaceId === actor.workspaceId ? [source] : []
    },
    async getSource(sourceId) {
      return sourceId === source.id ? source : undefined
    },
  }
}

function transport(): McpTransportClient {
  return {
    listTools: vi.fn(async () => [{ name: "NOTION_SEARCH_NOTION_PAGE", description: "Search fake pages", inputSchema: { type: "object" } }]),
    listResources: vi.fn(async () => []),
    readResource: vi.fn(),
    callTool: vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] })),
  }
}

describe("boring-mcp generic agent tools", () => {
  it("creates the seven executable bridge tools with app-provided actor resolution", async () => {
    const resolveActor = vi.fn(async () => actor)
    const tools = createBoringMcpAgentTools({ registry: registry(), transport: transport(), resolveActor })

    expect(tools.map((tool) => tool.name)).toEqual([...BORING_MCP_AGENT_BRIDGE_TOOL_NAMES])
    const result = await tools.find((tool) => tool.name === "mcp_tools_search")!.execute({ query: "search" }, {
      abortSignal: new AbortController().signal,
      toolCallId: "tool-call-1",
    })

    expect(resolveActor).toHaveBeenCalledOnce()
    expect(JSON.parse(result.content[0].text)).toMatchObject({ tools: [expect.objectContaining({ toolName: "NOTION_SEARCH_NOTION_PAGE" })] })
  })

  it("lets apps enable boring-mcp without custom bridge glue", () => {
    const plugin = createBoringMcpServerPlugin({ registry: registry(), transport: transport(), resolveActor: async () => actor })

    expect(plugin.id).toBe("boring-mcp")
    expect(plugin.agentTools?.map((tool) => tool.name)).toEqual([...BORING_MCP_AGENT_BRIDGE_TOOL_NAMES])
  })
})
