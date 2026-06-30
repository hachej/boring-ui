import { describe, expect, it, vi } from "vitest"
import { MCP_ERROR_CODES, type McpActor, type McpSource } from "../shared"
import { createManagedConnectorAdapter, type ManagedConnectorConfig, type ManagedConnectorProvider, type ManagedConnectorSourceRegistry } from "../server/managedConnectorAdapter"
import type { ManagedConnectorPreflightEvidence } from "../server/managedConnectorPreflight"

const actor: McpActor = { userId: "user-1", workspaceId: "workspace-1" }
const config: ManagedConnectorConfig = {
  provider: "notion",
  displayName: "Notion",
  toolkitId: "notion-toolkit",
  scopes: ["read:pages"],
  connectUrlOrigins: ["https://connect.example"],
}
const preflightEvidence: ManagedConnectorPreflightEvidence = {
  connectorName: "fake-managed-connector",
  isolatedTestProject: true,
  apiKeyStorage: "server-vault",
  browserDtoSamples: [{ status: "connected", providerAccountLabel: "demo@example.com" }],
  redactedLogSamples: [{ message: "ok", authorization: "[REDACTED_MCP_SECRET]" }],
  redactedProviderResultSamples: [{ content: "ok", session_headers: "[REDACTED_MCP_SECRET]" }],
  redactionCanaries: ["MCP_CANARY_DO_NOT_LEAK"],
  revokeDisconnectVerified: true,
  connectedAccountStatusVerified: true,
  vendorRisk: {
    dpaStatus: "approved",
    subprocessorStatus: "approved",
    dataResidencyStatus: "approved",
    incidentHistoryStatus: "approved",
  },
}

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

function createProvider(): ManagedConnectorProvider {
  return {
    startConnect: vi.fn(async ({ sourceId }) => ({
      connectorRef: { provider: "notion", toolkitId: "notion-toolkit", externalSourceId: "provider-source-1", sessionId: "session-1" },
      status: "unconfigured" as const,
      connectUrl: `https://connect.example/${sourceId}`,
      providerAccountLabel: "demo@example.com",
    })),
    refreshStatus: vi.fn(async () => ({ status: "connected" as const, providerAccountLabel: "demo@example.com", lastVerifiedAt: "2026-06-29T20:00:00.000Z" })),
    probe: vi.fn(async () => ({
      tools: [{ name: "NOTION_SEARCH_NOTION_PAGE", description: "Search pages" }, { name: "update_page", description: "Mutate page" }],
      resources: [{ uri: "notion://page/demo", name: "Demo page" }],
    })),
  }
}

function createAdapter(overrides: Partial<Parameters<typeof createManagedConnectorAdapter>[0]> = {}) {
  const provider = createProvider()
  const registry = createRegistry()
  return {
    provider,
    registry,
    adapter: createManagedConnectorAdapter({
      registry,
      provider,
      configs: [config],
      preflightEvidence,
      secretResolver: { resolveSecret: vi.fn(async () => ({ storage: "server-vault" as const, value: "server-only-secret" })) },
      ...overrides,
    }),
  }
}

