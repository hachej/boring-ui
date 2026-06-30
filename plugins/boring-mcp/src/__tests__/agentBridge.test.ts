import { describe, expect, it, vi } from "vitest"
import {
  BORING_MCP_AGENT_BRIDGE_TOOL_DEFINITIONS,
  BORING_MCP_AGENT_BRIDGE_TOOL_NAMES,
  createBoringMcpAgentBridgeRegistry,
  listBoringMcpAgentBridgeTools,
} from "../server/agentBridge"
import { createBoringMcpSourceHandlers, type BoringMcpSourceHandlers } from "../server/sourceHandlers"
import {
  MCP_ERROR_CODES,
  type McpActor,
  type McpDiscoveredTool,
  type McpSource,
  type McpSourceRegistry,
  type McpTransportClient,
} from "../shared"

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

const readonlyTool: McpDiscoveredTool = {
  name: "NOTION_SEARCH_NOTION_PAGE",
  description: "Search Notion pages",
  inputSchema: { type: "object", properties: { query: { type: "string" } } },
}

function registry(current: McpSource = source): McpSourceRegistry {
  return {
    async listSources(requestActor) {
      return requestActor.userId === current.userId && requestActor.workspaceId === current.workspaceId ? [current] : []
    },
    async getSource(sourceId) {
      return sourceId === current.id ? current : undefined
    },
  }
}

function transport(tools: McpDiscoveredTool[] = [readonlyTool, { name: "update_page" }]): McpTransportClient {
  return {
    listTools: vi.fn(async () => tools),
    listResources: vi.fn(async () => []),
    readResource: vi.fn(),
    callTool: vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] })),
  }
}

function bridge(tx = transport()) {
  const handlers = createBoringMcpSourceHandlers({ registry: registry(), transport: tx })
  return createBoringMcpAgentBridgeRegistry(handlers)
}

