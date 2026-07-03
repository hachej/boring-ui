import { describe, expect, it, vi } from "vitest"
import { BORING_MCP_AGENT_BRIDGE_TOOL_NAMES, createBoringMcpAgentBridgeRegistry } from "../server/agentBridge"
import {
  createHardenedMcpTransport,
  evaluateBoringMcpLaunchGate,
  InMemoryMcpRateBudgetGate,
  verifyMcpDisconnectResult,
} from "../server/hardening"
import { createBoringMcpSourceHandlers } from "../server/sourceHandlers"
import {
  BORING_MCP_PLUGIN_ID,
  MCP_ERROR_CODES,
  NOTION_MCP_TEMPLATE,
  containsMcpSecret,
  redactMcpSecrets,
  type McpActor,
  type McpReadonlyCallAuditEvent,
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

function registry(current: McpSource = source): McpSourceRegistry {
  return {
    async listSources(requestActor) {
      return requestActor.userId === current.userId && requestActor.workspaceId === current.workspaceId ? [current] : []
    },
    async getSource(sourceId) {
      return sourceId === current.id ? current : undefined
    },
    async disconnectSource() {
      return { ...current, status: "revoked" }
    },
  }
}

function transport(overrides: Partial<McpTransportClient> = {}): McpTransportClient {
  return {
    listTools: vi.fn(async () => [{ name: "NOTION_SEARCH_NOTION_PAGE", description: "Search pages" }]),
    listResources: vi.fn(async () => []),
    readResource: vi.fn(),
    callTool: vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] })),
    ...overrides,
  }
}

function flushMicrotasks(): Promise<void> {
  return Promise.resolve()
}