describe("managed connector adapter", () => {
  it("starts a generic managed connector flow and stores only a secret-free source DTO", async () => {
    const { adapter, provider } = createAdapter()

    const result = await adapter.startConnect(actor, { provider: "notion" })

    expect(result.connectUrl).toBe("https://connect.example/managed:workspace-1:user-1:notion")
    expect(result.source).toEqual(expect.objectContaining({
      id: "managed:workspace-1:user-1:notion",
      provider: "notion",
      status: "unconfigured",
      credentialProvider: "composio-managed",
      connectorRef: expect.objectContaining({ externalSourceId: "provider-source-1", sessionId: "session-1" }),
    }))
    expect(JSON.stringify(result)).not.toContain("server-only-secret")
    expect(provider.startConnect).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ toolkitId: "notion-toolkit" }), sourceId: "managed:workspace-1:user-1:notion" }))
  })

  it("refreshes status and probes normalized read-only tool decisions through fake provider", async () => {
    const { adapter } = createAdapter()

    await adapter.startConnect(actor, { provider: "notion" })
    const status = await adapter.refreshStatus(actor, "managed:workspace-1:user-1:notion")
    const probe = await adapter.probeSource(actor, "managed:workspace-1:user-1:notion")

    expect(status.source.status).toBe("connected")
    expect(status.source.providerAccountLabel).toBe("demo@example.com")
    expect(probe.tools).toEqual([
      expect.objectContaining({ name: "NOTION_SEARCH_NOTION_PAGE", decision: expect.objectContaining({ allowed: true, risk: "read" }) }),
      expect.objectContaining({ name: "update_page", decision: expect.objectContaining({ allowed: false, risk: "write" }) }),
    ])
  })

  it("blocks cross-user status/probe access before provider calls", async () => {
    const { adapter, provider } = createAdapter()

    await adapter.startConnect(actor, { provider: "notion" })
    await expect(adapter.refreshStatus({ ...actor, userId: "other" }, "managed:workspace-1:user-1:notion")).rejects.toMatchObject({ code: MCP_ERROR_CODES.SOURCE_NOT_FOUND })
    await expect(adapter.probeSource({ ...actor, userId: "other" }, "managed:workspace-1:user-1:notion")).rejects.toMatchObject({ code: MCP_ERROR_CODES.SOURCE_NOT_FOUND })
    expect(provider.refreshStatus).not.toHaveBeenCalled()
    expect(provider.probe).not.toHaveBeenCalled()
  })

  it("fails closed when provider responses leak API keys, session headers, tokens, canaries, or the resolved secret", async () => {
    const provider = createProvider()
    provider.startConnect = vi.fn(async () => ({
      connectorRef: { provider: "notion", externalSourceId: "provider-source-1" },
      status: "unconfigured" as const,
      providerAccountLabel: "Bearer abcdefghijklmnop MCP_CANARY_DO_NOT_LEAK server-only-secret",
    }))
    const adapter = createManagedConnectorAdapter({
      registry: createRegistry(),
      provider,
      configs: [config],
      preflightEvidence,
      secretResolver: { resolveSecret: vi.fn(async () => ({ storage: "server-env" as const, value: "server-only-secret" })) },
    })

    await expect(adapter.startConnect(actor, { provider: "notion" })).rejects.toMatchObject({ code: MCP_ERROR_CODES.SECRET_LEAK_GUARD })
  })

  it("fails closed when provider connect URLs contain token-like query params", async () => {
    const provider = createProvider()
    provider.startConnect = vi.fn(async () => ({
      connectorRef: { provider: "notion", externalSourceId: "provider-source-1" },
      status: "unconfigured" as const,
      connectUrl: "https://connect.example/callback?access_token=abcdefghijklmnop&state=ok",
    }))
    const adapter = createManagedConnectorAdapter({
      registry: createRegistry(),
      provider,
      configs: [config],
      preflightEvidence,
      secretResolver: { resolveSecret: vi.fn(async () => ({ storage: "server-env" as const, value: "server-only-secret" })) },
    })

    await expect(adapter.startConnect(actor, { provider: "notion" })).rejects.toMatchObject({ code: MCP_ERROR_CODES.SECRET_LEAK_GUARD })
  })

  it("rejects unsafe or unapproved browser connect URLs", async () => {
    const provider = createProvider()
    provider.startConnect = vi.fn(async () => ({
      connectorRef: { provider: "notion", externalSourceId: "provider-source-1" },
      status: "unconfigured" as const,
      connectUrl: "https://user:pass@connect.example/callback",
    }))
    const adapter = createManagedConnectorAdapter({
      registry: createRegistry(),
      provider,
      configs: [config],
      preflightEvidence,
      secretResolver: { resolveSecret: vi.fn(async () => ({ storage: "server-env" as const, value: "server-only-secret" })) },
    })

    await expect(adapter.startConnect(actor, { provider: "notion" })).rejects.toMatchObject({ code: MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID })
  })

  it("does not require launch preflight evidence at construction, but still requires server-only secret configuration before provider use", async () => {
    const adapter = createManagedConnectorAdapter({
      registry: createRegistry(),
      provider: createProvider(),
      configs: [config],
      secretResolver: { resolveSecret: vi.fn(async () => ({ storage: "browser" as never, value: "server-only-secret" })) },
    })

    await expect(adapter.startConnect(actor, { provider: "notion" })).rejects.toMatchObject({ code: MCP_ERROR_CODES.PROVIDER_CONFIG_INVALID })
  })
})
