import { describe, expect, it, vi } from "vitest"
import { createBoringMcpToolCatalog, createMcpSchemaHash, InMemoryMcpToolCatalogCache } from "../server/toolCatalog"
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

function registry(): McpSourceRegistry {
  return {
    async listSources(requestActor) {
      return requestActor.userId === source.userId && requestActor.workspaceId === source.workspaceId ? [source] : []
    },
    async getSource(sourceId) {
      return sourceId === source.id ? source : undefined
    },
  }
}

function transport(tools: McpDiscoveredTool[]): McpTransportClient {
  return {
    listTools: vi.fn(async () => tools),
    listResources: vi.fn(async () => []),
    readResource: vi.fn(),
    callTool: vi.fn(),
  }
}

const readonlySearch = {
  name: "NOTION_SEARCH_NOTION_PAGE",
  description: "Search Notion pages",
  inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
}

describe("boring-mcp tool catalog", () => {
  it("searches normalized tool entries from a fake connector probe", async () => {
    const tx = transport([readonlySearch, { name: "update_page", inputSchema: { type: "object" } }])
    const catalog = createBoringMcpToolCatalog({ registry: registry(), transport: tx })

    const result = await catalog.searchTools(actor, { query: "search" })

    expect(result.tools).toEqual([
      expect.objectContaining({
        sourceId: source.id,
        provider: "notion",
        toolName: "NOTION_SEARCH_NOTION_PAGE",
        enabled: true,
        risk: "read",
        blockedReasons: [],
        schemaHash: createMcpSchemaHash(readonlySearch.inputSchema),
      }),
    ])
    expect(tx.callTool).not.toHaveBeenCalled()
    expect(tx.listResources).not.toHaveBeenCalled()
  })

  it("does not serve cached tools after a source is disconnected", async () => {
    let currentSource = source
    const dynamicRegistry: McpSourceRegistry = {
      async listSources() {
        return [currentSource]
      },
      async getSource(sourceId) {
        return sourceId === currentSource.id ? currentSource : undefined
      },
    }
    const catalog = createBoringMcpToolCatalog({ registry: dynamicRegistry, transport: transport([readonlySearch]) })

    await expect(catalog.searchTools(actor, { sourceId: source.id })).resolves.toMatchObject({ tools: [expect.objectContaining({ toolName: "NOTION_SEARCH_NOTION_PAGE" })] })
    currentSource = { ...source, status: "unconfigured" }

    await expect(catalog.searchTools(actor, { sourceId: source.id })).rejects.toMatchObject({ code: MCP_ERROR_CODES.SOURCE_UNAVAILABLE })
  })

  it("does not serve cached tools after a same-id source reconnects", async () => {
    let currentSource: McpSource = { ...source, updatedAt: "2026-07-01T00:00:00.000Z", connectorRef: { provider: "notion", sessionId: "session-1" } }
    const dynamicRegistry: McpSourceRegistry = {
      async listSources() {
        return [currentSource]
      },
      async getSource(sourceId) {
        return sourceId === currentSource.id ? currentSource : undefined
      },
    }
    const tx = transport([readonlySearch])
    const catalog = createBoringMcpToolCatalog({ registry: dynamicRegistry, transport: tx })

    await expect(catalog.searchTools(actor, { sourceId: source.id })).resolves.toMatchObject({ tools: [expect.objectContaining({ toolName: "NOTION_SEARCH_NOTION_PAGE" })] })
    tx.listTools = vi.fn(async () => [{ name: "NOTION_GET_PAGE_MARKDOWN", inputSchema: { type: "object" } }])
    currentSource = { ...currentSource, updatedAt: "2026-07-01T00:01:00.000Z", connectorRef: { provider: "notion", sessionId: "session-2" } }

    await expect(catalog.searchTools(actor, { sourceId: source.id })).resolves.toMatchObject({ tools: [expect.objectContaining({ toolName: "NOTION_GET_PAGE_MARKDOWN" })] })
  })

  it("uses the registry-resolved source id in catalog DTOs", async () => {
    const legacySourceId = "managed:workspace-1:user-1:notion"
    const resolvingRegistry: McpSourceRegistry = {
      async listSources() {
        return [source]
      },
      async getSource(sourceId) {
        return sourceId === legacySourceId || sourceId === source.id ? source : undefined
      },
    }
    const catalog = createBoringMcpToolCatalog({ registry: resolvingRegistry, transport: transport([readonlySearch]) })

    const result = await catalog.searchTools(actor, { sourceId: legacySourceId })

    expect(result.tools).toEqual([expect.objectContaining({ sourceId: source.id, toolName: "NOTION_SEARCH_NOTION_PAGE" })])
    expect(JSON.stringify(result)).not.toContain(legacySourceId)
  })

  it("bypasses the local catalog cache when providerRefresh is requested", async () => {
    const tx = transport([readonlySearch])
    const catalog = createBoringMcpToolCatalog({ registry: registry(), transport: tx })

    await expect(catalog.searchTools(actor, { sourceId: source.id })).resolves.toMatchObject({ tools: [expect.objectContaining({ toolName: "NOTION_SEARCH_NOTION_PAGE" })] })
    tx.listTools = vi.fn(async (_source, options) => {
      expect(options).toEqual({ forceProviderRefresh: true })
      return [{ name: "NOTION_GET_PAGE_MARKDOWN", inputSchema: { type: "object" } }]
    })

    await expect(catalog.searchTools(actor, { sourceId: source.id, providerRefresh: true })).resolves.toMatchObject({ tools: [expect.objectContaining({ toolName: "NOTION_GET_PAGE_MARKDOWN" })] })
    expect(tx.listTools).toHaveBeenCalledTimes(1)
  })

  it("describes exact schema and safety notes for a tool", async () => {
    const catalog = createBoringMcpToolCatalog({ registry: registry(), transport: transport([readonlySearch]) })

    const result = await catalog.describeTool(actor, { sourceId: source.id, toolName: "NOTION_SEARCH_NOTION_PAGE" })

    expect(result.schemaDrifted).toBe(false)
    expect(result.tool).toMatchObject({
      toolName: "NOTION_SEARCH_NOTION_PAGE",
      summary: "Search Notion pages",
      inputSchema: readonlySearch.inputSchema,
      enabled: true,
      blockedReasons: [],
      nativeRef: { provider: "notion", action: "NOTION_SEARCH_NOTION_PAGE" },
    })
  })

  it("disables mutating and unknown tools by default with blocked reasons", async () => {
    const catalog = createBoringMcpToolCatalog({ registry: registry(), transport: transport([
      { name: "update_page", description: "Update page" },
      { name: "NOTION_LIST_DATABASES", description: "Unknown read-like action" },
    ]) })

    const result = await catalog.searchTools(actor)

    expect(result.tools).toEqual([
      expect.objectContaining({ toolName: "update_page", enabled: false, risk: "write", blockedReasons: ["Tool matches a denied write/admin pattern"] }),
      expect.objectContaining({ toolName: "NOTION_LIST_DATABASES", enabled: false, risk: "unknown", blockedReasons: ["Tool is not on the read-only allowlist"] }),
    ])
  })

  it("detects schema drift when input schemas change", async () => {
    const firstSchema = { type: "object", properties: { query: { type: "string" } } }
    const secondSchema = { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } } }
    const tx = transport([{ name: "NOTION_SEARCH_NOTION_PAGE", inputSchema: firstSchema }])
    const cache = new InMemoryMcpToolCatalogCache()
    const catalog = createBoringMcpToolCatalog({ registry: registry(), transport: tx, cache })
    const first = await catalog.describeTool(actor, { sourceId: source.id, toolName: "NOTION_SEARCH_NOTION_PAGE" })
    tx.listTools = vi.fn(async () => [{ name: "NOTION_SEARCH_NOTION_PAGE", inputSchema: secondSchema }])

    const second = await catalog.describeTool(actor, { sourceId: source.id, toolName: "NOTION_SEARCH_NOTION_PAGE", expectedSchemaHash: first.tool.schemaHash, refresh: true })

    expect(second.tool.schemaHash).not.toBe(first.tool.schemaHash)
    expect(second.schemaDrifted).toBe(true)
  })

  it("rejects secret-like tool metadata before returning catalog DTOs", async () => {
    const catalog = createBoringMcpToolCatalog({ registry: registry(), transport: transport([
      { name: "NOTION_SEARCH_NOTION_PAGE", description: "access_token=abcdefghijklmnop" },
    ]) })

    await expect(catalog.searchTools(actor)).rejects.toMatchObject({ code: MCP_ERROR_CODES.SECRET_LEAK_GUARD })
  })
})
