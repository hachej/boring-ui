import { describe, expect, it, vi } from "vitest"
import {
  AIRTABLE_MCP_TEMPLATE,
  DEFAULT_MCP_PROVIDER_TEMPLATES,
  MCP_ERROR_CODES,
  McpAccessFacade,
  McpError,
  NOTION_MCP_TEMPLATE,
  assertMcpToolAllowed,
  classifyMcpTool,
  containsMcpSecret,
  containsMcpSecretOrCanary,
  createUserRegisteredMcpProviderTemplate,
  doctorMcpSource,
  getMcpProviderTemplate,
  redactMcpSecrets,
  toMcpSourceDto,
  validateUserRegisteredMcpEndpoint,
  type McpActor,
  type McpSource,
  type McpSourceStore,
  type McpTransportClient,
  type McpUserRegisteredSourceConfig,
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

  it("detects MCP secrets or seeded redaction canaries through the shared guard", () => {
    expect(containsMcpSecretOrCanary({ nested: { value: "MCP_CANARY_DO_NOT_LEAK" } }, ["MCP_CANARY_DO_NOT_LEAK", ""])).toBe(true)
    expect(containsMcpSecretOrCanary({ "MCP_CANARY_DO_NOT_LEAK": "key hit" }, ["MCP_CANARY_DO_NOT_LEAK"])).toBe(true)
    expect(containsMcpSecretOrCanary({ nested: { authorization: "Bearer abcdefghijklmnop" } }, ["MCP_CANARY_DO_NOT_LEAK"])).toBe(true)
    expect(containsMcpSecretOrCanary({ nested: { value: "safe" } }, ["MCP_CANARY_DO_NOT_LEAK", ""])).toBe(false)
  })

  it("omits server-only connector refs from public source DTOs", () => {
    const dto = toMcpSourceDto({
      ...notionSource,
      credentialProvider: "composio-managed",
      connectorRef: { provider: "notion", toolkitId: "notion", sessionId: "server-only-session", connectedAccountId: "account-1" },
    })

    expect(dto).not.toHaveProperty("connectorRef")
    expect(JSON.stringify(dto)).not.toContain("server-only-session")
    expect(JSON.stringify(dto)).not.toContain("account-1")
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

  it("blocks unowned sources before transport execution", async () => {
    const transport: McpTransportClient = {
      listTools: vi.fn(async () => []),
      listResources: vi.fn(async () => []),
      readResource: vi.fn(),
      callTool: vi.fn(async () => ({ content: "ok" })),
    }
    const facade = new McpAccessFacade({ store: makeStore(), transport })
    await expect(facade.probeSource({ ...actor, userId: "other" }, notionSource.id)).rejects.toMatchObject({ code: MCP_ERROR_CODES.SOURCE_NOT_FOUND })
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

})

describe("user-registered MCP source type", () => {
  const baseConfig: McpUserRegisteredSourceConfig = {
    enabled: true,
    endpoint: "https://mcp.example.com/stream",
    displayName: "Example MCP",
  }

  it("does not add entries to the default provider template list", () => {
    expect(DEFAULT_MCP_PROVIDER_TEMPLATES).toEqual([NOTION_MCP_TEMPLATE, AIRTABLE_MCP_TEMPLATE])
    expect(getMcpProviderTemplate("user-registered")).toBeUndefined()
  })

  it("leaves the two existing hardcoded providers unchanged", () => {
    expect(getMcpProviderTemplate("notion")).toBe(NOTION_MCP_TEMPLATE)
    expect(getMcpProviderTemplate("airtable")).toBe(AIRTABLE_MCP_TEMPLATE)
  })

  it("builds a valid template for an enabled, well-formed endpoint", () => {
    const template = createUserRegisteredMcpProviderTemplate(baseConfig)
    expect(template.id).toBe("user-registered")
    expect(template.transport).toBe("streamable-http")
    expect(template.endpoint).toBe("https://mcp.example.com/stream")
  })

  it("default-denies when not explicitly enabled", () => {
    expect(() => createUserRegisteredMcpProviderTemplate({ ...baseConfig, enabled: false })).toThrow(McpError)
    try {
      createUserRegisteredMcpProviderTemplate({ ...baseConfig, enabled: false })
    } catch (error) {
      expect((error as McpError).code).toBe(MCP_ERROR_CODES.USER_REGISTERED_SOURCE_DISABLED)
    }
  })

  it("accepts a valid https endpoint", () => {
    expect(validateUserRegisteredMcpEndpoint("https://mcp.example.com/stream").hostname).toBe("mcp.example.com")
  })

  it.each([
    ["http (non-https)", "http://mcp.example.com/stream", MCP_ERROR_CODES.USER_REGISTERED_ENDPOINT_SCHEME_INVALID],
    ["unparseable URL", "not-a-url", MCP_ERROR_CODES.USER_REGISTERED_ENDPOINT_SCHEME_INVALID],
    ["non-streamable-http scheme", "wss://mcp.example.com/stream", MCP_ERROR_CODES.USER_REGISTERED_ENDPOINT_SCHEME_INVALID],
    ["loopback hostname", "https://localhost/stream", MCP_ERROR_CODES.USER_REGISTERED_ENDPOINT_HOST_BLOCKED],
    ["loopback IPv4", "https://127.0.0.1/stream", MCP_ERROR_CODES.USER_REGISTERED_ENDPOINT_HOST_BLOCKED],
    ["loopback IPv6", "https://[::1]/stream", MCP_ERROR_CODES.USER_REGISTERED_ENDPOINT_HOST_BLOCKED],
    ["link-local", "https://169.254.1.5/stream", MCP_ERROR_CODES.USER_REGISTERED_ENDPOINT_HOST_BLOCKED],
    ["cloud metadata service", "https://169.254.169.254/latest/meta-data", MCP_ERROR_CODES.USER_REGISTERED_ENDPOINT_HOST_BLOCKED],
    ["private 10.x", "https://10.0.0.5/stream", MCP_ERROR_CODES.USER_REGISTERED_ENDPOINT_HOST_BLOCKED],
    ["private 192.168.x", "https://192.168.1.1/stream", MCP_ERROR_CODES.USER_REGISTERED_ENDPOINT_HOST_BLOCKED],
    [".internal suffix", "https://svc.internal/stream", MCP_ERROR_CODES.USER_REGISTERED_ENDPOINT_HOST_BLOCKED],
    ["credentials in URL", "https://user:pass@mcp.example.com/stream", MCP_ERROR_CODES.USER_REGISTERED_ENDPOINT_CREDENTIALS_INVALID],
  ])("rejects %s", (_label, endpoint, expectedCode) => {
    expect(() => validateUserRegisteredMcpEndpoint(endpoint)).toThrow(McpError)
    try {
      validateUserRegisteredMcpEndpoint(endpoint)
    } catch (error) {
      expect((error as McpError).code).toBe(expectedCode)
    }
  })

  it("rejects a non-streamable-http transport even with a valid https endpoint", () => {
    expect(() =>
      validateUserRegisteredMcpEndpoint("https://mcp.example.com/stream", "sse" as never),
    ).toThrowError(expect.objectContaining({ code: MCP_ERROR_CODES.USER_REGISTERED_ENDPOINT_TRANSPORT_INVALID }))
  })

  it("propagates endpoint validation failures through the template builder", () => {
    expect(() =>
      createUserRegisteredMcpProviderTemplate({ ...baseConfig, endpoint: "https://localhost/stream" }),
    ).toThrowError(expect.objectContaining({ code: MCP_ERROR_CODES.USER_REGISTERED_ENDPOINT_HOST_BLOCKED }))
  })

  it("defaults denied tools to the same write/admin patterns as curated templates when unspecified", () => {
    const template = createUserRegisteredMcpProviderTemplate(baseConfig)
    expect(template.deniedTools).toEqual(["create_*", "update_*", "delete_*", "publish_*", "admin_*"])
  })
})
