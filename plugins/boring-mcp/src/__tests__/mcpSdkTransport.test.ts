import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { AddressInfo } from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { createBoringMcpAgentBridgeRegistry } from "../server/agentBridge"
import { createMcpSdkStreamableHttpTransport } from "../server/mcpSdkTransport"
import { createBoringMcpSourceHandlers } from "../server/sourceHandlers"
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
})
