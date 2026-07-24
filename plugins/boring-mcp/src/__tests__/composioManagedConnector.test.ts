import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { AddressInfo } from "node:net"
import { afterEach, describe, expect, it, vi } from "vitest"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { createBoringMcpAgentBridgeRegistry } from "../server/agentBridge"
import {
  createComposioManagedConnectorProvider,
  createComposioMcpAdapter,
  createComposioMcpTransport,
  requireExactlyOneComposioConnectedAccount,
  resolveComposioMcpSession,
} from "../server/composioManagedConnector"
import { createManagedConnectorAdapter, type ManagedConnectorConfig, type ManagedConnectorDefinition, type ManagedConnectorSecretResolver, type ManagedConnectorSourceRegistry } from "../server/managedConnectorAdapter"
import type { ManagedConnectorPreflightEvidence } from "../server/managedConnectorPreflight"
import { createBoringMcpSourceHandlers } from "../server/sourceHandlers"
import { MCP_ERROR_CODES, type McpActor, type McpSource } from "../shared"

const actor: McpActor = { userId: "user-1", workspaceId: "workspace-1" }
const config: ManagedConnectorConfig = {
  provider: "notion",
  displayName: "Notion",
  toolkitId: "notion",
  connectUrlOrigins: ["https://app.composio.dev"],
}
const fullCatalogConfig: ManagedConnectorDefinition = {
  mode: "catalog",
  provider: "composio",
  displayName: "Composio",
  connectUrlOrigins: ["https://app.composio.dev"],
}
const secretResolver: ManagedConnectorSecretResolver = {
  resolveSecret: vi.fn(async () => ({ storage: "server-env" as const, value: "cmp_test_key" })),
}
const activeNotionAccount = {
  id: "account-1",
  user_id: "workspace-1:user-1",
  status: "ACTIVE",
  is_disabled: false,
  toolkit: { slug: "notion" },
  alias: "Demo Notion",
}
const preflightEvidence: ManagedConnectorPreflightEvidence = {
  connectorName: "Composio managed MCP",
  isolatedTestProject: true,
  apiKeyStorage: "server-env",
  browserDtoSamples: [{ status: "unconfigured", provider: "notion" }],
  redactedLogSamples: [{ message: "configured [REDACTED_MCP_SECRET]" }],
  redactedProviderResultSamples: [{ content: "ok" }],
  redactionCanaries: ["COMPOSIO_CANARY"],
  revokeDisconnectVerified: true,
  connectedAccountStatusVerified: true,
  vendorRisk: {
    dpaStatus: "approved",
    subprocessorStatus: "approved",
    dataResidencyStatus: "approved",
    incidentHistoryStatus: "approved",
  },
}

const servers: Array<{ close: () => Promise<void> }> = []

function createRegistry(): ManagedConnectorSourceRegistry {
  const sources = new Map<string, McpSource>()
  return {
    async listSources(requestActor) {
      return [...sources.values()].filter((source) => source.workspaceId === requestActor.workspaceId && source.userId === requestActor.userId)
    },
    async getSource(sourceId) {
      return sources.get(sourceId)
    },
    async upsertSource(_actor, source) {
      sources.set(source.id, source)
      return source
    },
    async disconnectSource(requestActor, sourceId) {
      const source = sources.get(sourceId)
      if (!source || source.workspaceId !== requestActor.workspaceId || source.userId !== requestActor.userId) return undefined
      const next = { ...source, status: "revoked" as const }
      sources.set(sourceId, next)
      return next
    },
  }
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } })
}

function createComposioFetch(mcpUrl = "https://backend.composio.dev/mcp/session", accounts: unknown[] = [], deleteStatus = 200) {
  let sessionCount = 0
  let currentAccounts = [...accounts]
  const fakeFetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    expect(init?.headers).toMatchObject({ "x-api-key": "cmp_test_key" })
    const url = String(input)
    if (url.includes("/api/v3.1/connected_accounts?")) {
      expect(init?.method).toBe("GET")
      expect(url).toContain("user_id=workspace-1%3Auser-1")
      expect(url).toContain("toolkit_slug=notion")
      return jsonResponse({ items: currentAccounts })
    }
    if (url.includes("/api/v3.1/connected_accounts/") && init?.method === "DELETE") {
      const accountId = decodeURIComponent(url.split("/").at(-1) ?? "")
      if (deleteStatus < 400 || deleteStatus === 404) {
        currentAccounts = currentAccounts.filter((account) => {
          const value = account as { id?: unknown }
          return value.id !== accountId
        })
      }
      return jsonResponse({ deleted: deleteStatus < 400 }, deleteStatus)
    }
    if (url.endsWith("/api/v3.1/tool_router/session")) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body).toMatchObject({
        user_id: "workspace-1:user-1",
        mcp: true,
        manage_connections: { enable: true, enable_wait_for_connections: false },
        workbench: { enable: false },
      })
      sessionCount += 1
      return jsonResponse({
        id: `session-${sessionCount}`,
        mcp: { url: mcpUrl, headers: { "x-composio-mcp-session": `server-only-session-${sessionCount}` } },
        config: {
          toolkits: body.toolkits,
          connected_accounts: body.connected_accounts,
          workbench: body.workbench,
        },
      })
    }
    if (/\/api\/v3\/tool_router\/session\/session-\d+\/link$/.test(url)) {
      expect(JSON.parse(String(init?.body))).toMatchObject({ toolkit: "notion" })
      return jsonResponse({ redirect_url: "https://app.composio.dev/connect/session-1" })
    }
    return jsonResponse({ error: "not found" }, 404)
  }) as typeof fetch & ReturnType<typeof vi.fn>
  return fakeFetch
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined
}

