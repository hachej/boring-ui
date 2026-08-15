import { createHash } from "node:crypto"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { AddressInfo } from "node:net"
import { afterEach, describe, expect, it, vi } from "vitest"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import {
  COMPOSIO_CATALOG_PROVIDER_ID,
  createComposioCatalogBackend,
  createComposioCatalogSource,
  deleteComposioCatalogSession,
  requireExactlyOneComposioAccount,
  resolveComposioCatalogSession,
  type ComposioCatalogBackendOptions,
} from "../server/composioCatalogBackend"
import { createBoringMcpSourceHandlers } from "../server/sourceHandlers"
import { createBoringMcpToolCatalog } from "../server/toolCatalog"
import { MCP_ERROR_CODES, type McpActor, type McpSource, type McpSourceRegistry, type McpTransportClient } from "../shared"

const actor: McpActor = { workspaceId: "workspace-1", userId: "user-1" }
const composioSubject = `boring_${createHash("sha256").update(`${actor.workspaceId}\0${actor.userId}`).digest("hex")}`
const secret = { storage: "server-env" as const, value: "cmp_test_key" }
const source: McpSource = {
  id: "managed:composio:user-1",
  workspaceId: actor.workspaceId,
  userId: actor.userId,
  provider: COMPOSIO_CATALOG_PROVIDER_ID,
  displayName: "Composio",
  status: "connected",
  ownerKind: "user",
  credentialProvider: "composio-managed",
}
const fallbackTransport: McpTransportClient = {
  listTools: vi.fn(async () => []),
  listResources: vi.fn(async () => []),
  readResource: vi.fn(),
  callTool: vi.fn(),
}
const registry: McpSourceRegistry = {
  async listSources(requestActor) {
    return requestActor.userId === actor.userId && requestActor.workspaceId === actor.workspaceId ? [source] : []
  },
  async getSource(sourceId) {
    return sourceId === source.id ? source : undefined
  },
}

const servers: Array<() => Promise<void>> = []

afterEach(async () => {
  while (servers.length > 0) await servers.pop()!()
  vi.restoreAllMocks()
})

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined
}

async function listenFakeComposioMcp(options: { metadataCanary?: string; oversizedSchema?: boolean; oversizedResponse?: boolean; delayMs?: number; exposedWorkbench?: boolean; mismatchedSlug?: boolean; missingInputSchema?: boolean; invalidInputSchemaType?: boolean; missingToolkit?: boolean } = {}) {
  const calls: Array<{ name: string; arguments: unknown }> = []
  const server = new McpServer({ name: "fake-composio", version: "1.0.0" })
  server.registerTool("COMPOSIO_SEARCH_TOOLS", { description: "controlled search" }, async () => {
    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs))
    return {
      content: [{ type: "text", text: JSON.stringify({ data: { results: [{
        toolkits: ["github"],
        primary_tool_slugs: ["GITHUB_GET_CURRENT_USER"],
        related_tool_slugs: ["GITHUB_CREATE_ISSUE", "COMPOSIO_MULTI_EXECUTE_TOOL"],
      }] } }) }],
    }
  })
  server.registerTool("COMPOSIO_GET_TOOL_SCHEMAS", { description: "controlled schema" }, async () => {
    return {
      content: [{ type: "text", text: JSON.stringify({ data: { tool_schemas: {
        GITHUB_GET_CURRENT_USER: {
          tool_slug: options.mismatchedSlug ? "GITHUB_WRONG_TOOL" : "GITHUB_GET_CURRENT_USER",
          toolkit_slug: options.missingToolkit ? undefined : "github",
          description: options.metadataCanary
            ? `provider text ${options.metadataCanary}`
            : options.oversizedResponse
              ? "x".repeat(600_000)
              : "Get the current GitHub user",
          input_schema: options.missingInputSchema ? undefined : options.invalidInputSchemaType ? { type: "array" } : options.oversizedSchema ? { type: "object", padding: "x".repeat(70_000) } : { type: "object", properties: {} },
          output_schema: { type: "object" },
        },
        GITHUB_CREATE_ISSUE: {
          tool_slug: "GITHUB_CREATE_ISSUE",
          toolkit_slug: "github",
          description: "Create an issue",
          input_schema: { type: "object", properties: { title: { type: "string" } } },
        },
      } } }) }],
    }
  })
  server.registerTool("COMPOSIO_MULTI_EXECUTE_TOOL", { description: "must never be called" }, async () => ({ content: [{ type: "text", text: "unsafe" }] }))
  if (options.exposedWorkbench) {
    server.registerTool("COMPOSIO_REMOTE_BASH_TOOL", { description: "must never be called" }, async () => ({ content: [{ type: "text", text: "unsafe" }] }))
    server.registerTool("COMPOSIO_REMOTE_WORKBENCH", { description: "must never be called" }, async () => ({ content: [{ type: "text", text: "unsafe" }] }))
  }

  const http = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    if (request.url !== "/mcp" || request.method !== "POST") {
      response.statusCode = 404
      response.end()
      return
    }
    const body = await readJson(request)
    for (const message of Array.isArray(body) ? body : [body]) {
      const rpc = message && typeof message === "object" ? message as { method?: unknown; params?: { name?: unknown; arguments?: unknown } } : {}
      if (rpc.method === "tools/call" && typeof rpc.params?.name === "string") {
        calls.push({ name: rpc.params.name, arguments: rpc.params.arguments })
      }
    }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    response.on("close", () => void transport.close())
    await server.connect(transport)
    await transport.handleRequest(request, response, body)
  })
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve))
  const port = (http.address() as AddressInfo).port
  servers.push(() => new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve())))
  return { url: `http://127.0.0.1:${port}/mcp`, calls }
}

