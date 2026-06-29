import { describe, expect, it, vi } from "vitest"
import {
  AIRTABLE_MCP_TEMPLATE,
  MCP_ERROR_CODES,
  McpAccessFacade,
  McpError,
  NOTION_MCP_TEMPLATE,
  assertMcpToolAllowed,
  classifyMcpTool,
  containsMcpSecret,
  doctorMcpSource,
  redactMcpSecrets,
  type McpActor,
  type McpSource,
  type McpSourceStore,
  type McpTransportClient,
} from "../shared"

const actor: McpActor = { userId: "user-1", workspaceId: "workspace-1" }
const notionSource: McpSource = {
  id: "source-1",
  workspaceId: actor.workspaceId,
  userId: actor.userId,
  provider: "notion",
  displayName: "Notion",
  status: "connected",
  ownerKind: "user",
  credentialProvider: "provider-managed",
}

function makeStore(source: McpSource = notionSource): McpSourceStore {
  return {
    async listSources(requestActor) {
      return requestActor.userId === source.userId && requestActor.workspaceId === source.workspaceId ? [source] : []
    },
    async getSource(sourceId) {
      return sourceId === source.id ? source : undefined
    },
  }
}

describe("boring-mcp shared policy", () => {
  it("allows only read allowlisted tools and denies mutating patterns", () => {
    expect(classifyMcpTool(NOTION_MCP_TEMPLATE, "NOTION_SEARCH_NOTION_PAGE")).toMatchObject({ allowed: true, risk: "read" })
    expect(classifyMcpTool(AIRTABLE_MCP_TEMPLATE, "create_record")).toMatchObject({ allowed: false, risk: "write" })
    expect(() => assertMcpToolAllowed(AIRTABLE_MCP_TEMPLATE, "surprise_tool")).toThrow(McpError)
  })

  it("redacts secret-like keys and all secret-like values", () => {
    const value = {
      ok: true,
      authorization: "Bearer secret-token",
      nested: { text: "Bearer abcdefghijklmnop and sk-abcdefghijklmnop and x-api-key: abcdefghijklmnop" },
    }
    expect(containsMcpSecret(value)).toBe(true)
    expect(redactMcpSecrets(value)).toEqual({
      ok: true,
      authorization: "[REDACTED_MCP_SECRET]",
      nested: { text: "[REDACTED_MCP_SECRET] and [REDACTED_MCP_SECRET] and [REDACTED_MCP_SECRET]" },
    })
  })

  it("reports disconnected and unknown sources in doctor output", () => {
    expect(doctorMcpSource({ ...notionSource, status: "unconfigured" }).issues).toContainEqual(expect.objectContaining({ code: MCP_ERROR_CODES.SOURCE_UNAVAILABLE }))
    expect(doctorMcpSource({ ...notionSource, provider: "unknown" }).issues).toContainEqual(expect.objectContaining({ code: MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID }))
  })
})

describe("McpAccessFacade", () => {
  it("probes tools through fake transport and classifies them", async () => {
    const transport: McpTransportClient = {
      listTools: vi.fn(async () => [{ name: "NOTION_SEARCH_NOTION_PAGE" }, { name: "update_page" }]),
      listResources: vi.fn(async () => []),
      readResource: vi.fn(),
      callTool: vi.fn(),
    }
    const facade = new McpAccessFacade({ store: makeStore(), transport })
    const result = await facade.probeSource(actor, notionSource.id)
    expect(result.tools).toEqual([
      expect.objectContaining({ name: "NOTION_SEARCH_NOTION_PAGE", decision: expect.objectContaining({ allowed: true }) }),
      expect.objectContaining({ name: "update_page", decision: expect.objectContaining({ allowed: false }) }),
    ])
  })

  it("blocks unowned sources and mutating calls before transport execution", async () => {
    const transport: McpTransportClient = {
      listTools: vi.fn(async () => []),
      listResources: vi.fn(async () => []),
      readResource: vi.fn(),
      callTool: vi.fn(async () => ({ content: "ok" })),
    }
    const facade = new McpAccessFacade({ store: makeStore(), transport })
    await expect(facade.probeSource({ ...actor, userId: "other" }, notionSource.id)).rejects.toMatchObject({ code: MCP_ERROR_CODES.SOURCE_NOT_FOUND })
    await expect(facade.callReadonlyTool(actor, notionSource.id, "update_page", {})).rejects.toMatchObject({ code: MCP_ERROR_CODES.TOOL_NOT_ALLOWED })
    expect(transport.listTools).not.toHaveBeenCalled()
    expect(transport.callTool).not.toHaveBeenCalled()
  })

  it("blocks unavailable sources before transport execution", async () => {
    const transport: McpTransportClient = {
      listTools: vi.fn(async () => []),
      listResources: vi.fn(async () => []),
      readResource: vi.fn(),
      callTool: vi.fn(async () => ({ content: "ok" })),
    }
    const facade = new McpAccessFacade({ store: makeStore({ ...notionSource, status: "expired" }), transport })
    await expect(facade.probeSource(actor, notionSource.id)).rejects.toMatchObject({ code: MCP_ERROR_CODES.SOURCE_UNAVAILABLE })
    await expect(facade.callReadonlyTool(actor, notionSource.id, "NOTION_SEARCH_NOTION_PAGE", {})).rejects.toMatchObject({ code: MCP_ERROR_CODES.SOURCE_UNAVAILABLE })
    expect(transport.listTools).not.toHaveBeenCalled()
    expect(transport.listResources).not.toHaveBeenCalled()
    expect(transport.callTool).not.toHaveBeenCalled()
  })

  it("requires an explicit access policy for non-user-owned sources", async () => {
    const teamSource: McpSource = { ...notionSource, ownerKind: "team_context", userId: "team-owner" }
    const store: McpSourceStore = {
      async listSources() { return [teamSource] },
      async getSource(sourceId) { return sourceId === teamSource.id ? teamSource : undefined },
    }
    const transport: McpTransportClient = {
      listTools: vi.fn(async () => []),
      listResources: vi.fn(async () => []),
      readResource: vi.fn(),
      callTool: vi.fn(async () => ({ content: "ok" })),
    }
    const defaultFacade = new McpAccessFacade({ store, transport })
    expect(await defaultFacade.listSources(actor)).toEqual([])
    await expect(defaultFacade.probeSource(actor, teamSource.id)).rejects.toMatchObject({ code: MCP_ERROR_CODES.SOURCE_NOT_FOUND })

    const policyFacade = new McpAccessFacade({
      store,
      transport,
      accessPolicy: { canAccessSource: (requestActor, source) => requestActor.workspaceId === source.workspaceId && source.ownerKind === "team_context" },
    })
    expect(await policyFacade.listSources(actor)).toEqual([teamSource])
    await expect(policyFacade.probeSource(actor, teamSource.id)).resolves.toMatchObject({ sourceId: teamSource.id })
  })

  it("rejects provider responses that look like secrets", async () => {
    const transport: McpTransportClient = {
      listTools: vi.fn(async () => []),
      listResources: vi.fn(async () => []),
      readResource: vi.fn(),
      callTool: vi.fn(async () => ({ content: { access_token: "secret" } })),
    }
    const facade = new McpAccessFacade({ store: makeStore(), transport })
    await expect(facade.callReadonlyTool(actor, notionSource.id, "NOTION_SEARCH_NOTION_PAGE", {})).rejects.toMatchObject({ code: MCP_ERROR_CODES.SECRET_LEAK_GUARD })
  })
})