function createFakeMcpServer(seenHeaders: string[], description = "Search pages", toolText = "composio mcp ok") {
  const server = new McpServer({ name: "composio-fake-mcp", version: "1.0.0" })
  server.registerTool("NOTION_SEARCH_NOTION_PAGE", { description }, async () => ({ content: [{ type: "text", text: toolText }] }))
  server.registerTool("COMPOSIO_MANAGE_CONNECTIONS", { description: "Raw meta tool must stay hidden" }, async () => ({ content: [{ type: "text", text: "hidden" }] }))
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url !== "/mcp" || req.method !== "POST") {
      res.statusCode = 404
      res.end("not found")
      return
    }
    seenHeaders.push(String(req.headers["x-composio-mcp-session"] ?? ""))
    seenHeaders.push(String(req.headers["x-api-key"] ?? ""))
    const body = await readJson(req)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on("close", () => void transport.close())
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
  })
}

async function listenFakeMcpServer(description?: string, toolText?: string) {
  const seenHeaders: string[] = []
  const httpServer = createFakeMcpServer(seenHeaders, description, toolText)
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve))
  const { port } = httpServer.address() as AddressInfo
  const close = () => new Promise<void>((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()))
  servers.push({ close })
  return { url: `http://127.0.0.1:${port}/mcp`, seenHeaders }
}

function createFakeComposioMetaMcpServer(seenHeaders: string[], seenToolCalls: string[], seenToolArguments: unknown[], schemaToolkit?: string) {
  const server = new McpServer({ name: "composio-meta-fake-mcp", version: "1.0.0" })
  server.registerTool("COMPOSIO_SEARCH_TOOLS", { description: "Search provider tools" }, async () => ({
    content: [{ type: "text", text: JSON.stringify({ data: { results: [{ toolkits: ["notion"], primary_tool_slugs: ["NOTION_SEARCH_NOTION_PAGE"], related_tool_slugs: ["NOTION_GET_PAGE_MARKDOWN", "COMPOSIO_MANAGE_CONNECTIONS"] }] } }) }],
  }))
  server.registerTool("COMPOSIO_GET_TOOL_SCHEMAS", { description: "Get provider tool schemas" }, async () => ({
    content: [{ type: "text", text: JSON.stringify({ data: { success: true, tool_schemas: {
      NOTION_SEARCH_NOTION_PAGE: { tool_slug: "NOTION_SEARCH_NOTION_PAGE", toolkit_slug: schemaToolkit, description: "Search pages", input_schema: { type: "object", properties: { query: { type: "string" } } } },
      NOTION_GET_PAGE_MARKDOWN: { tool_slug: "NOTION_GET_PAGE_MARKDOWN", description: "Read page markdown", input_schema: { type: "object", properties: { page_id: { type: "string" } } } },
      NOTION_RETRIEVE_PAGE: { tool_slug: "NOTION_RETRIEVE_PAGE", description: "Retrieve page", input_schema: { type: "object", properties: { page_id: { type: "string" } } } },
    } } }) }],
  }))
  server.registerTool("COMPOSIO_MULTI_EXECUTE_TOOL", { description: "Execute provider tools" }, async () => ({ content: [{ type: "text", text: "meta execute ok" }] }))
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url !== "/mcp" || req.method !== "POST") {
      res.statusCode = 404
      res.end("not found")
      return
    }
    seenHeaders.push(String(req.headers["x-composio-mcp-session"] ?? ""))
    seenHeaders.push(String(req.headers["x-api-key"] ?? ""))
    const body = await readJson(req)
    for (const message of Array.isArray(body) ? body : [body]) {
      if (message && typeof message === "object" && (message as { method?: unknown }).method === "tools/call") {
        const params = (message as { params?: { name?: unknown; arguments?: unknown } }).params
        if (typeof params?.name === "string") {
          seenToolCalls.push(params.name)
          seenToolArguments.push(params.arguments)
        }
      }
    }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on("close", () => void transport.close())
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
  })
}

async function listenFakeComposioMetaMcpServer(schemaToolkit?: string) {
  const seenHeaders: string[] = []
  const seenToolCalls: string[] = []
  const seenToolArguments: unknown[] = []
  const httpServer = createFakeComposioMetaMcpServer(seenHeaders, seenToolCalls, seenToolArguments, schemaToolkit)
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve))
  const { port } = httpServer.address() as AddressInfo
  const close = () => new Promise<void>((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()))
  servers.push({ close })
  return { url: `http://127.0.0.1:${port}/mcp`, seenHeaders, seenToolCalls, seenToolArguments }
}

async function listenRedirectingMcpServer() {
  let redirectedRequests = 0
  let leakedApiKey: string | undefined
  const destination = createServer((req, res) => {
    redirectedRequests += 1
    leakedApiKey = typeof req.headers["x-api-key"] === "string" ? req.headers["x-api-key"] : undefined
    res.statusCode = 200
    res.end("{}")
  })
  await new Promise<void>((resolve) => destination.listen(0, "127.0.0.1", resolve))
  const destinationPort = (destination.address() as AddressInfo).port
  const redirect = createServer((_req, res) => {
    res.statusCode = 307
    res.setHeader("location", `http://127.0.0.1:${destinationPort}/capture`)
    res.end()
  })
  await new Promise<void>((resolve) => redirect.listen(0, "127.0.0.1", resolve))
  const redirectPort = (redirect.address() as AddressInfo).port
  const close = async () => {
    await Promise.all([
      new Promise<void>((resolve, reject) => redirect.close((error) => error ? reject(error) : resolve())),
      new Promise<void>((resolve, reject) => destination.close((error) => error ? reject(error) : resolve())),
    ])
  }
  servers.push({ close })
  return {
    url: `http://127.0.0.1:${redirectPort}/mcp`,
    redirectedRequests: () => redirectedRequests,
    leakedApiKey: () => leakedApiKey,
  }
}

