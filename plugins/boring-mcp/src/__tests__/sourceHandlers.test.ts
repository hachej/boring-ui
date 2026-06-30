import { describe, expect, it, vi } from "vitest"
import { createBoringMcpSourceHandlers } from "../server/sourceHandlers"
import {
  MCP_ERROR_CODES,
  type McpActor,
  type McpSource,
  type McpSourceRegistry,
  type McpTransportClient,
} from "../shared"

const actor: McpActor = { userId: "user-1", workspaceId: "workspace-1" }

function makeSource(overrides: Partial<McpSource> = {}): McpSource {
  return {
    id: "source:notion:user-1",
    workspaceId: actor.workspaceId,
    userId: actor.userId,
    provider: "notion",
    displayName: "Notion",
    status: "connected",
    ownerKind: "user",
    credentialProvider: "provider-managed",
    ...overrides,
  }
}

function makeRegistry(source = makeSource()): McpSourceRegistry {
  let current = source
  return {
    async listSources(requestActor) {
      return requestActor.userId === current.userId && requestActor.workspaceId === current.workspaceId ? [current] : []
    },
    async getSource(sourceId) {
      return sourceId === current.id ? current : undefined
    },
    async disconnectSource(requestActor, sourceId) {
      if (sourceId !== current.id || requestActor.userId !== current.userId || requestActor.workspaceId !== current.workspaceId) return undefined
      current = { ...current, status: "unconfigured", updatedAt: "2026-01-01T00:00:00.000Z" }
      return current
    },
  }
}

function makeTransport(): McpTransportClient {
  return {
    listTools: vi.fn(async () => [{ name: "NOTION_SEARCH_NOTION_PAGE" }, { name: "update_page" }]),
    listResources: vi.fn(async () => []),
    readResource: vi.fn(),
    callTool: vi.fn(),
  }
}

describe("boring-mcp source handlers", () => {
  it("lists secret-free source DTOs", async () => {
    const handlers = createBoringMcpSourceHandlers({ registry: makeRegistry(), transport: makeTransport() })
    const result = await handlers.listSources(actor)

    expect(result.sources).toEqual([
      expect.objectContaining({ id: "source:notion:user-1", provider: "notion", credentialProvider: "provider-managed" }),
    ])
    expect(result.sources[0]).not.toHaveProperty("tokenRef")
    expect(result.sources[0]).not.toHaveProperty("sessionHeaders")
  })

  it("rejects source DTOs that contain secret-like provider metadata", async () => {
    const handlers = createBoringMcpSourceHandlers({
      registry: makeRegistry(makeSource({ providerAccountLabel: "access_token=abcdefghijklmnop" })),
      transport: makeTransport(),
    })

    await expect(handlers.listSources(actor)).rejects.toMatchObject({ code: MCP_ERROR_CODES.SECRET_LEAK_GUARD })
  })

  it("returns status only for the owning actor", async () => {
    const handlers = createBoringMcpSourceHandlers({ registry: makeRegistry(), transport: makeTransport() })

    await expect(handlers.getSourceStatus(actor, "source:notion:user-1")).resolves.toMatchObject({
      source: { id: "source:notion:user-1" },
      connectable: true,
      canProbe: true,
      canDisconnect: true,
    })
    await expect(handlers.getSourceStatus({ ...actor, userId: "user-2" }, "source:notion:user-1")).rejects.toMatchObject({
      code: MCP_ERROR_CODES.SOURCE_NOT_FOUND,
    })
  })

  it("probes through the facade and classifies tools", async () => {
    const handlers = createBoringMcpSourceHandlers({ registry: makeRegistry(), transport: makeTransport() })
    const result = await handlers.probeSource(actor, " source:notion:user-1 ")

    expect(result.tools).toEqual([
      expect.objectContaining({ name: "NOTION_SEARCH_NOTION_PAGE", decision: expect.objectContaining({ allowed: true }) }),
      expect.objectContaining({ name: "update_page", decision: expect.objectContaining({ allowed: false }) }),
    ])
  })

  it("rejects probe metadata that contains secret-like values", async () => {
    const transport = makeTransport()
    transport.listResources = vi.fn(async () => [{ uri: "notion://page/demo?oauth_token=abcdefghijklmnop" }])
    const handlers = createBoringMcpSourceHandlers({ registry: makeRegistry(), transport })

    await expect(handlers.probeSource(actor, "source:notion:user-1")).rejects.toMatchObject({ code: MCP_ERROR_CODES.SECRET_LEAK_GUARD })
  })

  it("exposes exact catalog backend operation names", async () => {
    const handlers = createBoringMcpSourceHandlers({ registry: makeRegistry(), transport: makeTransport() })

    await expect(handlers.mcp_tools_search(actor, { query: "search" })).resolves.toMatchObject({
      tools: [expect.objectContaining({ toolName: "NOTION_SEARCH_NOTION_PAGE", enabled: true })],
    })
    await expect(handlers.mcp_tool_describe(actor, { sourceId: "source:notion:user-1", toolName: "update_page" })).resolves.toMatchObject({
      tool: expect.objectContaining({ toolName: "update_page", enabled: false }),
    })
  })

  it("does not call disconnect on unowned sources", async () => {
    const registry = makeRegistry()
    const disconnect = vi.spyOn(registry, "disconnectSource")
    const handlers = createBoringMcpSourceHandlers({ registry, transport: makeTransport() })

    await expect(handlers.disconnectSource({ ...actor, userId: "user-2" }, "source:notion:user-1")).rejects.toMatchObject({
      code: MCP_ERROR_CODES.SOURCE_NOT_FOUND,
    })
    expect(disconnect).not.toHaveBeenCalled()
  })

  it("disconnects through the injected registry without provider execution", async () => {
    const transport = makeTransport()
    const handlers = createBoringMcpSourceHandlers({ registry: makeRegistry(), transport })
    const result = await handlers.disconnectSource(actor, "source:notion:user-1")

    expect(result).toMatchObject({ source: { status: "unconfigured" }, canDisconnect: false })
    expect(transport.callTool).not.toHaveBeenCalled()
  })
})
