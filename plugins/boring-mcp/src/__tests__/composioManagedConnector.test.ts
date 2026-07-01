import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { AddressInfo } from "node:net"
import { afterEach, describe, expect, it, vi } from "vitest"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { createBoringMcpAgentBridgeRegistry } from "../server/agentBridge"
import { createComposioManagedConnectorProvider, createComposioMcpTransport } from "../server/composioManagedConnector"
import { createManagedConnectorAdapter, type ManagedConnectorConfig, type ManagedConnectorSecretResolver, type ManagedConnectorSourceRegistry } from "../server/managedConnectorAdapter"
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
const secretResolver: ManagedConnectorSecretResolver = {
  resolveSecret: vi.fn(async () => ({ storage: "server-env" as const, value: "cmp_test_key" })),
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

function createComposioFetch(mcpUrl = "https://mcp.example/session", accounts: unknown[] = []) {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    expect(init?.headers).toMatchObject({ "x-api-key": "cmp_test_key" })
    const url = String(input)
    if (url.includes("/api/v3.1/connected_accounts?")) {
      expect(init?.method).toBe("GET")
      expect(url).toContain("user_id=workspace-1%3Auser-1")
      expect(url).toContain("toolkit_slug=notion")
      return jsonResponse({ items: accounts })
    }
    if (url.endsWith("/api/v3.1/tool_router/session")) {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        user_id: "workspace-1:user-1",
        mcp: true,
        toolkits: { enable: ["notion"] },
        manage_connections: { enable: true, enable_wait_for_connections: false },
      })
      return jsonResponse({ id: "session-1", mcp: { url: mcpUrl, headers: { "x-composio-mcp-session": "server-only-session" } } })
    }
    if (url.endsWith("/api/v3/tool_router/session/session-1/link")) {
      expect(JSON.parse(String(init?.body))).toMatchObject({ toolkit: "notion" })
      return jsonResponse({ redirect_url: "https://app.composio.dev/connect/session-1" })
    }
    return jsonResponse({ error: "not found" }, 404)
  }) as typeof fetch & ReturnType<typeof vi.fn>
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined
}

function createFakeMcpServer(seenHeaders: string[]) {
  const server = new McpServer({ name: "composio-fake-mcp", version: "1.0.0" })
  server.registerTool("NOTION_SEARCH_NOTION_PAGE", { description: "Search pages" }, async () => ({ content: [{ type: "text", text: "composio mcp ok" }] }))
  server.registerTool("COMPOSIO_MANAGE_CONNECTIONS", { description: "Raw meta tool must stay hidden" }, async () => ({ content: [{ type: "text", text: "hidden" }] }))
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url !== "/mcp" || req.method !== "POST") {
      res.statusCode = 404
      res.end("not found")
      return
    }
    seenHeaders.push(String(req.headers["x-composio-mcp-session"] ?? ""))
    const body = await readJson(req)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on("close", () => void transport.close())
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
  })
}

async function listenFakeMcpServer() {
  const seenHeaders: string[] = []
  const httpServer = createFakeMcpServer(seenHeaders)
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve))
  const { port } = httpServer.address() as AddressInfo
  const close = () => new Promise<void>((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()))
  servers.push({ close })
  return { url: `http://127.0.0.1:${port}/mcp`, seenHeaders }
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
    expect(result.source).toMatchObject({ status: "unconfigured", credentialProvider: "composio-managed", connectorRef: { sessionId: "session-1", toolkitId: "notion" } })
    expect(JSON.stringify(result)).not.toContain("cmp_test_key")
    expect(JSON.stringify(result)).not.toContain("server-only-session")

    await expect(adapter.refreshStatus(actor, result.source.id)).resolves.toMatchObject({ source: { status: "unconfigured" } })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it("promotes an unconfigured source to connected only after Composio reports an active connected account", async () => {
    const fetch = createComposioFetch("https://mcp.example/session", [{
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
    await expect(adapter.refreshStatus(actor, started.source.id)).resolves.toMatchObject({
      source: { status: "connected", providerAccountLabel: "Demo Notion", connectorRef: { connectedAccountId: "account-1" } },
    })
  })

  it("rejects non-HTTPS Composio MCP session URLs unless using the loopback-only test override", async () => {
    const fetch = createComposioFetch("http://evil.example/mcp")
    const provider = createComposioManagedConnectorProvider({ fetch })

    await expect(provider.probe({
      actor,
      config,
      secret: { storage: "server-env", value: "cmp_test_key" },
      source: {} as McpSource,
    })).rejects.toMatchObject({ code: MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID })
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

  it("uses Composio session MCP headers with the real MCP SDK transport and hides raw Composio meta tools", async () => {
    const fakeMcp = await listenFakeMcpServer()
    const fetch = createComposioFetch(fakeMcp.url)
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
    expect(fakeMcp.seenHeaders).toContain("server-only-session")
  })
})