describe("boring-mcp production hardening", () => {
  it("covers representative redaction canaries for public/audit/error payloads", () => {
    const sourcePayload = { displayName: "access_token=abcdefghijklmnop" }
    const toolPayload = { description: "x-composio-mcp-session: abcdefghijklmnop" }
    const auditPayload: McpReadonlyCallAuditEvent = {
      operation: "mcp_readonly_call",
      outcome: "failure",
      workspaceId: "workspace-1",
      userId: "user-1",
      sourceId: "source:notion:user-1",
      toolName: "NOTION_SEARCH_NOTION_PAGE",
      code: "MCP_PROVIDER_ERROR",
    }
    const errorPayload = { message: "provider leaked client_secret=abcdefghijklmnop" }

    expect(containsMcpSecret(sourcePayload)).toBe(true)
    expect(containsMcpSecret(toolPayload)).toBe(true)
    expect(containsMcpSecret(auditPayload)).toBe(false)
    expect(redactMcpSecrets(errorPayload)).toEqual({ message: "provider leaked [REDACTED_MCP_SECRET]" })
  })

  it("rate/budget gate blocks before provider listTools and callTool", async () => {
    const callTx = transport()
    const callHardened = createHardenedMcpTransport(callTx, { gate: new InMemoryMcpRateBudgetGate({ maxCalls: 10, maxToolCalls: 0, windowMs: 60_000 }) }, actor)
    await expect(callHardened.callTool(source, "NOTION_SEARCH_NOTION_PAGE", {})).rejects.toMatchObject({ code: MCP_ERROR_CODES.RESOURCE_LIMIT_EXCEEDED })
    expect(callTx.callTool).not.toHaveBeenCalled()

    const metadataTx = transport()
    const metadataHardened = createHardenedMcpTransport(metadataTx, { gate: new InMemoryMcpRateBudgetGate({ maxCalls: 1, windowMs: 60_000 }) }, actor)
    await metadataHardened.listTools(source)
    await expect(metadataHardened.listTools(source)).rejects.toMatchObject({ code: MCP_ERROR_CODES.RESOURCE_LIMIT_EXCEEDED })
    expect(metadataTx.listTools).toHaveBeenCalledOnce()
  })

  it("rate/budget gate accounts for each metadata retry attempt", async () => {
    const tx = transport({
      listTools: vi.fn()
        .mockRejectedValueOnce(new Error("temporary upstream failure"))
        .mockResolvedValueOnce([{ name: "NOTION_SEARCH_NOTION_PAGE" }]),
    })
    const hardened = createHardenedMcpTransport(tx, {
      gate: new InMemoryMcpRateBudgetGate({ maxCalls: 1, windowMs: 60_000 }),
      metadataRetries: 1,
    }, actor)

    await expect(hardened.listTools(source)).rejects.toMatchObject({ code: MCP_ERROR_CODES.RESOURCE_LIMIT_EXCEEDED })
    expect(tx.listTools).toHaveBeenCalledOnce()
  })

  it("normalizes and redacts provider metadata errors at the hardened boundary", async () => {
    const tx = transport({ listTools: vi.fn(async () => { throw new Error("provider leaked api_key=abcdefghijklmnop") }) })
    const hardened = createHardenedMcpTransport(tx, {}, actor)

    await expect(hardened.listTools(source)).rejects.toMatchObject({
      code: MCP_ERROR_CODES.PROVIDER_ERROR,
      details: { message: "provider leaked [REDACTED_MCP_SECRET]" },
    })
  })

  it("readonly calls preserve hardening rate-limit codes", async () => {
    const tx = transport()
    const handlers = createBoringMcpSourceHandlers({
      registry: registry(),
      transport: tx,
      hardening: { gate: new InMemoryMcpRateBudgetGate({ maxCalls: 10, maxToolCalls: 0, windowMs: 60_000 }) },
    })

    await expect(handlers.mcp_readonly_call(actor, { sourceId: source.id, toolName: "NOTION_SEARCH_NOTION_PAGE" })).rejects.toMatchObject({ code: MCP_ERROR_CODES.RESOURCE_LIMIT_EXCEEDED })
    expect(tx.callTool).not.toHaveBeenCalled()
  })

  it("provider timeout returns stable code without provider details", async () => {
    vi.useFakeTimers()
    const tx = transport({ listTools: vi.fn(() => new Promise(() => undefined)) as never })
    const hardened = createHardenedMcpTransport(tx, { timeoutMs: 5 }, actor)
    const promise = hardened.listTools(source)
    const expectation = expect(promise).rejects.toMatchObject({ code: MCP_ERROR_CODES.PROVIDER_TIMEOUT, details: undefined })

    await vi.advanceTimersByTimeAsync(5)
    await flushMicrotasks()

    await expectation
    vi.useRealTimers()
  })

  it("disconnect verification checks registry status and never calls provider execution", async () => {
    const tx = transport()
    const revoked = { ...source, status: "revoked" as const }
    const verified = await verifyMcpDisconnectResult(registry(revoked), actor, source.id, revoked)

    expect(verified.source.status).toBe("revoked")
    expect(tx.listTools).not.toHaveBeenCalled()
    expect(tx.callTool).not.toHaveBeenCalled()

    await expect(verifyMcpDisconnectResult(registry(source), actor, source.id, source)).rejects.toMatchObject({ code: MCP_ERROR_CODES.SOURCE_UNAVAILABLE })
  })

  it("launch gate reports missing invariants with stable codes and passes fake configured stack", () => {
    const incompleteTransport = { listTools: vi.fn(), listResources: vi.fn(), callTool: vi.fn() } as unknown as McpTransportClient
    expect(evaluateBoringMcpLaunchGate({ pluginId: BORING_MCP_PLUGIN_ID, transport: incompleteTransport }).issues.map((entry) => entry.code)).toContain("MCP_LAUNCH_TRANSPORT_MISSING")

    const failed = evaluateBoringMcpLaunchGate({ pluginId: "wrong" })
    expect(failed.ok).toBe(false)
    expect(failed.issues.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      "MCP_LAUNCH_PLUGIN_MISSING",
      "MCP_LAUNCH_REGISTRY_INCOMPLETE",
      "MCP_LAUNCH_TRANSPORT_MISSING",
      "MCP_LAUNCH_BRIDGE_TOOL_MISSING",
      "MCP_LAUNCH_RATE_BUDGET_MISSING",
      "MCP_LAUNCH_TIMEOUT_MISSING",
    ]))

    const tx = transport()
    const handlers = createBoringMcpSourceHandlers({ registry: registry(), transport: tx })
    const bridge = createBoringMcpAgentBridgeRegistry(handlers)
    const passed = evaluateBoringMcpLaunchGate({
      pluginId: BORING_MCP_PLUGIN_ID,
      registry: registry(),
      transport: tx,
      bridge,
      templates: [NOTION_MCP_TEMPLATE],
      hardening: { gate: new InMemoryMcpRateBudgetGate({ maxCalls: 10, maxToolCalls: 5, windowMs: 60_000 }), timeoutMs: 1000 },
      maxReadonlyInputBytes: 1024,
      docsReviewed: true,
    })

    expect(BORING_MCP_AGENT_BRIDGE_TOOL_NAMES.every((name) => bridge[name])).toBe(true)
    expect(passed).toEqual({ ok: true, issues: [] })
  })
})
