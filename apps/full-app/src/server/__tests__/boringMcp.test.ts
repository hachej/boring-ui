import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  BORING_MCP_PLUGIN_ID,
  DEFAULT_MCP_PROVIDER_TEMPLATES,
  InMemoryMcpRateBudgetGate,
  createBoringMcpAgentBridgeRegistry,
  createBoringMcpSourceHandlers,
  type McpActor,
  type McpSource,
  type ManagedConnectorConfig,
  type ManagedConnectorProvider,
  type ManagedConnectorSourceRegistry,
  type McpSourceRegistry,
  type McpToolDescribeResult,
  type McpTransportClient,
} from '@hachej/boring-mcp/server'
import {
  boringMcpServerPlugins,
  createFullAppBoringMcpServerPlugins,
  createFullAppManagedConnectorAdapter,
  createFullAppManagedConnectorSecretResolver,
  evaluateFullAppBoringMcpLaunchGate,
  readFullAppBoringMcpServerConfig,
} from '../boringMcp'
import { serverPlugins } from '../plugins'

const actor: McpActor = { workspaceId: 'workspace-1', userId: 'user-1' }
const source: McpSource = {
  id: 'source:notion:user-1',
  workspaceId: actor.workspaceId,
  userId: actor.userId,
  provider: 'notion',
  displayName: 'Fake Notion',
  status: 'connected',
  ownerKind: 'user',
  credentialProvider: 'composio-managed',
}

function fakeRegistry(): McpSourceRegistry {
  let current = source
  return {
    async listSources(requestActor) {
      return requestActor.workspaceId === actor.workspaceId && requestActor.userId === actor.userId ? [current] : []
    },
    async getSource(sourceId) {
      return sourceId === current.id ? current : undefined
    },
    async disconnectSource(_actor, sourceId) {
      if (sourceId !== current.id) return undefined
      current = { ...current, status: 'revoked' }
      return current
    },
  }
}

function fakeTransport(): McpTransportClient {
  return {
    listTools: vi.fn(async () => [{ name: 'NOTION_SEARCH_NOTION_PAGE', description: 'Search fake Notion pages', inputSchema: { type: 'object' } }]),
    listResources: vi.fn(async () => []),
    readResource: vi.fn(),
    callTool: vi.fn(async () => ({ content: [{ type: 'text', text: 'fake ok' }] })),
  }
}

function readTree(root: string): string {
  return readdirSync(root).sort().map((entry) => {
    const path = join(root, entry)
    if (statSync(path).isDirectory()) return readTree(path)
    return readFileSync(path, 'utf8')
  }).join('\n')
}

