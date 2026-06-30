import { describe, expect, it, vi } from "vitest"
import { createBoringMcpReadonlyCaller } from "../server/readonlyCall"
import {
  MCP_ERROR_CODES,
  type McpActor,
  type McpDiscoveredTool,
  type McpReadonlyCallAuditEvent,
  type McpToolCallResult,
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
  description: "Search pages",
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

function transport(tools: McpDiscoveredTool[], result: McpToolCallResult = { content: [{ type: "text", text: "ok" }] }): McpTransportClient {
  return {
    listTools: vi.fn(async () => tools),
    listResources: vi.fn(async () => []),
    readResource: vi.fn(),
    callTool: vi.fn(async () => result),
  }
}

function auditSink() {
  const events: McpReadonlyCallAuditEvent[] = []
  return { events, audit: { record: vi.fn((event: McpReadonlyCallAuditEvent) => { events.push(event) }) } }
}

describe("boring-mcp governed read-only execution", () => {
  it("executes an allowlisted read-only call through a fake transport", async () => {
    const tx = transport([readonlyTool])
    const { audit, events } = auditSink()
    const caller = createBoringMcpReadonlyCaller({ registry: registry(), transport: tx, audit })

    const result = await caller.callReadonly(actor, { sourceId: source.id, toolName: readonlyTool.name, input: { query: "demo" } })

    expect(result).toEqual({ content: { content: [{ type: "text", text: "ok" }] } })
    expect(tx.callTool).toHaveBeenCalledWith(source, readonlyTool.name, { query: "demo" })
    expect(events).toEqual([expect.objectContaining({ operation: "mcp_readonly_call", outcome: "success", sourceId: source.id, toolName: readonlyTool.name })])
    expect(JSON.stringify(events)).not.toMatch(/query|ok|token|session/i)
  })

  it("blocks mutating tools before provider execution and audits the block", async () => {
    const tx = transport([{ name: "update_page", inputSchema: { type: "object" } }])
    const { audit, events } = auditSink()
    const caller = createBoringMcpReadonlyCaller({ registry: registry(), transport: tx, audit })

    await expect(caller.callReadonly(actor, { sourceId: source.id, toolName: "update_page", input: { title: "new" } })).rejects.toMatchObject({ code: MCP_ERROR_CODES.TOOL_NOT_ALLOWED })

    expect(tx.listTools).not.toHaveBeenCalled()
    expect(tx.callTool).not.toHaveBeenCalled()
    expect(events).toEqual([expect.objectContaining({ outcome: "blocked", code: MCP_ERROR_CODES.TOOL_NOT_ALLOWED, toolName: "update_page" })])
  })

  it("blocks unknown/disabled tools before provider discovery", async () => {
    const tx = transport([{ name: "NOTION_LIST_DATABASES" }])
    const caller = createBoringMcpReadonlyCaller({ registry: registry(), transport: tx })

    await expect(caller.callReadonly(actor, { sourceId: source.id, toolName: "NOTION_LIST_DATABASES" })).rejects.toMatchObject({ code: MCP_ERROR_CODES.TOOL_NOT_ALLOWED })

    expect(tx.listTools).not.toHaveBeenCalled()
    expect(tx.callTool).not.toHaveBeenCalled()
  })

  it("rejects malformed requests before provider discovery and audits a sanitized block", async () => {
    const tx = transport([readonlyTool])
    const { audit, events } = auditSink()
    const caller = createBoringMcpReadonlyCaller({ registry: registry(), transport: tx, audit })

    await expect(caller.callReadonly(actor, { sourceId: source.id } as never)).rejects.toMatchObject({ code: MCP_ERROR_CODES.INPUT_INVALID })

    expect(tx.listTools).not.toHaveBeenCalled()
    expect(tx.callTool).not.toHaveBeenCalled()
    expect(events).toEqual([expect.objectContaining({ outcome: "blocked", code: MCP_ERROR_CODES.INPUT_INVALID, sourceId: source.id, toolName: "[invalid]" })])
  })

  it("blocks secret-like input before provider discovery", async () => {
    const tx = transport([readonlyTool])
    const caller = createBoringMcpReadonlyCaller({ registry: registry(), transport: tx })

    await expect(caller.callReadonly(actor, { sourceId: source.id, toolName: readonlyTool.name, input: { access_token: "abcdefghijklmnop" } })).rejects.toMatchObject({ code: MCP_ERROR_CODES.SECRET_LEAK_GUARD })

    expect(tx.listTools).not.toHaveBeenCalled()
    expect(tx.callTool).not.toHaveBeenCalled()
  })

  it("rejects non-json-safe input before provider discovery", async () => {
    const tx = transport([readonlyTool])
    const caller = createBoringMcpReadonlyCaller({ registry: registry(), transport: tx })

    await expect(caller.callReadonly(actor, { sourceId: source.id, toolName: readonlyTool.name, input: { at: new Date() } })).rejects.toMatchObject({ code: MCP_ERROR_CODES.INPUT_INVALID })
    await expect(caller.callReadonly(actor, { sourceId: source.id, toolName: readonlyTool.name, input: { limit: Number.NaN } })).rejects.toMatchObject({ code: MCP_ERROR_CODES.INPUT_INVALID })

    expect(tx.listTools).not.toHaveBeenCalled()
    expect(tx.callTool).not.toHaveBeenCalled()
  })

  it("sanitizes invalid audit labels that look secret-like", async () => {
    const tx = transport([readonlyTool])
    const { audit, events } = auditSink()
    const caller = createBoringMcpReadonlyCaller({ registry: registry(), transport: tx, audit })

    await expect(caller.callReadonly(actor, { sourceId: "access_token=abcdefghijklmnop", toolName: "bad name" } as never)).rejects.toMatchObject({ code: MCP_ERROR_CODES.INPUT_INVALID })

    expect(events).toEqual([expect.objectContaining({ outcome: "blocked", sourceId: "[invalid]", toolName: "[invalid]" })])
    expect(JSON.stringify(events)).not.toContain("abcdefghijklmnop")
    expect(tx.listTools).not.toHaveBeenCalled()
    expect(tx.callTool).not.toHaveBeenCalled()
  })

  it("blocks disconnected and unowned sources before provider discovery", async () => {
    const tx = transport([readonlyTool])
    const disconnectedCaller = createBoringMcpReadonlyCaller({ registry: registry({ ...source, status: "expired" }), transport: tx })

    await expect(disconnectedCaller.callReadonly(actor, { sourceId: source.id, toolName: readonlyTool.name })).rejects.toMatchObject({ code: MCP_ERROR_CODES.SOURCE_UNAVAILABLE })
    await expect(disconnectedCaller.callReadonly({ ...actor, userId: "other" }, { sourceId: source.id, toolName: readonlyTool.name })).rejects.toMatchObject({ code: MCP_ERROR_CODES.SOURCE_NOT_FOUND })

    expect(tx.listTools).not.toHaveBeenCalled()
    expect(tx.callTool).not.toHaveBeenCalled()
  })

  it("blocks unknown providers before provider discovery", async () => {
    const tx = transport([readonlyTool])
    const caller = createBoringMcpReadonlyCaller({ registry: registry({ ...source, provider: "custom" as never }), transport: tx })

    await expect(caller.callReadonly(actor, { sourceId: source.id, toolName: readonlyTool.name })).rejects.toMatchObject({ code: MCP_ERROR_CODES.TOOL_NOT_ALLOWED })

    expect(tx.listTools).not.toHaveBeenCalled()
    expect(tx.callTool).not.toHaveBeenCalled()
  })

  it("blocks schema drift before provider execution", async () => {
    const tx = transport([readonlyTool])
    const { audit, events } = auditSink()
    const caller = createBoringMcpReadonlyCaller({ registry: registry(), transport: tx, audit })
    const staleHash = `sha256:${"0".repeat(64)}`

    await expect(caller.callReadonly(actor, { sourceId: source.id, toolName: readonlyTool.name, expectedSchemaHash: staleHash })).rejects.toMatchObject({ code: MCP_ERROR_CODES.PROVIDER_TOOL_DRIFT })

    expect(tx.listTools).toHaveBeenCalledOnce()
    expect(tx.callTool).not.toHaveBeenCalled()
    expect(events).toEqual([expect.objectContaining({ outcome: "blocked", code: MCP_ERROR_CODES.PROVIDER_TOOL_DRIFT, expectedSchemaHash: staleHash })])
  })

  it("does not audit invalid or secret-like expected schema hashes", async () => {
    const tx = transport([readonlyTool])
    const { audit, events } = auditSink()
    const caller = createBoringMcpReadonlyCaller({ registry: registry(), transport: tx, audit })

    await expect(caller.callReadonly(actor, { sourceId: source.id, toolName: readonlyTool.name, expectedSchemaHash: "access_token=abcdefghijklmnop" })).rejects.toMatchObject({ code: MCP_ERROR_CODES.INPUT_INVALID })
    await expect(caller.callReadonly(actor, { sourceId: source.id, toolName: readonlyTool.name, expectedSchemaHash: `sha256:${"A".repeat(64)}` })).rejects.toMatchObject({ code: MCP_ERROR_CODES.INPUT_INVALID })

    expect(events).toEqual([
      expect.objectContaining({ outcome: "blocked", expectedSchemaHash: undefined }),
      expect.objectContaining({ outcome: "blocked", expectedSchemaHash: undefined }),
    ])
    expect(JSON.stringify(events)).not.toContain("abcdefghijklmnop")
    expect(tx.listTools).not.toHaveBeenCalled()
    expect(tx.callTool).not.toHaveBeenCalled()
  })

  it("blocks oversized input before provider execution", async () => {
    const tx = transport([readonlyTool])
    const caller = createBoringMcpReadonlyCaller({ registry: registry(), transport: tx, maxInputBytes: 16 })

    await expect(caller.callReadonly(actor, { sourceId: source.id, toolName: readonlyTool.name, input: { query: "x".repeat(100) } })).rejects.toMatchObject({ code: MCP_ERROR_CODES.RESOURCE_LIMIT_EXCEEDED })

    expect(tx.listTools).not.toHaveBeenCalled()
    expect(tx.callTool).not.toHaveBeenCalled()
  })

  it("does not let audit failures mask successful calls", async () => {
    const tx = transport([readonlyTool])
    const audit = { record: vi.fn(() => { throw new Error("audit offline") }) }
    const caller = createBoringMcpReadonlyCaller({ registry: registry(), transport: tx, audit })

    await expect(caller.callReadonly(actor, { sourceId: source.id, toolName: readonlyTool.name, input: { query: "demo" } })).resolves.toEqual({ content: { content: [{ type: "text", text: "ok" }] } })
  })

  it("rejects secret-like provider output and audits without payloads", async () => {
    const tx = transport([readonlyTool], { content: [{ type: "text", text: "access_token=abcdefghijklmnop" }] })
    const { audit, events } = auditSink()
    const caller = createBoringMcpReadonlyCaller({ registry: registry(), transport: tx, audit })

    await expect(caller.callReadonly(actor, { sourceId: source.id, toolName: readonlyTool.name })).rejects.toMatchObject({ code: MCP_ERROR_CODES.SECRET_LEAK_GUARD })

    expect(tx.callTool).toHaveBeenCalledOnce()
    expect(events).toEqual([expect.objectContaining({ outcome: "failure", code: MCP_ERROR_CODES.SECRET_LEAK_GUARD })])
    expect(JSON.stringify(events)).not.toContain("abcdefghijklmnop")
  })

  it("redacts provider errors and audits failures", async () => {
    const tx = transport([readonlyTool])
    tx.callTool = vi.fn(async () => { throw new Error("upstream leaked api_key=abcdefghijklmnop") })
    const { audit, events } = auditSink()
    const caller = createBoringMcpReadonlyCaller({ registry: registry(), transport: tx, audit })

    await expect(caller.callReadonly(actor, { sourceId: source.id, toolName: readonlyTool.name })).rejects.toMatchObject({
      code: MCP_ERROR_CODES.PROVIDER_ERROR,
      details: { message: "upstream leaked [REDACTED_MCP_SECRET]" },
    })
    expect(events).toEqual([expect.objectContaining({ outcome: "failure", code: MCP_ERROR_CODES.PROVIDER_ERROR })])
  })
})