function composioApiFetch(mcpUrl: string, accounts: unknown[] = []) {
  const sessionBodies: Record<string, unknown>[] = []
  const deletedSessions: string[] = []
  const requests: string[] = []
  let nextSession = 0
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    requests.push(`${init?.method ?? "GET"} ${url}`)
    expect(init?.redirect).toBe("error")
    expect(init?.headers).toMatchObject({ "x-api-key": secret.value })
    if (url.includes("/api/v3.1/connected_accounts?")) {
      expect(url).toContain(`user_id=${composioSubject}`)
      return Response.json({ items: accounts, has_more: false })
    }
    if (url.endsWith("/api/v3.1/tool_router/session") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      sessionBodies.push(body)
      nextSession += 1
      return Response.json({
        id: `session-${nextSession}`,
        mcp: { url: mcpUrl, headers: { "x-composio-mcp-session": `private-session-${nextSession}` } },
        config: { workbench: body.workbench, connected_accounts: body.connected_accounts },
      })
    }
    const match = url.match(/\/api\/v3\.1\/tool_router\/session\/(session-\d+)$/)
    if (match && init?.method === "DELETE") {
      deletedSessions.push(match[1]!)
      return new Response(undefined, { status: 204 })
    }
    if (match && init?.method === "GET") return Response.json({ error: "not found" }, { status: 404 })
    return Response.json({ error: "not found" }, { status: 404 })
  }) as typeof globalThis.fetch & ReturnType<typeof vi.fn>
  return { fetch, sessionBodies, deletedSessions, requests }
}

function backendOptions(fetch: typeof globalThis.fetch): ComposioCatalogBackendOptions {
  return {
    fetch,
    secretResolver: { resolveSecret: vi.fn(async () => secret) },
    allowInsecureLoopbackForTests: true,
  }
}