describe("boring-mcp agent bridge", () => {
  it("exposes exactly the seven stable tool names with machine-readable schemas", () => {
    const registry = bridge()

    expect(Object.keys(registry)).toEqual([...BORING_MCP_AGENT_BRIDGE_TOOL_NAMES])
    expect(BORING_MCP_AGENT_BRIDGE_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([...BORING_MCP_AGENT_BRIDGE_TOOL_NAMES])
    expect(listBoringMcpAgentBridgeTools(registry).map((tool) => tool.name)).toEqual([...BORING_MCP_AGENT_BRIDGE_TOOL_NAMES])
    for (const tool of listBoringMcpAgentBridgeTools(registry)) {
      expect(tool.description).toEqual(expect.any(String))
      expect(tool.description.length).toBeGreaterThan(12)
      expect(tool.inputSchema).toMatchObject({ type: "object" })
      expect(tool.readOnly).toBe(true)
    }
  })

  it("delegates list/status/doctor/probe/search/describe/read-only call to existing handlers", async () => {
    const tx = transport()
    const registry = bridge(tx)

    await expect(registry.mcp_servers_list.invoke({ actor }, {})).resolves.toMatchObject({ sources: [expect.objectContaining({ id: source.id })] })
    await expect(registry.mcp_server_status.invoke({ actor }, { sourceId: source.id })).resolves.toMatchObject({ source: { id: source.id }, canProbe: true })
    await expect(registry.mcp_server_doctor.invoke({ actor }, { sourceId: source.id })).resolves.toMatchObject({ ok: true, sourceId: source.id, issues: [] })
    await expect(registry.mcp_server_probe.invoke({ actor }, { sourceId: source.id })).resolves.toMatchObject({ sourceId: source.id, tools: expect.arrayContaining([expect.objectContaining({ name: readonlyTool.name })]) })
    await expect(registry.mcp_tools_search.invoke({ actor }, { query: "search" })).resolves.toMatchObject({ tools: [expect.objectContaining({ toolName: readonlyTool.name })] })
    await expect(registry.mcp_tool_describe.invoke({ actor }, { sourceId: source.id, toolName: readonlyTool.name })).resolves.toMatchObject({ tool: expect.objectContaining({ toolName: readonlyTool.name }) })
    await expect(registry.mcp_readonly_call.invoke({ actor }, { sourceId: source.id, toolName: readonlyTool.name, input: { query: "demo" } })).resolves.toEqual({ content: { content: [{ type: "text", text: "ok" }] } })

    expect(tx.listTools).toHaveBeenCalled()
    expect(tx.callTool).toHaveBeenCalledWith(source, readonlyTool.name, { query: "demo" })
  })

  it("requires an explicit actor before invoking handlers or transport", async () => {
    const tx = transport()
    const handlers: BoringMcpSourceHandlers = {
      listSources: vi.fn(),
      getSourceStatus: vi.fn(),
      doctorSource: vi.fn(),
      probeSource: vi.fn(),
      searchTools: vi.fn(),
      describeTool: vi.fn(),
      mcp_tools_search: vi.fn(),
      mcp_tool_describe: vi.fn(),
      callReadonly: vi.fn(),
      mcp_readonly_call: vi.fn(),
      disconnectSource: vi.fn(),
    }
    const registry = createBoringMcpAgentBridgeRegistry(handlers)

    await expect(registry.mcp_servers_list.invoke(undefined as never, {})).rejects.toMatchObject({ code: MCP_ERROR_CODES.INPUT_INVALID })

    expect(handlers.listSources).not.toHaveBeenCalled()
    expect(tx.listTools).not.toHaveBeenCalled()
    expect(tx.callTool).not.toHaveBeenCalled()
  })

  it("rejects malformed bridge inputs before handlers or transport", async () => {
    const tx = transport()
    const handlers: BoringMcpSourceHandlers = {
      listSources: vi.fn(),
      getSourceStatus: vi.fn(),
      doctorSource: vi.fn(),
      probeSource: vi.fn(),
      searchTools: vi.fn(),
      describeTool: vi.fn(),
      mcp_tools_search: vi.fn(),
      mcp_tool_describe: vi.fn(),
      callReadonly: vi.fn(),
      mcp_readonly_call: vi.fn(),
      disconnectSource: vi.fn(),
    }
    const registry = createBoringMcpAgentBridgeRegistry(handlers)

    await expect(registry.mcp_servers_list.invoke({ actor }, [])).rejects.toMatchObject({ code: MCP_ERROR_CODES.INPUT_INVALID })
    await expect(registry.mcp_server_status.invoke({ actor }, { sourceId: 42 })).rejects.toMatchObject({ code: MCP_ERROR_CODES.INPUT_INVALID })
    await expect(registry.mcp_tools_search.invoke({ actor }, { sourceId: "", refresh: "yes" })).rejects.toMatchObject({ code: MCP_ERROR_CODES.INPUT_INVALID })
    await expect(registry.mcp_tool_describe.invoke({ actor }, { sourceId: source.id })).rejects.toMatchObject({ code: MCP_ERROR_CODES.INPUT_INVALID })
    await expect(registry.mcp_readonly_call.invoke({ actor }, { sourceId: source.id })).rejects.toMatchObject({ code: MCP_ERROR_CODES.INPUT_INVALID })

    expect(handlers.listSources).not.toHaveBeenCalled()
    expect(handlers.getSourceStatus).not.toHaveBeenCalled()
    expect(handlers.mcp_tools_search).not.toHaveBeenCalled()
    expect(handlers.mcp_tool_describe).not.toHaveBeenCalled()
    expect(handlers.mcp_readonly_call).not.toHaveBeenCalled()
    expect(tx.listTools).not.toHaveBeenCalled()
    expect(tx.callTool).not.toHaveBeenCalled()
  })

  it("keeps the PR5 boundary: mutating tools are blocked before provider discovery/call", async () => {
    const tx = transport([{ name: "update_page" }])
    const registry = bridge(tx)

    await expect(registry.mcp_readonly_call.invoke({ actor }, { sourceId: source.id, toolName: "update_page", input: { title: "new" } })).rejects.toMatchObject({ code: MCP_ERROR_CODES.TOOL_NOT_ALLOWED })

    expect(tx.listTools).not.toHaveBeenCalled()
    expect(tx.callTool).not.toHaveBeenCalled()
  })

  it("does not leak secret-like handler results or errors through the bridge", async () => {
    const handlers: BoringMcpSourceHandlers = {
      listSources: vi.fn(async () => ({ sources: [{ ...source, displayName: "access_token=abcdefghijklmnop" }] })),
      getSourceStatus: vi.fn(),
      doctorSource: vi.fn(),
      probeSource: vi.fn(async () => { throw new Error("provider leaked api_key=abcdefghijklmnop") }),
      searchTools: vi.fn(),
      describeTool: vi.fn(),
      mcp_tools_search: vi.fn(),
      mcp_tool_describe: vi.fn(),
      callReadonly: vi.fn(),
      mcp_readonly_call: vi.fn(),
      disconnectSource: vi.fn(),
    }
    const registry = createBoringMcpAgentBridgeRegistry(handlers)

    await expect(registry.mcp_servers_list.invoke({ actor }, {})).rejects.toMatchObject({ code: MCP_ERROR_CODES.SECRET_LEAK_GUARD })
    await expect(registry.mcp_server_probe.invoke({ actor }, { sourceId: source.id })).rejects.toMatchObject({
      code: MCP_ERROR_CODES.PROVIDER_ERROR,
      details: { message: "provider leaked [REDACTED_MCP_SECRET]" },
    })
  })
})