afterEach(async () => {
  while (servers.length) await servers.pop()!.close()
  vi.restoreAllMocks()
})

describe("Composio managed connector provider", () => {
  it("creates a Composio MCP session and hosted connect URL through the generic adapter", async () => {
    const fetch = createComposioFetch()
    const registry = createRegistry()
    const adapter = createManagedConnectorAdapter({
      registry,
      provider: createComposioManagedConnectorProvider({ fetch }),
      secretResolver,
      configs: [config],
      preflightEvidence,
    })

    const result = await adapter.startConnect(actor, { provider: "notion" })

    expect(result.connectUrl).toBe("https://app.composio.dev/connect/session-1")
    expect(result.source).toMatchObject({ status: "unconfigured", credentialProvider: "composio-managed" })
    expect(result.source).not.toHaveProperty("connectorRef")
    expect(JSON.stringify(result.source)).not.toContain("session-1")
    expect(JSON.stringify(result)).not.toContain("cmp_test_key")
    expect(JSON.stringify(result)).not.toContain("server-only-session")

    await expect(adapter.refreshStatus(actor, result.source.id)).resolves.toMatchObject({ source: { status: "unconfigured" } })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it("verified-cleans a created Session when adapter persistence validation fails", async () => {
    const fetch = createComposioFetch()
    const registry = createRegistry()
    const adapter = createManagedConnectorAdapter({
      registry,
      provider: createComposioManagedConnectorProvider({ fetch }),
      secretResolver,
      configs: [{ ...config, connectUrlOrigins: ["https://approved.example"] }],
      preflightEvidence,
    })

    await expect(adapter.startConnect(actor, { provider: "notion" })).rejects.toMatchObject({ code: MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID })
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/session\/session-1$/), expect.objectContaining({ method: "DELETE" }))
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/session\/session-1$/), expect.objectContaining({ method: "GET" }))
  })

  it("promotes an unconfigured source to connected only after Composio reports an active connected account", async () => {
    const fetch = createComposioFetch("https://backend.composio.dev/mcp/session", [{
      id: "account-1",
      user_id: "workspace-1:user-1",
      status: "ACTIVE",
      is_disabled: false,
      toolkit: { slug: "notion" },
      alias: "Demo Notion",
    }])
    const registry = createRegistry()
    const adapter = createManagedConnectorAdapter({
      registry,
      provider: createComposioManagedConnectorProvider({ fetch }),
      secretResolver,
      configs: [config],
      preflightEvidence,
    })

    const started = await adapter.startConnect(actor, { provider: "notion" })
    const refreshed = await adapter.refreshStatus(actor, started.source.id)
    expect(refreshed).toMatchObject({ source: { status: "connected", providerAccountLabel: "Demo Notion" } })
    expect(refreshed.source).not.toHaveProperty("connectorRef")
    expect(JSON.stringify(refreshed.source)).not.toContain("account-1")

    await expect(adapter.disconnectSource(actor, started.source.id)).resolves.toMatchObject({ source: { status: "revoked" } })
    expect(fetch).toHaveBeenCalledWith("https://backend.composio.dev/api/v3.1/connected_accounts/account-1", expect.objectContaining({ method: "DELETE" }))
  })

  it("treats an already-missing Composio connected account as a successful local disconnect", async () => {
    const fetch = createComposioFetch("https://backend.composio.dev/mcp/session", [{
      id: "account-gone",
      user_id: "workspace-1:user-1",
      status: "ACTIVE",
      is_disabled: false,
      toolkit: { slug: "notion" },
    }], 404)
    const registry = createRegistry()
    const adapter = createManagedConnectorAdapter({
      registry,
      provider: createComposioManagedConnectorProvider({ fetch }),
      secretResolver,
      configs: [config],
      preflightEvidence,
    })

    const started = await adapter.startConnect(actor, { provider: "notion" })
    await adapter.refreshStatus(actor, started.source.id)

    await expect(adapter.disconnectSource(actor, started.source.id)).resolves.toMatchObject({ source: { status: "revoked" } })
    expect(fetch).toHaveBeenCalledWith("https://backend.composio.dev/api/v3.1/connected_accounts/account-gone", expect.objectContaining({ method: "DELETE" }))
  })

  it("revokes and verifies an owned inactive account instead of dropping its identity", async () => {
    const inactiveAccount = { ...activeNotionAccount, id: "account-inactive", status: "DISABLED" }
    const fetch = createComposioFetch(undefined, [inactiveAccount])
    const registry = createRegistry()
    const adapter = createManagedConnectorAdapter({
      registry,
      provider: createComposioManagedConnectorProvider({ fetch }),
      secretResolver,
      configs: [config],
      preflightEvidence,
    })

    const started = await adapter.startConnect(actor, { provider: "notion" })
    await expect(adapter.refreshStatus(actor, started.source.id)).resolves.toMatchObject({ source: { status: "unconfigured" } })
    await expect(adapter.disconnectSource(actor, started.source.id)).resolves.toMatchObject({ source: { status: "revoked" } })
    expect(fetch).toHaveBeenCalledWith("https://backend.composio.dev/api/v3.1/connected_accounts/account-inactive", expect.objectContaining({ method: "DELETE" }))
  })

  it("rejects non-HTTPS Composio MCP session URLs unless using the loopback-only test override", async () => {
    const fetch = createComposioFetch("http://evil.example/mcp")
    const provider = createComposioManagedConnectorProvider({ fetch })

    await expect(provider.probe({
      actor,
      config: fullCatalogConfig,
      secret: { storage: "server-env", value: "cmp_test_key" },
      source: {} as McpSource,
    })).rejects.toMatchObject({ code: MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID })
  })

  it("rejects unapproved Composio API and MCP origins before secret egress", async () => {
    const apiFetch = vi.fn(async () => jsonResponse({})) as typeof fetch & ReturnType<typeof vi.fn>
    await expect(resolveComposioMcpSession({ fetch: apiFetch, apiBaseUrl: "https://unapproved.example" }, {
      actor,
      config: fullCatalogConfig,
      secret: { storage: "server-env", value: "cmp_test_key" },
    })).rejects.toMatchObject({ code: MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID })
    expect(apiFetch).not.toHaveBeenCalled()

    const mcpFetch = createComposioFetch("https://unapproved.example/mcp")
    await expect(resolveComposioMcpSession({ fetch: mcpFetch }, {
      actor,
      config: fullCatalogConfig,
      secret: { storage: "server-env", value: "cmp_test_key" },
    })).rejects.toMatchObject({ code: MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID })

    await expect(resolveComposioMcpSession({ fetch: createComposioFetch("https://tenant-composio.example/mcp") }, {
      actor,
      config: { ...fullCatalogConfig, mcpUrlOrigins: ["https://tenant-composio.example"] },
      secret: { storage: "server-env", value: "cmp_test_key" },
    })).resolves.toMatchObject({ mcp: { url: "https://tenant-composio.example/mcp" } })
  })

  it("rejects MCP redirects before the operator key can cross to another destination", async () => {
    const redirect = await listenRedirectingMcpServer()
    const source: McpSource = {
      id: "managed:workspace-1:user-1:composio",
      workspaceId: actor.workspaceId,
      userId: actor.userId,
      provider: "composio",
      displayName: "Composio",
      status: "connected",
      ownerKind: "user",
      credentialProvider: "composio-managed",
    }
    const composio = createComposioMcpAdapter({
      fetch: createComposioFetch(redirect.url),
      secretResolver,
      configs: [fullCatalogConfig],
      allowInsecureMcpUrlsForTests: true,
    })

    await expect(composio.transport.listTools(source)).rejects.toMatchObject({ code: MCP_ERROR_CODES.PROVIDER_ERROR })
    expect(redirect.redirectedRequests()).toBe(0)
    expect(redirect.leakedApiKey()).toBeUndefined()
  })

  it("redacts exact operator-key echoes from MCP transport failures", async () => {
    const source: McpSource = {
      id: "managed:workspace-1:user-1:composio",
      workspaceId: actor.workspaceId,
      userId: actor.userId,
      provider: "composio",
      displayName: "Composio",
      status: "connected",
      ownerKind: "user",
      credentialProvider: "composio-managed",
    }
    const mcpFetch = vi.fn(async () => { throw new Error("cmp_test_key") }) as typeof globalThis.fetch & ReturnType<typeof vi.fn>
    const composio = createComposioMcpAdapter({ fetch: createComposioFetch(), mcpFetch, secretResolver, configs: [fullCatalogConfig] })

    const error = await composio.transport.listTools(source).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: MCP_ERROR_CODES.PROVIDER_ERROR })
    expect(JSON.stringify(error)).not.toContain("cmp_test_key")
  })

  it("rejects incomplete connected-account pages and malformed Session security echoes", async () => {
    const secret = { storage: "server-env" as const, value: "cmp_test_key" }
    const fullPage = Array.from({ length: 100 }, (_, index) => ({
      ...activeNotionAccount,
      id: `account-${index}`,
      status: index === 0 ? "ACTIVE" : "DISABLED",
    }))
    await expect(requireExactlyOneComposioConnectedAccount({ fetch: createComposioFetch(undefined, fullPage) }, { actor, secret, toolkitId: "notion" }))
      .rejects.toMatchObject({ code: MCP_ERROR_CODES.PROVIDER_ERROR })
    await expect(requireExactlyOneComposioConnectedAccount({ fetch: createComposioFetch(undefined, [{ ...activeNotionAccount, id: undefined }]) }, { actor, secret, toolkitId: "notion" }))
      .rejects.toMatchObject({ code: MCP_ERROR_CODES.PROVIDER_ERROR })
    await expect(requireExactlyOneComposioConnectedAccount({ fetch: createComposioFetch(undefined, [null]) }, { actor, secret, toolkitId: "notion" }))
      .rejects.toMatchObject({ code: MCP_ERROR_CODES.PROVIDER_ERROR })
    const malformedPageFetch = vi.fn(async () => jsonResponse({ items: [], has_more: "false" })) as typeof globalThis.fetch & ReturnType<typeof vi.fn>
    await expect(requireExactlyOneComposioConnectedAccount({ fetch: malformedPageFetch }, { actor, secret, toolkitId: "notion" }))
      .rejects.toMatchObject({ code: MCP_ERROR_CODES.PROVIDER_ERROR })

    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith("/api/v3.1/tool_router/session")) {
        return jsonResponse({
          id: "session-drifted",
          mcp: { url: "https://backend.composio.dev/mcp" },
          config: { workbench: { enable: true } },
        })
      }
      if (url.endsWith("/api/v3.1/tool_router/session/session-drifted") && init?.method === "DELETE") return new Response(undefined, { status: 204 })
      return jsonResponse({ error: "not found" }, 404)
    }) as typeof globalThis.fetch & ReturnType<typeof vi.fn>
    await expect(resolveComposioMcpSession({ fetch }, { actor, config: fullCatalogConfig, secret }))
      .rejects.toMatchObject({ code: MCP_ERROR_CODES.PROVIDER_ERROR })
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/session\/session-drifted$/), expect.objectContaining({ method: "DELETE" }))
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/session\/session-drifted$/), expect.objectContaining({ method: "GET" }))
  })

  it("redacts an exact operator-key echo from Composio error details", async () => {
    const fetch = vi.fn(async () => jsonResponse({ echo: "cmp_test_key" }, 400)) as typeof globalThis.fetch & ReturnType<typeof vi.fn>
    const error = await resolveComposioMcpSession({ fetch }, {
      actor,
      config: fullCatalogConfig,
      secret: { storage: "server-env", value: "cmp_test_key" },
    }).catch((caught: unknown) => caught)

    expect(error).toMatchObject({ code: MCP_ERROR_CODES.PROVIDER_ERROR, details: { status: 400 } })
    expect(JSON.stringify(error)).not.toContain("cmp_test_key")

    const thrownFetch = vi.fn(async () => { throw new Error("cmp_test_key") }) as typeof globalThis.fetch & ReturnType<typeof vi.fn>
    const thrown = await resolveComposioMcpSession({ fetch: thrownFetch }, {
      actor,
      config: fullCatalogConfig,
      secret: { storage: "server-env", value: "cmp_test_key" },
    }).catch((caught: unknown) => caught)
    expect(JSON.stringify(thrown)).not.toContain("cmp_test_key")
  })

  it("bounds streamed Composio API responses before buffering them", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{\"padding\":\""))
        controller.enqueue(new Uint8Array(64))
        controller.close()
      },
    })
    const fetch = vi.fn(async () => new Response(body, { status: 200 })) as typeof globalThis.fetch & ReturnType<typeof vi.fn>
    await expect(resolveComposioMcpSession({ fetch, maxResponseBytes: 32 }, {
      actor,
      config: fullCatalogConfig,
      secret: { storage: "server-env", value: "cmp_test_key" },
    })).rejects.toMatchObject({ code: MCP_ERROR_CODES.PROVIDER_ERROR })
  })

  it("keeps the Composio API timeout active while reading the response body", async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const signal = init?.signal
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const timer = setTimeout(() => {
            controller.enqueue(new TextEncoder().encode("{}"))
            controller.close()
          }, 100)
          signal?.addEventListener("abort", () => {
            clearTimeout(timer)
            controller.error(new DOMException("aborted", "AbortError"))
          }, { once: true })
        },
      })
      return new Response(body, { status: 200 })
    }) as typeof globalThis.fetch & ReturnType<typeof vi.fn>

    await expect(resolveComposioMcpSession({ fetch, requestTimeoutMs: 5 }, {
      actor,
      config: fullCatalogConfig,
      secret: { storage: "server-env", value: "cmp_test_key" },
    })).rejects.toMatchObject({ code: MCP_ERROR_CODES.PROVIDER_TIMEOUT })
  })

  it("rejects non-server Composio transport secrets before any provider request", async () => {
    const fetch = createComposioFetch()
    const transport = createComposioMcpTransport({
      fetch,
      secretResolver: { resolveSecret: vi.fn(async () => ({ storage: "browser" as never, value: "cmp_test_key" })) },
      configs: [config],
    })

    await expect(transport.listTools({
      id: "managed:workspace-1:user-1:notion",
      workspaceId: actor.workspaceId,
      userId: actor.userId,
      provider: "notion",
      displayName: "Notion",
      status: "connected",
      ownerKind: "user",
      credentialProvider: "composio-managed",
    })).rejects.toMatchObject({ code: MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID })
    expect(fetch).not.toHaveBeenCalled()
  })

  it("rejects oversized direct MCP tool metadata before catalog normalization", async () => {
    const fakeMcp = await listenFakeMcpServer("x".repeat(4_001))
    const fetch = createComposioFetch(fakeMcp.url)
    const transport = createComposioMcpTransport({ fetch, secretResolver, configs: [config], allowInsecureMcpUrlsForTests: true })
    const source: McpSource = {
      id: "managed:workspace-1:user-1:notion",
      workspaceId: actor.workspaceId,
      userId: actor.userId,
      provider: "notion",
      displayName: "Notion",
      status: "connected",
      ownerKind: "user",
      credentialProvider: "composio-managed",
    }

    await expect(transport.listTools(source)).rejects.toMatchObject({ code: MCP_ERROR_CODES.PROVIDER_ERROR })
  })

  it("uses Composio session MCP headers with the real MCP SDK transport and hides raw Composio meta tools", async () => {
    const fakeMcp = await listenFakeMcpServer()
    const fetch = createComposioFetch(fakeMcp.url, [activeNotionAccount])
    const registry = createRegistry()
    const source = await registry.upsertSource(actor, {
      id: "managed:workspace-1:user-1:notion",
      workspaceId: actor.workspaceId,
      userId: actor.userId,
      provider: "notion",
      displayName: "Notion",
      status: "connected",
      ownerKind: "user",
      credentialProvider: "composio-managed",
      connectorRef: { provider: "notion", toolkitId: "notion", sessionId: "session-1" },
    })
    const transport = createComposioMcpTransport({ fetch, secretResolver, configs: [config], allowInsecureMcpUrlsForTests: true })
    const handlers = createBoringMcpSourceHandlers({ registry, transport })
    const bridge = createBoringMcpAgentBridgeRegistry(handlers)

    await expect(bridge.mcp_tools_search.invoke({ actor }, { query: "notion" })).resolves.toMatchObject({
      tools: [expect.objectContaining({ toolName: "NOTION_SEARCH_NOTION_PAGE" })],
    })
    await expect(bridge.mcp_tools_search.invoke({ actor }, { query: "COMPOSIO" })).resolves.toMatchObject({ tools: [] })
    await expect(bridge.mcp_readonly_call.invoke({ actor }, { sourceId: source.id, toolName: "NOTION_SEARCH_NOTION_PAGE", input: {} })).resolves.toEqual({
      content: { content: [{ type: "text", text: "composio mcp ok" }] },
    })
    expect(fakeMcp.seenHeaders).toContainEqual(expect.stringContaining("server-only-session"))
    expect(fakeMcp.seenHeaders).toContain("cmp_test_key")
  })

  it("blocks exact execution-Session capabilities echoed in successful tool output", async () => {
    const fakeMcp = await listenFakeMcpServer(undefined, "server-only-session-2")
    const fetch = createComposioFetch(fakeMcp.url, [activeNotionAccount])
    const source: McpSource = {
      id: "managed:workspace-1:user-1:notion",
      workspaceId: actor.workspaceId,
      userId: actor.userId,
      provider: "notion",
      displayName: "Notion",
      status: "connected",
      ownerKind: "user",
      credentialProvider: "composio-managed",
      connectorRef: { provider: "notion", toolkitId: "notion" },
    }
    const transport = createComposioMcpTransport({ fetch, secretResolver, configs: [config], allowInsecureMcpUrlsForTests: true })

    await expect(transport.callTool(source, "NOTION_SEARCH_NOTION_PAGE", {})).rejects.toMatchObject({ code: MCP_ERROR_CODES.SECRET_LEAK_GUARD })
  })

  it("attempts verified cleanup for every cached Session when one deletion fails", async () => {
    const fakeMcp = await listenFakeMcpServer()
    const baseFetch = createComposioFetch(fakeMcp.url, [activeNotionAccount])
    const deletedSessionIds: string[] = []
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const sessionMatch = url.match(/\/api\/v3\.1\/tool_router\/session\/(session-\d+)$/)
      if (sessionMatch && init?.method === "DELETE") {
        deletedSessionIds.push(sessionMatch[1]!)
        return sessionMatch[1] === "session-1" ? jsonResponse({ error: "cleanup failed" }, 500) : new Response(undefined, { status: 204 })
      }
      if (sessionMatch && init?.method === "GET") return jsonResponse({ error: "not found" }, 404)
      return baseFetch(input as string | URL, init)
    }) as typeof globalThis.fetch & ReturnType<typeof vi.fn>
    const source: McpSource = {
      id: "managed:workspace-1:user-1:notion",
      workspaceId: actor.workspaceId,
      userId: actor.userId,
      provider: "notion",
      displayName: "Notion",
      status: "connected",
      ownerKind: "user",
      credentialProvider: "composio-managed",
      connectorRef: { provider: "notion", toolkitId: "notion" },
    }
    const composio = createComposioMcpAdapter({ fetch, secretResolver, configs: [config], allowInsecureMcpUrlsForTests: true })

    await expect(composio.transport.callTool(source, "NOTION_SEARCH_NOTION_PAGE", {})).resolves.toMatchObject({ content: expect.any(Array) })
    await expect(composio.catalog.disposeSource?.(source)).rejects.toMatchObject({ code: MCP_ERROR_CODES.PROVIDER_ERROR })
    expect(deletedSessionIds).toEqual(expect.arrayContaining(["session-1", "session-2"]))
  })

  it("supports one template-free full-catalog source and omits toolkit filters from its Session", async () => {
    const fakeMcp = await listenFakeComposioMetaMcpServer()
    const fetch = createComposioFetch(fakeMcp.url)
    const registry = createRegistry()
    const adapter = createManagedConnectorAdapter({
      registry,
      provider: createComposioManagedConnectorProvider({ fetch, allowInsecureMcpUrlsForTests: true }),
      secretResolver,
      configs: [fullCatalogConfig],
      preflightEvidence,
    })

    const started = await adapter.startConnect(actor, { provider: "composio" })
    expect(started).toMatchObject({ source: { provider: "composio", status: "connected" } })
    expect(started.connectUrl).toBeUndefined()
    await expect(adapter.refreshStatus(actor, started.source.id)).resolves.toMatchObject({ source: { status: "connected" } })
    await expect(adapter.probeSource(actor, started.source.id)).resolves.toMatchObject({ provider: "composio", tools: [] })
    const sessionCall = fetch.mock.calls.find(([url]) => String(url).endsWith("/api/v3.1/tool_router/session"))
    const body = JSON.parse(String(sessionCall?.[1]?.body)) as Record<string, unknown>
    expect(body).toMatchObject({ workbench: { enable: false }, mcp: true })
    expect(body).not.toHaveProperty("toolkits")
  })

  it("requires exactly one active owned account and preserves its exact Session pin", async () => {
    const secret = { storage: "server-env" as const, value: "cmp_test_key" }
    const twoAccounts = [activeNotionAccount, { ...activeNotionAccount, id: "account-2" }]
    await expect(requireExactlyOneComposioConnectedAccount({ fetch: createComposioFetch() }, { actor, secret, toolkitId: "notion" }))
      .rejects.toMatchObject({ code: MCP_ERROR_CODES.CONNECTED_ACCOUNT_REQUIRED })
    await expect(requireExactlyOneComposioConnectedAccount({ fetch: createComposioFetch(undefined, twoAccounts) }, { actor, secret, toolkitId: "notion" }))
      .rejects.toMatchObject({ code: MCP_ERROR_CODES.CONNECTED_ACCOUNT_CONFLICT })

    const fetch = createComposioFetch(undefined, [
      { ...activeNotionAccount, id: "other-user", user_id: "workspace-1:user-2" },
      activeNotionAccount,
    ])
    const account = await requireExactlyOneComposioConnectedAccount({ fetch }, { actor, secret, toolkitId: "notion" })
    expect(account.id).toBe("account-1")

    await resolveComposioMcpSession({ fetch }, {
      actor,
      config: fullCatalogConfig,
      secret,
      accountPin: { toolkitId: "notion", connectedAccountId: account.id },
    })
    const sessionCalls = fetch.mock.calls.filter(([url]) => String(url).endsWith("/api/v3.1/tool_router/session"))
    const body = JSON.parse(String(sessionCalls.at(-1)?.[1]?.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      workbench: { enable: false },
      connected_accounts: { notion: ["account-1"] },
    })
    expect(body).not.toHaveProperty("toolkits")
  })

  it("forwards the exact query through the managed catalog seam and keeps raw meta-tools hidden", async () => {
    const fakeMcp = await listenFakeComposioMetaMcpServer()
    const fetch = createComposioFetch(fakeMcp.url)
    const registry = createRegistry()
    const source = await registry.upsertSource(actor, {
      id: "managed:workspace-1:user-1:composio",
      workspaceId: actor.workspaceId,
      userId: actor.userId,
      provider: "composio",
      displayName: "Composio",
      status: "connected",
      ownerKind: "user",
      credentialProvider: "composio-managed",
    })
    const composio = createComposioMcpAdapter({
      fetch,
      secretResolver,
      configs: [fullCatalogConfig],
      allowInsecureMcpUrlsForTests: true,
    })
    const handlers = createBoringMcpSourceHandlers({
      registry,
      transport: composio.transport,
      managedCatalog: composio.catalog,
    })

    await expect(handlers.doctorSource(actor, source.id)).resolves.toMatchObject({ ok: true, issues: [] })
    const probe = await handlers.probeSource(actor, source.id)
    expect(probe.provider).toBe("composio")
    expect(probe.resources).toEqual([])
    expect(probe.tools[0]).toMatchObject({ name: "NOTION_SEARCH_NOTION_PAGE", decision: { allowed: false, risk: "unknown" } })
    const searched = await handlers.searchTools(actor, { sourceId: source.id, query: "github current user", limit: 1 })
    expect(searched).toMatchObject({
      tools: [expect.objectContaining({ toolName: "NOTION_SEARCH_NOTION_PAGE", enabled: false, nativeRef: { provider: "composio", toolkit: "notion", action: "NOTION_SEARCH_NOTION_PAGE" } })],
    })
    expect(fakeMcp.seenToolArguments).toContainEqual(expect.objectContaining({ queries: ["github current user"] }))

    const described = await handlers.describeTool(actor, { sourceId: source.id, toolName: "NOTION_SEARCH_NOTION_PAGE" })
    expect(described.tool.toolName).toBe("NOTION_SEARCH_NOTION_PAGE")
    expect(described.tool.nativeRef.toolkit).toBe("notion")
    expect(described.tool.descriptorHash).toBe(searched.tools[0]?.descriptorHash)
    await expect(composio.catalog.describeTool(source, "COMPOSIO_MULTI_EXECUTE_TOOL")).rejects.toMatchObject({ code: MCP_ERROR_CODES.TOOL_NOT_ALLOWED })
    await expect(composio.transport.callTool(source, "COMPOSIO_REMOTE_BASH_TOOL", {})).rejects.toMatchObject({ code: MCP_ERROR_CODES.TOOL_NOT_ALLOWED })
    await expect(composio.transport.callTool(source, "NOTION_SEARCH_NOTION_PAGE", {})).rejects.toMatchObject({ code: MCP_ERROR_CODES.TOOL_NOT_ALLOWED })
    await expect(composio.transport.listTools(source)).resolves.toEqual([])
    await composio.catalog.disposeSource?.(source)
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/api\/v3\.1\/tool_router\/session\/session-\d+$/), expect.objectContaining({ method: "DELETE" }))
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/api\/v3\.1\/tool_router\/session\/session-\d+$/), expect.objectContaining({ method: "GET" }))
  })

  it("rejects schema toolkit identity that contradicts provider search provenance", async () => {
    const fakeMcp = await listenFakeComposioMetaMcpServer("github")
    const fetch = createComposioFetch(fakeMcp.url)
    const source: McpSource = {
      id: "managed:workspace-1:user-1:composio",
      workspaceId: actor.workspaceId,
      userId: actor.userId,
      provider: "composio",
      displayName: "Composio",
      status: "connected",
      ownerKind: "user",
      credentialProvider: "composio-managed",
    }
    const composio = createComposioMcpAdapter({ fetch, secretResolver, configs: [fullCatalogConfig], allowInsecureMcpUrlsForTests: true })

    await expect(composio.catalog.searchTools(source, { query: "notion", limit: 1 })).rejects.toMatchObject({ code: MCP_ERROR_CODES.PROVIDER_ERROR })
  })

  it("discovers live-style Composio provider tools through server-side meta tools", async () => {
    const fakeMcp = await listenFakeComposioMetaMcpServer()
    const fetch = createComposioFetch(fakeMcp.url, [activeNotionAccount])
    const registry = createRegistry()
    const source = await registry.upsertSource(actor, {
      id: "managed:workspace-1:user-1:notion",
      workspaceId: actor.workspaceId,
      userId: actor.userId,
      provider: "notion",
      displayName: "Notion",
      status: "connected",
      ownerKind: "user",
      credentialProvider: "composio-managed",
      connectorRef: { provider: "notion", toolkitId: "notion", sessionId: "session-1" },
    })
    const transport = createComposioMcpTransport({ fetch, secretResolver, configs: [config], allowInsecureMcpUrlsForTests: true })
    const handlers = createBoringMcpSourceHandlers({ registry, transport })
    const bridge = createBoringMcpAgentBridgeRegistry(handlers)

    await expect(bridge.mcp_tools_search.invoke({ actor }, { query: "notion" })).resolves.toMatchObject({
      tools: [
        expect.objectContaining({ toolName: "NOTION_SEARCH_NOTION_PAGE", enabled: true }),
        expect.objectContaining({ toolName: "NOTION_GET_PAGE_MARKDOWN", enabled: true }),
        expect.objectContaining({ toolName: "NOTION_RETRIEVE_PAGE", enabled: true }),
      ],
    })
    const searchCallsAfterFirstLoad = fakeMcp.seenToolCalls.filter((name) => name === "COMPOSIO_SEARCH_TOOLS").length
    const schemaCallsAfterFirstLoad = fakeMcp.seenToolCalls.filter((name) => name === "COMPOSIO_GET_TOOL_SCHEMAS").length

    await expect(bridge.mcp_tools_search.invoke({ actor }, { query: "notion" })).resolves.toMatchObject({
      tools: expect.arrayContaining([expect.objectContaining({ toolName: "NOTION_SEARCH_NOTION_PAGE", enabled: true })]),
    })
    expect(fakeMcp.seenToolCalls.filter((name) => name === "COMPOSIO_SEARCH_TOOLS")).toHaveLength(searchCallsAfterFirstLoad)
    expect(fakeMcp.seenToolCalls.filter((name) => name === "COMPOSIO_GET_TOOL_SCHEMAS")).toHaveLength(schemaCallsAfterFirstLoad)

    await expect(bridge.mcp_tools_search.invoke({ actor }, { query: "notion", refresh: true })).resolves.toMatchObject({
      tools: expect.arrayContaining([expect.objectContaining({ toolName: "NOTION_SEARCH_NOTION_PAGE", enabled: true })]),
    })
    expect(fakeMcp.seenToolCalls.filter((name) => name === "COMPOSIO_SEARCH_TOOLS").length).toBeGreaterThan(searchCallsAfterFirstLoad)
    expect(fakeMcp.seenToolCalls.filter((name) => name === "COMPOSIO_GET_TOOL_SCHEMAS").length).toBeGreaterThan(schemaCallsAfterFirstLoad)

    const sessionRequestsAfterRefresh = fetch.mock.calls.filter(([url]) => String(url).endsWith("/api/v3.1/tool_router/session")).length
    await registry.upsertSource(actor, { ...source, updatedAt: "2026-07-01T00:00:00.000Z", connectorRef: { provider: "notion", toolkitId: "notion", sessionId: "new-source-session-ref" } })
    await expect(bridge.mcp_tools_search.invoke({ actor }, { query: "notion", refresh: true })).resolves.toMatchObject({
      tools: expect.arrayContaining([expect.objectContaining({ toolName: "NOTION_SEARCH_NOTION_PAGE", enabled: true })]),
    })
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("/api/v3.1/tool_router/session")).length).toBeGreaterThan(sessionRequestsAfterRefresh)

    await expect(bridge.mcp_server_probe.invoke({ actor }, { sourceId: source.id })).resolves.toMatchObject({
      sourceId: source.id,
      resources: [],
      tools: expect.arrayContaining([expect.objectContaining({ name: "NOTION_SEARCH_NOTION_PAGE" })]),
    })
    await expect(bridge.mcp_tools_search.invoke({ actor }, { query: "COMPOSIO" })).resolves.toMatchObject({ tools: [] })

    const searchCallsBeforeReadonly = fakeMcp.seenToolCalls.filter((name) => name === "COMPOSIO_SEARCH_TOOLS").length
    const schemaCallsBeforeReadonly = fakeMcp.seenToolCalls.filter((name) => name === "COMPOSIO_GET_TOOL_SCHEMAS").length
    await expect(bridge.mcp_readonly_call.invoke({ actor }, { sourceId: source.id, toolName: "NOTION_SEARCH_NOTION_PAGE", input: { query: "demo" } })).resolves.toEqual({
      content: { content: [{ type: "text", text: "meta execute ok" }] },
    })
    expect(fakeMcp.seenToolCalls.filter((name) => name === "COMPOSIO_SEARCH_TOOLS")).toHaveLength(searchCallsBeforeReadonly)
    expect(fakeMcp.seenToolCalls.filter((name) => name === "COMPOSIO_GET_TOOL_SCHEMAS")).toHaveLength(schemaCallsBeforeReadonly)
    expect(fakeMcp.seenHeaders).toContainEqual(expect.stringContaining("server-only-session"))
    expect(fakeMcp.seenHeaders).toContain("cmp_test_key")
  })
})