describe('full-app boring-mcp binding', () => {
  it('registers the boring-mcp server plugin in app composition', () => {
    expect(boringMcpServerPlugins.map((plugin) => plugin.id)).toContain(BORING_MCP_PLUGIN_ID)
    expect(serverPlugins.map((plugin) => plugin.id)).toContain(BORING_MCP_PLUGIN_ID)
  })

  it('uses a pure server plugin factory for enabled/disabled config', () => {
    expect(createFullAppBoringMcpServerPlugins({ BORING_MCP_ENABLED: '0' } as NodeJS.ProcessEnv)).toEqual([])
    expect(createFullAppBoringMcpServerPlugins({ BORING_MCP_ENABLED: '1' } as NodeJS.ProcessEnv).map((plugin) => plugin.id)).toEqual([BORING_MCP_PLUGIN_ID])
  })

  it('binds COMPOSIO_API_KEY only through the server-side managed connector secret resolver', async () => {
    const env = { COMPOSIO_API_KEY: 'cmp_test_secret', BORING_MCP_MAX_READONLY_INPUT_BYTES: '1234' } as NodeJS.ProcessEnv

    await expect(createFullAppManagedConnectorSecretResolver(env).resolveSecret('notion')).resolves.toEqual({ storage: 'server-env', value: 'cmp_test_secret' })
    await expect(createFullAppManagedConnectorSecretResolver({} as NodeJS.ProcessEnv).resolveSecret('notion')).rejects.toThrow('COMPOSIO_API_KEY')
    expect(readFullAppBoringMcpServerConfig(env)).toMatchObject({
      enabled: true,
      composioApiKeyConfigured: true,
      maxReadonlyInputBytes: 1234,
    })
    expect(readTree(join(process.cwd(), 'src/front'))).not.toContain('COMPOSIO_API_KEY')
  })

  it('derives supported managed connector providers from connector configs', async () => {
    const configs: readonly ManagedConnectorConfig[] = [
      { provider: 'custom-provider', displayName: 'Custom Provider', toolkitId: 'custom-toolkit' },
    ]
    const resolver = createFullAppManagedConnectorSecretResolver({ COMPOSIO_API_KEY: 'cmp_test_secret' } as NodeJS.ProcessEnv, configs)

    await expect(resolver.resolveSecret('custom-provider')).resolves.toEqual({ storage: 'server-env', value: 'cmp_test_secret' })
    await expect(resolver.resolveSecret('notion')).rejects.toThrow('Unsupported MCP provider: notion')
  })

  it('falls back to the default input limit for unsafe configured values', () => {
    expect(readFullAppBoringMcpServerConfig({ BORING_MCP_MAX_READONLY_INPUT_BYTES: '0' } as NodeJS.ProcessEnv).maxReadonlyInputBytes).toBe(65536)
    expect(readFullAppBoringMcpServerConfig({ BORING_MCP_MAX_READONLY_INPUT_BYTES: '-1' } as NodeJS.ProcessEnv).maxReadonlyInputBytes).toBe(65536)
    expect(readFullAppBoringMcpServerConfig({ BORING_MCP_MAX_READONLY_INPUT_BYTES: 'Infinity' } as NodeJS.ProcessEnv).maxReadonlyInputBytes).toBe(65536)
    expect(readFullAppBoringMcpServerConfig({ BORING_MCP_MAX_READONLY_INPUT_BYTES: '1.5' } as NodeJS.ProcessEnv).maxReadonlyInputBytes).toBe(65536)
  })

  it('wires COMPOSIO_API_KEY into the app-owned managed connector adapter without real provider calls', async () => {
    let current: McpSource | undefined
    const registry: ManagedConnectorSourceRegistry = {
      async listSources() { return current ? [current] : [] },
      async getSource(sourceId) { return current?.id === sourceId ? current : undefined },
      async disconnectSource(_actor, sourceId) { return current?.id === sourceId ? { ...current, status: 'revoked' } : undefined },
      async upsertSource(_actor, next) { current = next; return next },
    }
    const startConnect = vi.fn(async () => ({
      connectorRef: { provider: 'composio', connectorId: 'fake-connector', accountId: 'fake-account' },
      status: 'unconfigured' as const,
      connectUrl: 'https://app.composio.dev/connect/fake',
    }))
    const provider: ManagedConnectorProvider = {
      startConnect,
      refreshStatus: vi.fn(),
      probe: vi.fn(),
    }
    const adapter = createFullAppManagedConnectorAdapter({
      env: { COMPOSIO_API_KEY: 'cmp_test_secret' } as NodeJS.ProcessEnv,
      registry,
      provider,
    })

    await expect(adapter.startConnect(actor, { provider: 'notion' })).resolves.toMatchObject({ source: { credentialProvider: 'composio-managed' } })
    expect(startConnect).toHaveBeenCalledWith(expect.objectContaining({ secret: { storage: 'server-env', value: 'cmp_test_secret' } }))
  })

  it('passes the app launch gate with a fake boring-mcp stack', () => {
    expect(evaluateFullAppBoringMcpLaunchGate()).toEqual({ ok: true, issues: [] })
  })

  it('smokes the generic boring-mcp path with fake provider pieces', async () => {
    const tx = fakeTransport()
    const registry = fakeRegistry()
    const handlers = createBoringMcpSourceHandlers({
      registry,
      transport: tx,
      templates: DEFAULT_MCP_PROVIDER_TEMPLATES,
      hardening: { gate: new InMemoryMcpRateBudgetGate({ maxCalls: 100, maxToolCalls: 10, windowMs: 60_000 }), timeoutMs: 1000 },
      maxReadonlyInputBytes: 4096,
    })
    const bridge = createBoringMcpAgentBridgeRegistry(handlers)

    await expect(bridge.mcp_servers_list.invoke({ actor }, {})).resolves.toMatchObject({ sources: [expect.objectContaining({ id: source.id })] })
    await expect(bridge.mcp_tools_search.invoke({ actor }, { query: 'search' })).resolves.toMatchObject({ tools: [expect.objectContaining({ toolName: 'NOTION_SEARCH_NOTION_PAGE' })] })
    const described = await bridge.mcp_tool_describe.invoke({ actor }, { sourceId: source.id, toolName: 'NOTION_SEARCH_NOTION_PAGE' }) as McpToolDescribeResult
    await expect(bridge.mcp_readonly_call.invoke({ actor }, { sourceId: source.id, toolName: 'NOTION_SEARCH_NOTION_PAGE', expectedSchemaHash: described.tool.schemaHash, input: {} })).resolves.toEqual({ content: { content: [{ type: 'text', text: 'fake ok' }] } })
    await expect(handlers.disconnectSource(actor, source.id)).resolves.toMatchObject({ source: { status: 'revoked' } })
    await expect(bridge.mcp_readonly_call.invoke({ actor }, { sourceId: source.id, toolName: 'NOTION_SEARCH_NOTION_PAGE' })).rejects.toMatchObject({ code: 'MCP_SOURCE_UNAVAILABLE' })

    expect(tx.callTool).toHaveBeenCalledOnce()
  })
})