describe("Composio full-catalog backend", () => {
  it("derives an opaque stable catalog source identity", () => {
    const created = createComposioCatalogSource(actor)
    expect(created).toMatchObject({ provider: "composio", credentialProvider: "composio-managed", status: "connected" })
    expect(created.id).toBe(createComposioCatalogSource(actor).id)
    expect(created.id).not.toContain(actor.workspaceId)
    expect(created.id).not.toContain(actor.userId)
    const createdRegistry: McpSourceRegistry = { listSources: vi.fn(async () => [created]), getSource: vi.fn(async () => created) }
    const backend = createComposioCatalogBackend(backendOptions(vi.fn() as unknown as typeof fetch))
    const handlers = createBoringMcpSourceHandlers({ registry: createdRegistry, transport: fallbackTransport, managedCatalog: backend })
    return Promise.all([
      expect(handlers.doctorSource(actor, created.id)).resolves.toMatchObject({ ok: true, issues: [] }),
      expect(handlers.probeSource(actor, created.id)).resolves.toMatchObject({ sourceId: created.id, provider: "composio", tools: [], resources: [] }),
    ]).then(() => undefined)
  })

  it("uses the exact query through real MCP SDK transport, bounds results, and verified-cleans the unfiltered Session", async () => {
    const fakeMcp = await listenFakeComposioMcp()
    const api = composioApiFetch(fakeMcp.url)
    const backend = createComposioCatalogBackend(backendOptions(api.fetch))
    const catalog = createBoringMcpToolCatalog({ registry, transport: fallbackTransport, managedCatalog: backend })

    const result = await catalog.searchTools(actor, { sourceId: source.id, query: "github current user", limit: 1 })

    expect(result.tools).toEqual([expect.objectContaining({
      provider: "composio",
      toolName: "GITHUB_GET_CURRENT_USER",
      enabled: false,
      nativeRef: { provider: "composio", toolkit: "github", action: "GITHUB_GET_CURRENT_USER" },
      sourceRevision: expect.any(String),
      providerSupplied: true,
    })])
    expect(fakeMcp.calls).toEqual([
      { name: "COMPOSIO_SEARCH_TOOLS", arguments: expect.objectContaining({ queries: ["github current user"], session: "session-1" }) },
      { name: "COMPOSIO_GET_TOOL_SCHEMAS", arguments: expect.objectContaining({ tool_slugs: ["GITHUB_GET_CURRENT_USER"], session_id: "session-1" }) },
    ])
    expect(api.sessionBodies[0]).toMatchObject({
      user_id: composioSubject,
      mcp: true,
      manage_connections: { enable: true, enable_wait_for_connections: false },
      workbench: { enable: false },
    })
    expect(api.sessionBodies[0]).not.toHaveProperty("toolkits")
    expect(api.deletedSessions).toEqual(["session-1"])
    expect(api.requests).toContain("GET https://backend.composio.dev/api/v3.1/tool_router/session/session-1")

    const secondPage = await catalog.searchTools(actor, { sourceId: source.id, query: "github current user", limit: 1, offset: 1 })
    expect(secondPage.tools).toEqual([expect.objectContaining({ toolName: "GITHUB_CREATE_ISSUE" })])
    expect(fallbackTransport.listTools).not.toHaveBeenCalled()
  })

  it("keeps cached data bounded/transient and refreshes exact schema on demand", async () => {
    const fakeMcp = await listenFakeComposioMcp()
    const api = composioApiFetch(fakeMcp.url)
    const backend = createComposioCatalogBackend({ ...backendOptions(api.fetch), cacheEntries: 1, cacheTtlMs: 10_000 })
    const catalog = createBoringMcpToolCatalog({ registry, transport: fallbackTransport, managedCatalog: backend })

    await catalog.searchTools(actor, { sourceId: source.id, query: "github", limit: 1 })
    const cached = await catalog.describeTool(actor, { sourceId: source.id, toolName: "GITHUB_GET_CURRENT_USER" })
    expect(cached.tool.inputSchema).toEqual({ type: "object", properties: {} })
    expect(api.sessionBodies).toHaveLength(1)

    await catalog.describeTool(actor, { sourceId: source.id, toolName: "GITHUB_GET_CURRENT_USER", refresh: true })
    expect(api.sessionBodies).toHaveLength(2)
    expect(api.deletedSessions).toEqual(["session-1", "session-2"])
  })

  it("requires zero/multiple/exact account behavior and preserves the exact Session pin", async () => {
    const fakeMcp = await listenFakeComposioMcp()
    const none = composioApiFetch(fakeMcp.url)
    await expect(requireExactlyOneComposioAccount(backendOptions(none.fetch), { actor, secret, toolkitId: "github" }))
      .rejects.toMatchObject({ code: MCP_ERROR_CODES.CONNECTED_ACCOUNT_REQUIRED })

    const pagedFetch = vi.fn(async () => Response.json({ items: [{ id: "account-1", user_id: composioSubject, status: "ACTIVE", toolkit: { slug: "github" } }], next_cursor: "more" })) as typeof globalThis.fetch & ReturnType<typeof vi.fn>
    await expect(requireExactlyOneComposioAccount(backendOptions(pagedFetch), { actor, secret, toolkitId: "github" }))
      .rejects.toMatchObject({ code: MCP_ERROR_CODES.PROVIDER_ERROR })
    const malformedPageFetch = vi.fn(async () => Response.json({ items: [], has_more: "false" })) as typeof globalThis.fetch & ReturnType<typeof vi.fn>
    await expect(requireExactlyOneComposioAccount(backendOptions(malformedPageFetch), { actor, secret, toolkitId: "github" }))
      .rejects.toMatchObject({ code: MCP_ERROR_CODES.PROVIDER_ERROR })
    for (const malformed of [
      { items: [], next_cursor: "   " },
      { items: [], page: 1, total_pages: 2, has_more: false },
    ]) {
      const fetch = vi.fn(async () => Response.json(malformed)) as typeof globalThis.fetch & ReturnType<typeof vi.fn>
      await expect(requireExactlyOneComposioAccount(backendOptions(fetch), { actor, secret, toolkitId: "github" }))
        .rejects.toMatchObject({ code: MCP_ERROR_CODES.PROVIDER_ERROR })
    }

    const active = (id: string, userId = composioSubject) => ({
      id,
      user_id: userId,
      status: "ACTIVE",
      is_disabled: false,
      toolkit: { slug: "github" },
    })
    const multiple = composioApiFetch(fakeMcp.url, [active("account-1"), active("account-2")])
    await expect(requireExactlyOneComposioAccount(backendOptions(multiple.fetch), { actor, secret, toolkitId: "github" }))
      .rejects.toMatchObject({ code: MCP_ERROR_CODES.CONNECTED_ACCOUNT_CONFLICT })

    const exactApi = composioApiFetch(fakeMcp.url, [active("other-user", "boring_other_user"), active("account-1")])
    const options = backendOptions(exactApi.fetch)
    const account = await requireExactlyOneComposioAccount(options, { actor, secret, toolkitId: "github" })
    const session = await resolveComposioCatalogSession(options, {
      actor,
      secret,
      accountPin: account,
    })
    expect(session.id).toBe("session-1")
    expect(exactApi.sessionBodies[0]).toMatchObject({
      connected_accounts: { github: ["account-1"] },
      workbench: { enable: false },
    })
    expect(exactApi.sessionBodies[0]).not.toHaveProperty("toolkits")
    await deleteComposioCatalogSession(options, secret, session.id)

    const broadPinFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith("/api/v3.1/tool_router/session") && init?.method === "POST") return Response.json({
        id: "broad-session",
        mcp: { url: fakeMcp.url },
        config: { workbench: { enable: false }, connected_accounts: { github: ["account-1"], slack: ["account-2"] } },
      })
      if (url.endsWith("/broad-session") && init?.method === "DELETE") return new Response(undefined, { status: 204 })
      if (url.endsWith("/broad-session") && init?.method === "GET") return Response.json({ error: "not found" }, { status: 404 })
      return Response.json({ error: "not found" }, { status: 404 })
    }) as typeof globalThis.fetch & ReturnType<typeof vi.fn>
    await expect(resolveComposioCatalogSession(backendOptions(broadPinFetch), { actor, secret, accountPin: { toolkitId: "github", connectedAccountId: "account-1" } }))
      .rejects.toMatchObject({ code: MCP_ERROR_CODES.PROVIDER_ERROR })
  })

  it("never exposes or invokes raw Composio execution/control/bash/workbench meta-tools", async () => {
    const fakeMcp = await listenFakeComposioMcp()
    const api = composioApiFetch(fakeMcp.url)
    const catalog = createBoringMcpToolCatalog({
      registry,
      transport: fallbackTransport,
      managedCatalog: createComposioCatalogBackend(backendOptions(api.fetch)),
    })

    const search = await catalog.searchTools(actor, { sourceId: source.id, query: "github", limit: 20 })
    expect(search.tools.map((tool) => tool.toolName)).toEqual(["GITHUB_GET_CURRENT_USER", "GITHUB_CREATE_ISSUE"])
    await expect(catalog.describeTool(actor, { sourceId: source.id, toolName: "COMPOSIO_MULTI_EXECUTE_TOOL" }))
      .rejects.toMatchObject({ code: MCP_ERROR_CODES.TOOL_NOT_FOUND })
    await expect(catalog.describeTool(actor, { sourceId: source.id, toolName: "COMPOSIO_REMOTE_BASH_TOOL" }))
      .rejects.toMatchObject({ code: MCP_ERROR_CODES.TOOL_NOT_FOUND })
    await expect(catalog.describeTool(actor, { sourceId: source.id, toolName: "COMPOSIO_REMOTE_WORKBENCH" }))
      .rejects.toMatchObject({ code: MCP_ERROR_CODES.TOOL_NOT_FOUND })
    expect(fakeMcp.calls.map(({ name }) => name).every((name) => name === "COMPOSIO_SEARCH_TOOLS" || name === "COMPOSIO_GET_TOOL_SCHEMAS")).toBe(true)

    const unsafeMcp = await listenFakeComposioMcp({ exposedWorkbench: true })
    const unsafeApi = composioApiFetch(unsafeMcp.url)
    const unsafeCatalog = createBoringMcpToolCatalog({ registry, transport: fallbackTransport, managedCatalog: createComposioCatalogBackend(backendOptions(unsafeApi.fetch)) })
    await expect(unsafeCatalog.searchTools(actor, { sourceId: source.id, query: "github" }))
      .rejects.toMatchObject({ code: MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID })
    expect(unsafeMcp.calls).toEqual([])
    expect(unsafeApi.deletedSessions).toEqual(["session-1"])
  })

  it("fails closed on missing queries, oversized schemas, and redaction canaries", async () => {
    const normalMcp = await listenFakeComposioMcp()
    const normalApi = composioApiFetch(normalMcp.url)
    const normalCatalog = createBoringMcpToolCatalog({ registry, transport: fallbackTransport, managedCatalog: createComposioCatalogBackend(backendOptions(normalApi.fetch)) })
    await expect(normalCatalog.searchTools(actor, { sourceId: source.id, query: "" }))
      .rejects.toMatchObject({ code: MCP_ERROR_CODES.INPUT_INVALID })
    await expect(normalCatalog.searchTools(actor, { sourceId: source.id, query: "x".repeat(257) }))
      .rejects.toMatchObject({ code: MCP_ERROR_CODES.INPUT_INVALID })

    const oversizedMcp = await listenFakeComposioMcp({ oversizedSchema: true })
    const oversizedApi = composioApiFetch(oversizedMcp.url)
    const oversizedCatalog = createBoringMcpToolCatalog({ registry, transport: fallbackTransport, managedCatalog: createComposioCatalogBackend(backendOptions(oversizedApi.fetch)) })
    await expect(oversizedCatalog.searchTools(actor, { sourceId: source.id, query: "github" }))
      .rejects.toMatchObject({ code: MCP_ERROR_CODES.RESOURCE_LIMIT_EXCEEDED })
    expect(oversizedApi.deletedSessions).toEqual(["session-1"])

    const secretMcp = await listenFakeComposioMcp({ metadataCanary: secret.value })
    const secretApi = composioApiFetch(secretMcp.url)
    const secretCatalog = createBoringMcpToolCatalog({ registry, transport: fallbackTransport, managedCatalog: createComposioCatalogBackend(backendOptions(secretApi.fetch)) })
    const error = await secretCatalog.searchTools(actor, { sourceId: source.id, query: "github" }).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: MCP_ERROR_CODES.SECRET_LEAK_GUARD })
    expect(JSON.stringify(error)).not.toContain(secret.value)
    expect(secretApi.deletedSessions).toEqual(["session-1"])

    const sessionCanaryMcp = await listenFakeComposioMcp({ metadataCanary: "private-session-1" })
    const sessionCanaryApi = composioApiFetch(sessionCanaryMcp.url)
    const sessionCanaryCatalog = createBoringMcpToolCatalog({ registry, transport: fallbackTransport, managedCatalog: createComposioCatalogBackend(backendOptions(sessionCanaryApi.fetch)) })
    const sessionError = await sessionCanaryCatalog.searchTools(actor, { sourceId: source.id, query: "github" }).catch((caught: unknown) => caught)
    expect(sessionError).toMatchObject({ code: MCP_ERROR_CODES.SECRET_LEAK_GUARD })
    expect(JSON.stringify(sessionError)).not.toContain("private-session-1")
    expect(sessionCanaryApi.deletedSessions).toEqual(["session-1"])
  })

  it("rejects missing or mismatched provider schemas instead of fabricating descriptors", async () => {
    const fakeMcp = await listenFakeComposioMcp()
    const api = composioApiFetch(fakeMcp.url)
    const catalog = createBoringMcpToolCatalog({ registry, transport: fallbackTransport, managedCatalog: createComposioCatalogBackend(backendOptions(api.fetch)) })
    await expect(catalog.describeTool(actor, { sourceId: source.id, toolName: "GITHUB_UNKNOWN_TOOL" }))
      .rejects.toMatchObject({ code: MCP_ERROR_CODES.TOOL_NOT_FOUND })

    const mismatchMcp = await listenFakeComposioMcp({ mismatchedSlug: true })
    const mismatchApi = composioApiFetch(mismatchMcp.url)
    const mismatchCatalog = createBoringMcpToolCatalog({ registry, transport: fallbackTransport, managedCatalog: createComposioCatalogBackend(backendOptions(mismatchApi.fetch)) })
    const search = await mismatchCatalog.searchTools(actor, { sourceId: source.id, query: "github", limit: 1 })
    expect(search.tools).toEqual([])
    await expect(mismatchCatalog.describeTool(actor, { sourceId: source.id, toolName: "GITHUB_GET_CURRENT_USER", refresh: true }))
      .rejects.toMatchObject({ code: MCP_ERROR_CODES.TOOL_NOT_FOUND })

    for (const invalid of [{ missingInputSchema: true }, { invalidInputSchemaType: true }, { missingToolkit: true }]) {
      const invalidMcp = await listenFakeComposioMcp(invalid)
      const invalidApi = composioApiFetch(invalidMcp.url)
      const invalidCatalog = createBoringMcpToolCatalog({ registry, transport: fallbackTransport, managedCatalog: createComposioCatalogBackend(backendOptions(invalidApi.fetch)) })
      await expect(invalidCatalog.describeTool(actor, { sourceId: source.id, toolName: "GITHUB_GET_CURRENT_USER" }))
        .rejects.toMatchObject({ code: MCP_ERROR_CODES.TOOL_NOT_FOUND })
    }
  })

  it("verified-cleans nested rejected Session envelopes", async () => {
    const deleted: string[] = []
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith("/api/v3.1/tool_router/session") && init?.method === "POST") {
        return Response.json({ data: { id: "nested-session", mcp: { url: "https://backend.composio.dev/mcp" }, config: { workbench: { enable: true } } } })
      }
      if (url.endsWith("/nested-session") && init?.method === "DELETE") {
        deleted.push("nested-session")
        return new Response(undefined, { status: 204 })
      }
      if (url.endsWith("/nested-session") && init?.method === "GET") return Response.json({ error: "not found" }, { status: 404 })
      return Response.json({ error: "not found" }, { status: 404 })
    }) as typeof globalThis.fetch & ReturnType<typeof vi.fn>
    await expect(resolveComposioCatalogSession(backendOptions(fetch), { actor, secret }))
      .rejects.toMatchObject({ code: MCP_ERROR_CODES.PROVIDER_ERROR })
    expect(deleted).toEqual(["nested-session"])

    const secretDeleted: string[] = []
    const secretFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith("/api/v3.1/tool_router/session") && init?.method === "POST") {
        return Response.json({ id: "secret-session", echo: secret.value, mcp: { url: "https://backend.composio.dev/mcp" }, config: { workbench: { enable: false } } })
      }
      if (url.endsWith("/secret-session") && init?.method === "DELETE") {
        secretDeleted.push("secret-session")
        return new Response(undefined, { status: 204 })
      }
      if (url.endsWith("/secret-session") && init?.method === "GET") return Response.json({ error: "not found" }, { status: 404 })
      return Response.json({ error: "not found" }, { status: 404 })
    }) as typeof globalThis.fetch & ReturnType<typeof vi.fn>
    await expect(resolveComposioCatalogSession(backendOptions(secretFetch), { actor, secret }))
      .rejects.toMatchObject({ code: MCP_ERROR_CODES.SECRET_LEAK_GUARD })
    expect(secretDeleted).toEqual(["secret-session"])
  })

  it("retains failed cleanup from rejected Session validation without masking the security failure", async () => {
    const fakeMcp = await listenFakeComposioMcp()
    let deleteAttempts = 0
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith("/api/v3.1/tool_router/session") && init?.method === "POST") return Response.json({
        id: "rejected-session",
        echo: secret.value,
        mcp: { url: fakeMcp.url, headers: { "x-composio-mcp-session": "private-rejected" } },
        config: { workbench: { enable: false } },
      })
      if (url.endsWith("/rejected-session") && init?.method === "DELETE") {
        deleteAttempts += 1
        if (deleteAttempts === 1) return Response.json({ error: "transient" }, { status: 503 })
        return new Response(undefined, { status: 204 })
      }
      if (url.endsWith("/rejected-session") && init?.method === "GET") return Response.json({ error: "not found" }, { status: 404 })
      return Response.json({ error: "not found" }, { status: 404 })
    }) as typeof globalThis.fetch & ReturnType<typeof vi.fn>
    const backend = createComposioCatalogBackend(backendOptions(fetch))
    const catalog = createBoringMcpToolCatalog({ registry, transport: fallbackTransport, managedCatalog: backend })

    await expect(catalog.searchTools(actor, { sourceId: source.id, query: "github" }))
      .rejects.toMatchObject({ code: MCP_ERROR_CODES.SECRET_LEAK_GUARD })
    expect(deleteAttempts).toBe(1)
    await expect(backend.drain()).resolves.toBeUndefined()
    expect(deleteAttempts).toBe(2)
  })

  it("retains failed cleanup leases, preserves the primary failure, and drains deterministically", async () => {
    const unsafeMcp = await listenFakeComposioMcp({ exposedWorkbench: true })
    const api = composioApiFetch(unsafeMcp.url)
    let deleteAttempts = 0
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith("/session-1") && init?.method === "DELETE") {
        deleteAttempts += 1
        if (deleteAttempts === 1) return Response.json({ error: "transient" }, { status: 503 })
      }
      return api.fetch(input, init)
    }) as typeof globalThis.fetch & ReturnType<typeof vi.fn>
    const backend = createComposioCatalogBackend(backendOptions(fetch))
    const catalog = createBoringMcpToolCatalog({ registry, transport: fallbackTransport, managedCatalog: backend })

    await expect(catalog.searchTools(actor, { sourceId: source.id, query: "github" }))
      .rejects.toMatchObject({ code: MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID })
    expect(deleteAttempts).toBe(1)
    await expect(backend.drain()).resolves.toBeUndefined()
    expect(deleteAttempts).toBe(2)
    await expect(backend.drain()).resolves.toBeUndefined()
    expect(deleteAttempts).toBe(2)
  })

  it("enforces bounded request concurrency and per-source rate budgets before Session creation", async () => {
    const slowMcp = await listenFakeComposioMcp({ delayMs: 50 })
    const concurrentApi = composioApiFetch(slowMcp.url)
    const concurrentCatalog = createBoringMcpToolCatalog({
      registry,
      transport: fallbackTransport,
      managedCatalog: createComposioCatalogBackend({ ...backendOptions(concurrentApi.fetch), maxConcurrentRequests: 1 }),
    })
    const first = concurrentCatalog.searchTools(actor, { sourceId: source.id, query: "github first" })
    await new Promise((resolve) => setTimeout(resolve, 5))
    await expect(concurrentCatalog.searchTools(actor, { sourceId: source.id, query: "github second" }))
      .rejects.toMatchObject({ code: MCP_ERROR_CODES.RESOURCE_LIMIT_EXCEEDED })
    await expect(first).resolves.toMatchObject({ tools: expect.any(Array) })

    const budgetMcp = await listenFakeComposioMcp()
    const budgetApi = composioApiFetch(budgetMcp.url)
    const budgetCatalog = createBoringMcpToolCatalog({
      registry,
      transport: fallbackTransport,
      managedCatalog: createComposioCatalogBackend({ ...backendOptions(budgetApi.fetch), maxRequestsPerMinute: 1 }),
    })
    await budgetCatalog.searchTools(actor, { sourceId: source.id, query: "github one" })
    await expect(budgetCatalog.searchTools(actor, { sourceId: source.id, query: "github two" }))
      .rejects.toMatchObject({ code: MCP_ERROR_CODES.RESOURCE_LIMIT_EXCEEDED })
    expect(budgetApi.sessionBodies).toHaveLength(1)
  })

  it("bounds MCP response streams and times out stalled MCP calls with verified cleanup", async () => {
    const oversizedMcp = await listenFakeComposioMcp({ oversizedResponse: true })
    const oversizedApi = composioApiFetch(oversizedMcp.url)
    const oversizedCatalog = createBoringMcpToolCatalog({
      registry,
      transport: fallbackTransport,
      managedCatalog: createComposioCatalogBackend(backendOptions(oversizedApi.fetch)),
    })
    await expect(oversizedCatalog.searchTools(actor, { sourceId: source.id, query: "github" }))
      .rejects.toMatchObject({ code: MCP_ERROR_CODES.RESOURCE_LIMIT_EXCEEDED })
    expect(oversizedApi.deletedSessions).toEqual(["session-1"])

    const slowMcp = await listenFakeComposioMcp({ delayMs: 100 })
    const slowApi = composioApiFetch(slowMcp.url)
    const slowCatalog = createBoringMcpToolCatalog({
      registry,
      transport: fallbackTransport,
      managedCatalog: createComposioCatalogBackend({ ...backendOptions(slowApi.fetch), requestTimeoutMs: 10 }),
    })
    await expect(slowCatalog.searchTools(actor, { sourceId: source.id, query: "github" }))
      .rejects.toMatchObject({ code: MCP_ERROR_CODES.PROVIDER_TIMEOUT })
    expect(slowApi.deletedSessions).toEqual(["session-1"])
  })

  it("keeps blank all-source curated search working when a catalog source is present", async () => {
    const notion = { ...source, id: "managed:notion:user-1", provider: "notion" }
    const mixedRegistry: McpSourceRegistry = {
      listSources: vi.fn(async () => [notion, source]),
      getSource: vi.fn(async (id) => id === notion.id ? notion : id === source.id ? source : undefined),
    }
    const curatedTransport: McpTransportClient = { ...fallbackTransport, listTools: vi.fn(async () => [{ name: "NOTION_SEARCH_NOTION_PAGE", inputSchema: { type: "object" } }]) }
    const backend = createComposioCatalogBackend(backendOptions(vi.fn() as unknown as typeof fetch))
    const catalog = createBoringMcpToolCatalog({ registry: mixedRegistry, transport: curatedTransport, managedCatalog: backend })
    await expect(catalog.searchTools(actor)).resolves.toMatchObject({ tools: [expect.objectContaining({ toolName: "NOTION_SEARCH_NOTION_PAGE" })] })
    expect(curatedTransport.listTools).toHaveBeenCalledTimes(1)
  })

  it("preserves curated transport fallback unchanged", async () => {
    const curatedSource = { ...source, id: "managed:notion:user-1", provider: "notion" }
    const curatedRegistry: McpSourceRegistry = { ...registry, getSource: vi.fn(async () => curatedSource) }
    const curatedTransport: McpTransportClient = {
      ...fallbackTransport,
      listTools: vi.fn(async () => [{ name: "NOTION_SEARCH_NOTION_PAGE", inputSchema: { type: "object" } }]),
    }
    const backend = createComposioCatalogBackend(backendOptions(vi.fn() as unknown as typeof fetch))
    const catalog = createBoringMcpToolCatalog({ registry: curatedRegistry, transport: curatedTransport, managedCatalog: backend })

    await expect(catalog.searchTools(actor, { sourceId: curatedSource.id, query: "search" })).resolves.toMatchObject({
      tools: [expect.objectContaining({ toolName: "NOTION_SEARCH_NOTION_PAGE", enabled: true })],
    })
    expect(curatedTransport.listTools).toHaveBeenCalledTimes(1)
  })
})
