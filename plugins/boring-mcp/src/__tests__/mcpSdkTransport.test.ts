import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { AddressInfo } from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { createBoringMcpAgentBridgeRegistry } from "../server/agentBridge"
import {
  createMcpSdkStreamableHttpTransport,
  createPinnedMcpDispatcher,
  createPinnedMcpFetch,
  resolveUserRegisteredMcpAddresses,
  snapshotMcpEndpointUrl,
} from "../server/mcpSdkTransport"
import { createBoringMcpSourceHandlers } from "../server/sourceHandlers"
import { createUserRegisteredMcpSource } from "../shared"
import type { McpActor, McpSource, McpSourceRegistry, McpToolDescribeResult } from "../shared"

const actor: McpActor = { userId: "user-1", workspaceId: "workspace-1" }
const source: McpSource = {
  id: "source:notion:user-1",
  workspaceId: actor.workspaceId,
  userId: actor.userId,
  provider: "notion",
  displayName: "Protocol Fake Notion",
  status: "connected",
  ownerKind: "user",
  credentialProvider: "composio-managed",
  connectorRef: { provider: "notion", sessionId: "fake-session" },
}

const servers: Array<{ close: () => Promise<void> }> = []

function registry(current: McpSource = source): McpSourceRegistry {
  let stored = current
  return {
    async listSources(requestActor) {
      return requestActor.userId === stored.userId && requestActor.workspaceId === stored.workspaceId ? [stored] : []
    },
    async getSource(sourceId) {
      return sourceId === stored.id ? stored : undefined
    },
    async disconnectSource(_actor, sourceId) {
      if (sourceId !== stored.id) return undefined
      stored = { ...stored, status: "revoked" }
      return stored
    },
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  if (!chunks.length) return undefined
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

function createFakeMcpServer(seenHeaders: string[]) {
  const server = new McpServer({ name: "boring-mcp-protocol-fake", version: "1.0.0" })
  server.registerTool(
    "NOTION_SEARCH_NOTION_PAGE",
    { description: "Search fake Notion pages through a real MCP Streamable HTTP transport" },
    async () => ({ content: [{ type: "text", text: "protocol fake ok" }] }),
  )
  server.registerTool(
    "update_page",
    { description: "Mutating fake tool that boring-mcp must block before provider calls" },
    async () => ({ content: [{ type: "text", text: "should not be called" }] }),
  )

  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url !== "/mcp" || req.method !== "POST") {
      res.statusCode = 404
      res.end("not found")
      return
    }
    seenHeaders.push(String(req.headers["x-test-mcp-session"] ?? ""))
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
})

describe("MCP SDK Streamable HTTP transport", () => {
  it("runs the generic boring-mcp search/describe/read-only bridge over a real fake MCP server", async () => {
    const fake = await listenFakeMcpServer()
    const transport = createMcpSdkStreamableHttpTransport({
      endpoint: { url: fake.url, headers: { "x-test-mcp-session": "server-only-session-header" } },
      clientName: "boring-mcp-test",
      clientVersion: "0.0.0-test",
    })
    const handlers = createBoringMcpSourceHandlers({ registry: registry(), transport })
    const bridge = createBoringMcpAgentBridgeRegistry(handlers)

    await expect(bridge.mcp_servers_list.invoke({ actor }, {})).resolves.toMatchObject({ sources: [expect.objectContaining({ id: source.id })] })
    await expect(bridge.mcp_tools_search.invoke({ actor }, { query: "search" })).resolves.toMatchObject({ tools: [expect.objectContaining({ toolName: "NOTION_SEARCH_NOTION_PAGE" })] })
    const described = await bridge.mcp_tool_describe.invoke({ actor }, { sourceId: source.id, toolName: "NOTION_SEARCH_NOTION_PAGE" }) as McpToolDescribeResult
    await expect(bridge.mcp_readonly_call.invoke({ actor }, {
      sourceId: source.id,
      toolName: "NOTION_SEARCH_NOTION_PAGE",
      expectedSchemaHash: described.tool.schemaHash,
      input: { query: "demo" },
    })).resolves.toEqual({ content: { content: [{ type: "text", text: "protocol fake ok" }] } })

    await expect(bridge.mcp_readonly_call.invoke({ actor }, { sourceId: source.id, toolName: "update_page", input: {} })).rejects.toMatchObject({ code: "MCP_TOOL_NOT_ALLOWED" })
    await expect(handlers.disconnectSource(actor, source.id)).resolves.toMatchObject({ source: { status: "revoked" } })
    await expect(bridge.mcp_readonly_call.invoke({ actor }, { sourceId: source.id, toolName: "NOTION_SEARCH_NOTION_PAGE", input: {} })).rejects.toMatchObject({ code: "MCP_SOURCE_UNAVAILABLE" })

    expect(fake.seenHeaders).toContain("server-only-session-header")
  })

  describe("user-registered connect-time address enforcement", () => {
    it("snapshots a mutable endpoint URL before asynchronous resolution", () => {
      const supplied = new URL("https://mcp.example/stream")
      const snapshot = snapshotMcpEndpointUrl(supplied)
      supplied.hostname = "169.254.169.254"
      expect(snapshot.toString()).toBe("https://mcp.example/stream")
    })

    it("fails over across vetted IPs while preserving Host and refusing redirects or other hostnames", async () => {
      const seenHosts: string[] = []
      const httpServer = createServer((req, res) => {
        seenHosts.push(String(req.headers.host))
        if (req.url === "/redirect") {
          res.statusCode = 302
          res.setHeader("location", "http://unexpected.example/private")
        } else {
          res.statusCode = 200
        }
        res.end("ok")
      })
      await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve))
      const { port } = httpServer.address() as AddressInfo
      servers.push({ close: () => new Promise<void>((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve())) })

      const dispatcher = createPinnedMcpDispatcher("pinned.example", [
        { address: "::1", family: 6 },
        { address: "127.0.0.1", family: 4 },
      ])
      const pinnedFetch = createPinnedMcpFetch(`http://pinned.example:${port}`, dispatcher)
      try {
        await expect(pinnedFetch(`http://pinned.example:${port}/ok`)).resolves.toMatchObject({ status: 200 })
        expect(seenHosts).toEqual([`pinned.example:${port}`])
        await expect(pinnedFetch(`http://pinned.example:${port}/redirect`)).rejects.toThrow()
        await expect(pinnedFetch(`http://unexpected.example:${port}/ok`)).rejects.toThrow()
      } finally {
        await dispatcher.close()
      }
    })
    it("rejects a forged user-registered source that did not cross the factory", async () => {
      const transport = createMcpSdkStreamableHttpTransport({
        endpoint: { url: "https://mcp.example/mcp" },
        dnsResolver: async () => [{ address: "93.184.216.34", family: 4 }],
      })
      await expect(transport.listTools({ ...source, provider: "user-registered" })).rejects.toMatchObject({
        code: "MCP_PROVIDER_CONFIG_INVALID",
        details: { reason: "invalid_user_registration_provenance" },
      })
    })

    it("rejects an endpoint that does not match the factory-linked registration", async () => {
      const transport = createMcpSdkStreamableHttpTransport({
        endpoint: { url: "https://swapped.example/mcp" },
        dnsResolver: async () => [{ address: "93.184.216.34", family: 4 }],
      })
      const { provider: _provider, ...sourceInput } = source
      const registered = createUserRegisteredMcpSource(sourceInput, {
        enabled: true,
        endpoint: "https://registered.example/mcp",
        displayName: sourceInput.displayName,
      })
      await expect(transport.listTools(registered)).rejects.toMatchObject({
        code: "MCP_PROVIDER_CONFIG_INVALID",
        details: { reason: "user_registration_endpoint_mismatch" },
      })
    })

    it("denies a hostname resolving to the metadata service", async () => {
      const dnsResolver = async () => [{ address: "169.254.169.254", family: 4 as const }]
      await expect(resolveUserRegisteredMcpAddresses("metadata.attacker.example", dnsResolver)).rejects.toMatchObject({
        code: "MCP_USER_REGISTERED_ENDPOINT_HOST_BLOCKED",
        details: { reason: "resolved_address_blocked" },
      })

      const transport = createMcpSdkStreamableHttpTransport({
        endpoint: { url: "https://metadata.attacker.example/mcp" },
        dnsResolver,
      })
      const { provider: _provider, ...sourceInput } = source
      await expect(transport.listTools(createUserRegisteredMcpSource(sourceInput, {
        enabled: true,
        endpoint: "https://metadata.attacker.example/mcp",
        displayName: sourceInput.displayName,
      }))).rejects.toMatchObject({
        code: "MCP_USER_REGISTERED_ENDPOINT_HOST_BLOCKED",
      })
    })

    it.each([
      ["IPv4 loopback", "127.0.0.2", 4],
      ["IPv4 private 10/8", "10.1.2.3", 4],
      ["IPv4 private 172.16/12", "172.31.255.1", 4],
      ["IPv4 private 192.168/16", "192.168.1.2", 4],
      ["IPv4 link-local", "169.254.1.2", 4],
      ["IPv6 loopback", "::1", 6],
      ["IPv6 unique-local fc00::/7", "fc00::1", 6],
      ["IPv6 unique-local fd00::/8", "fd12::1", 6],
      ["IPv6 link-local fe80::/10", "febf::1", 6],
      ["IPv4-mapped IPv6 loopback", "::ffff:127.0.0.1", 6],
      ["expanded IPv4-mapped IPv6 loopback", "0:0:0:0:0:ffff:7f00:1", 6],
      ["IPv4-compatible IPv6 private address", "::10.0.0.1", 6],
      ["expanded IPv4-compatible IPv6 loopback", "0:0:0:0:0:0:7f00:1", 6],
      ["IPv4 multicast", "224.0.0.1", 4],
      ["IPv4 reserved", "240.0.0.1", 4],
      ["IPv4 limited broadcast", "255.255.255.255", 4],
      ["IPv4 protocol assignments", "192.0.0.8", 4],
      ["IPv4 benchmarking", "198.18.0.1", 4],
      ["IPv6 multicast", "ff02::1", 6],
      ["IPv6 Teredo", "2001::1", 6],
      ["IPv6 discard-only", "100::1", 6],
      ["IPv6 ORCHID", "2001:10::1", 6],
      ["IPv6 ORCHIDv2", "2001:20::1", 6],
      ["IPv6 documentation", "2001:db8::1", 6],
      ["RFC 8215 local-use NAT64", "64:ff9b:1::a9fe:a9fe", 6],
    ] as const)("denies %s returned by DNS", async (_label, address, family) => {
      await expect(resolveUserRegisteredMcpAddresses("attacker.example", async () => [{ address, family }])).rejects.toMatchObject({
        code: "MCP_USER_REGISTERED_ENDPOINT_HOST_BLOCKED",
        details: { reason: "resolved_address_blocked" },
      })
    })

    it("allows every public resolved IP for pinned failover", async () => {
      await expect(resolveUserRegisteredMcpAddresses("mcp.example", async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
      ])).resolves.toEqual([
        { address: "93.184.216.34", family: 4 },
        { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
      ])
    })

    it("denies a multi-address hostname when any answer is private", async () => {
      await expect(resolveUserRegisteredMcpAddresses("rebind.attacker.example", async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.7", family: 4 },
      ])).rejects.toMatchObject({
        code: "MCP_USER_REGISTERED_ENDPOINT_HOST_BLOCKED",
        details: { reason: "resolved_address_blocked" },
      })
    })

    it("denies an unresolvable hostname", async () => {
      await expect(resolveUserRegisteredMcpAddresses("missing.example", async () => {
        throw Object.assign(new Error("not found"), { code: "ENOTFOUND" })
      })).rejects.toMatchObject({
        code: "MCP_USER_REGISTERED_ENDPOINT_HOST_BLOCKED",
        details: { reason: "dns_resolution_failed" },
      })
    })

    it.each([
      "::ffff:127.0.0.1",
      "0:0:0:0:0:ffff:7f00:1",
      "::127.0.0.1",
      "0:0:0:0:0:0:7f00:1",
      "fc00::1",
      "fe80::1",
      "::1",
    ])(
      "denies blocked IPv6 form %s",
      async (address) => {
        await expect(resolveUserRegisteredMcpAddresses("ipv6.example", async () => [
          { address, family: 6 },
        ])).rejects.toMatchObject({ code: "MCP_USER_REGISTERED_ENDPOINT_HOST_BLOCKED" })
      },
    )
  })
})
