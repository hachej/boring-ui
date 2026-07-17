import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import {
  BORING_MCP_PLUGIN_ID,
  DEFAULT_MCP_PROVIDER_TEMPLATES,
  InMemoryMcpRateBudgetGate,
  createBoringMcpAgentBridgeRegistry,
  createBoringMcpSourceHandlers,
  createLegacyManagedConnectorSourceId,
  createManagedConnectorSourceId,
  evaluateBoringMcpLaunchGate,
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
  createFullAppBoringMcpAgentTools,
  createFullAppBoringMcpServerPlugins,
  createFullAppManagedConnectorAdapter,
  createFullAppManagedConnectorSecretResolver,
  readFullAppBoringMcpServerConfig,
  registerFullAppBoringMcpRoutes,
} from '../boringMcp'
import { serverPlugins } from '../plugins'
import type { CoreWorkspaceAgentServer } from '@hachej/boring-core/app/server'

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

function toolJson(result: { content: Array<{ type: string; text: string }> }): unknown {
  return JSON.parse(result.content[0]?.text ?? 'null')
}

function makeRouteHarness(
  provider: ManagedConnectorProvider,
  env: NodeJS.ProcessEnv = { COMPOSIO_API_KEY: 'cmp_test_secret' } as NodeJS.ProcessEnv,
  transport?: McpTransportClient,
  initialSettings: Record<string, unknown> = {},
  options: { authenticated?: boolean; member?: boolean } = {},
) {
  const app = Fastify()
  const settingsByUser = new Map<string, Record<string, unknown>>([[actor.userId, initialSettings]])
  app.decorate('config', { appId: 'full-app-test' } as never)
  app.decorate('userStore', {
    async getUserSettings(userId: string) {
      return { displayName: '', email: '', settings: settingsByUser.get(userId) ?? {} }
    },
    async putUserSettings(userId: string, _appId: string, updates: { settings?: Record<string, unknown> }) {
      const next = updates.settings ?? {}
      settingsByUser.set(userId, next)
      return { displayName: '', email: '', settings: next }
    },
  } as never)
  app.decorate('workspaceStore', {
    async get(workspaceId: string) {
      return workspaceId === actor.workspaceId ? { id: workspaceId, appId: 'full-app-test', name: 'Workspace', createdBy: actor.userId, createdAt: new Date().toISOString(), deletedAt: null, isDefault: true } : null
    },
    async getMemberRole(workspaceId: string, userId: string) {
      return options.member !== false && workspaceId === actor.workspaceId && userId === actor.userId ? 'owner' : null
    },
  } as never)
  app.addHook('onRequest', async (request) => {
    request.user = options.authenticated === false
      ? null
      : { id: actor.userId, email: 'demo@example.com', name: 'Demo', emailVerified: true }
  })
  registerFullAppBoringMcpRoutes(app as unknown as CoreWorkspaceAgentServer, { provider, env, transport })
  return app
}

function evaluateTestBoringMcpLaunchGate() {
  const config = readFullAppBoringMcpServerConfig()
  const launchActor: McpActor = { workspaceId: 'smoke-workspace', userId: 'smoke-user' }
  const launchSource: McpSource = {
    id: 'source:notion:smoke-user',
    workspaceId: launchActor.workspaceId,
    userId: launchActor.userId,
    provider: 'notion',
    displayName: 'Fake Notion',
    status: 'connected',
    ownerKind: 'user',
    credentialProvider: 'composio-managed',
  }
  const registry: McpSourceRegistry = {
    async listSources(requestActor) {
      return requestActor.workspaceId === launchActor.workspaceId && requestActor.userId === launchActor.userId ? [launchSource] : []
    },
    async getSource(sourceId) {
      return sourceId === launchSource.id ? launchSource : undefined
    },
    async disconnectSource(_actor, sourceId) {
      return sourceId === launchSource.id ? { ...launchSource, status: 'revoked' } : undefined
    },
  }
  const transport = fakeTransport()
  const hardening = {
    gate: new InMemoryMcpRateBudgetGate({ maxCalls: 100, maxToolCalls: 10, windowMs: 60_000 }),
    timeoutMs: 1000,
  }
  const handlers = createBoringMcpSourceHandlers({
    registry,
    transport,
    templates: DEFAULT_MCP_PROVIDER_TEMPLATES,
    hardening,
    maxReadonlyInputBytes: config.maxReadonlyInputBytes,
  })

  return evaluateBoringMcpLaunchGate({
    pluginId: BORING_MCP_PLUGIN_ID,
    registry,
    transport,
    bridge: createBoringMcpAgentBridgeRegistry(handlers),
    templates: DEFAULT_MCP_PROVIDER_TEMPLATES,
    hardening,
    maxReadonlyInputBytes: config.maxReadonlyInputBytes,
    docsReviewed: true,
  })
}

describe('full-app boring-mcp binding', () => {
  it('registers the boring-mcp server plugin in app composition', () => {
    expect(boringMcpServerPlugins.map((plugin) => plugin.id)).toContain(BORING_MCP_PLUGIN_ID)
    expect(serverPlugins.map((plugin) => plugin.id)).toContain(BORING_MCP_PLUGIN_ID)
    expect(Object.isFrozen(serverPlugins)).toBe(true)
  })

  it('uses a pure server plugin factory for enabled/disabled config', () => {
    expect(createFullAppBoringMcpServerPlugins({ BORING_MCP_ENABLED: '0' } as NodeJS.ProcessEnv)).toEqual([])
    expect(createFullAppBoringMcpServerPlugins({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toEqual([])
    expect(createFullAppBoringMcpServerPlugins({ NODE_ENV: 'production', BORING_MCP_ENABLED: '1' } as NodeJS.ProcessEnv)).toEqual([])
    expect(createFullAppBoringMcpServerPlugins({ NODE_ENV: 'production', BORING_MCP_PROD_ENABLED: '1' } as NodeJS.ProcessEnv).map((plugin) => plugin.id)).toEqual([BORING_MCP_PLUGIN_ID])
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

  it('exposes per-user source API routes backed by app-owned persistence', async () => {
    const provider: ManagedConnectorProvider = {
      startConnect: vi.fn(async () => ({
        connectorRef: { provider: 'notion', toolkitId: 'notion', sessionId: 'session-1' },
        status: 'unconfigured' as const,
        connectUrl: 'https://app.composio.dev/connect/fake',
      })),
      refreshStatus: vi.fn(async ({ source }) => ({
        status: 'connected' as const,
        providerAccountLabel: 'demo@example.com',
        connectorRef: { ...source.connectorRef, connectedAccountId: 'account-1' },
        lastVerifiedAt: '2026-07-01T06:00:00.000Z',
      })),
      probe: vi.fn(),
      revoke: vi.fn(async () => undefined),
    }
    const tx = fakeTransport()
    const app = makeRouteHarness(provider, { COMPOSIO_API_KEY: 'cmp_test_secret' } as NodeJS.ProcessEnv, tx)
    await app.ready()
    const headers = { 'x-boring-workspace-id': actor.workspaceId }

    const empty = await app.inject({ method: 'GET', url: '/api/v1/boring-mcp/sources', headers })
    expect(empty.statusCode).toBe(200)
    expect(empty.json()).toEqual({ sourceStatuses: [] })

    const connected = await app.inject({ method: 'POST', url: '/api/v1/boring-mcp/connect', headers, payload: { provider: 'notion' } })
    expect(connected.statusCode).toBe(201)
    expect(connected.json()).toMatchObject({ status: { source: { provider: 'notion', status: 'unconfigured' } }, connectUrl: 'https://app.composio.dev/connect/fake' })
    expect(JSON.stringify(connected.json().status)).not.toContain('connect/fake')
    expect(JSON.stringify(connected.json().status)).not.toContain('session-1')

    const listed = await app.inject({ method: 'GET', url: '/api/v1/boring-mcp/sources', headers })
    const sourceId = listed.json().sourceStatuses[0].source.id
    expect(listed.json()).toMatchObject({ sourceStatuses: [expect.objectContaining({ source: expect.objectContaining({ provider: 'notion', status: 'unconfigured' }) })] })

    const refreshed = await app.inject({ method: 'POST', url: '/api/v1/boring-mcp/refresh', headers, payload: { sourceId } })
    expect(refreshed.statusCode).toBe(200)
    expect(refreshed.json()).toMatchObject({ status: { source: { status: 'connected', providerAccountLabel: 'demo@example.com' }, canProbe: true } })

    const toolCatalog = await app.inject({ method: 'POST', url: '/api/v1/boring-mcp/tools', headers, payload: { sourceId } })
    expect(toolCatalog.statusCode).toBe(200)
    expect(toolCatalog.json()).toMatchObject({ tools: [expect.objectContaining({ sourceId, toolName: 'NOTION_SEARCH_NOTION_PAGE', enabled: true })] })
    expect(tx.listTools).toHaveBeenCalled()

    const disconnected = await app.inject({ method: 'POST', url: '/api/v1/boring-mcp/disconnect', headers, payload: { sourceId } })
    expect(disconnected.statusCode).toBe(200)
    expect(disconnected.json()).toMatchObject({ status: { source: { status: 'revoked' }, canDisconnect: false } })
    expect(provider.revoke).toHaveBeenCalled()

    await app.close()
  })

  it('fails closed for unauthenticated, nonmember, foreign, and malformed workspace selectors', async () => {
    const provider: ManagedConnectorProvider = { startConnect: vi.fn(), refreshStatus: vi.fn(), probe: vi.fn() }
    const env = { COMPOSIO_API_KEY: 'cmp_test_secret' } as NodeJS.ProcessEnv
    const headers = { 'x-boring-workspace-id': actor.workspaceId }

    const unauthenticated = makeRouteHarness(provider, env, undefined, {}, { authenticated: false })
    const nonmember = makeRouteHarness(provider, env, undefined, {}, { member: false })
    const authorized = makeRouteHarness(provider, env)
    await Promise.all([unauthenticated.ready(), nonmember.ready(), authorized.ready()])

    expect((await unauthenticated.inject({ method: 'GET', url: '/api/v1/boring-mcp/sources', headers })).statusCode).toBe(401)
    expect((await nonmember.inject({ method: 'GET', url: '/api/v1/boring-mcp/sources', headers })).statusCode).toBe(403)
    expect((await authorized.inject({ method: 'GET', url: '/api/v1/boring-mcp/sources', headers: { 'x-boring-workspace-id': 'foreign-workspace' } })).statusCode).toBe(404)
    expect((await authorized.inject({ method: 'GET', url: '/api/v1/boring-mcp/sources?workspaceId=../bad' })).statusCode).toBe(400)

    await Promise.all([unauthenticated.close(), nonmember.close(), authorized.close()])
  })

  it('normalizes and migrates legacy raw managed source ids on reconnect', async () => {
    const legacySourceId = createLegacyManagedConnectorSourceId(actor, 'notion')
    const opaqueSourceId = createManagedConnectorSourceId(actor, 'notion')
    const legacySource: McpSource = {
      ...source,
      id: legacySourceId,
      provider: 'notion',
      connectorRef: { provider: 'notion', toolkitId: 'notion', sessionId: 'legacy-session' },
    }
    const provider: ManagedConnectorProvider = {
      startConnect: vi.fn(async () => ({
        connectorRef: { provider: 'notion', toolkitId: 'notion', sessionId: 'new-session' },
        status: 'unconfigured' as const,
        connectUrl: 'https://app.composio.dev/connect/fake',
      })),
      refreshStatus: vi.fn(async ({ source }) => ({
        status: 'connected' as const,
        providerAccountLabel: 'legacy@example.com',
        connectorRef: source.connectorRef,
      })),
      probe: vi.fn(),
      revoke: vi.fn(async () => undefined),
    }
    const initialSettings = {
      __serverBoringMcpSourcesV1: {
        [actor.workspaceId]: {
          [legacySourceId]: legacySource,
        },
      },
    }
    const app = makeRouteHarness(provider, { COMPOSIO_API_KEY: 'cmp_test_secret' } as NodeJS.ProcessEnv, fakeTransport(), initialSettings)
    await app.ready()
    const headers = { 'x-boring-workspace-id': actor.workspaceId }

    const listed = await app.inject({ method: 'GET', url: '/api/v1/boring-mcp/sources', headers })
    expect(listed.statusCode).toBe(200)
    expect(listed.json().sourceStatuses.map((status: { source: { id: string } }) => status.source.id)).toEqual([opaqueSourceId])
    expect(JSON.stringify(listed.json())).not.toContain(legacySourceId)

    const refreshedLegacy = await app.inject({ method: 'POST', url: '/api/v1/boring-mcp/refresh', headers, payload: { sourceId: legacySourceId } })
    expect(refreshedLegacy.statusCode).toBe(200)
    expect(refreshedLegacy.json().status.source.id).toBe(opaqueSourceId)

    const connected = await app.inject({ method: 'POST', url: '/api/v1/boring-mcp/connect', headers, payload: { provider: 'notion' } })
    expect(connected.statusCode).toBe(201)
    expect(connected.json().status.source.id).toBe(opaqueSourceId)

    const listedAfterReconnect = await app.inject({ method: 'GET', url: '/api/v1/boring-mcp/sources', headers })
    expect(listedAfterReconnect.json().sourceStatuses.map((status: { source: { id: string } }) => status.source.id)).toEqual([opaqueSourceId])
    expect(JSON.stringify(listedAfterReconnect.json())).not.toContain(legacySourceId)

    await app.close()
  })

  it('maps MCP domain errors from source routes to client-safe HTTP responses', async () => {
    const provider: ManagedConnectorProvider = { startConnect: vi.fn(), refreshStatus: vi.fn(), probe: vi.fn() }
    const app = makeRouteHarness(provider)
    await app.ready()
    const headers = { 'x-boring-workspace-id': actor.workspaceId }

    const unsupported = await app.inject({ method: 'POST', url: '/api/v1/boring-mcp/connect', headers, payload: { provider: 'unsupported-provider' } })
    expect(unsupported.statusCode).toBe(400)
    expect(unsupported.json()).toMatchObject({ code: 'validation_failed' })

    const missing = await app.inject({ method: 'POST', url: '/api/v1/boring-mcp/refresh', headers, payload: { sourceId: 'managed:workspace-1:user-1:notion' } })
    expect(missing.statusCode).toBe(404)
    expect(missing.json()).toMatchObject({ code: 'not_found' })

    await app.close()
  })

  it('does not register source routes or agent tools when boring-mcp is disabled', async () => {
    const provider: ManagedConnectorProvider = { startConnect: vi.fn(), refreshStatus: vi.fn(), probe: vi.fn() }
    const env = { BORING_MCP_ENABLED: '0', COMPOSIO_API_KEY: 'cmp_test_secret' } as NodeJS.ProcessEnv
    const app = makeRouteHarness(provider, env)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/api/v1/boring-mcp/sources', headers: { 'x-boring-workspace-id': actor.workspaceId } })
    expect(res.statusCode).toBe(404)
    expect(createFullAppBoringMcpAgentTools(app as unknown as CoreWorkspaceAgentServer, actor, { transport: fakeTransport(), env })).toEqual([])

    await app.close()
  })

  it('creates user-owned MCP agent tools that can search and call connected sources', async () => {
    const provider: ManagedConnectorProvider = {
      startConnect: vi.fn(async () => ({
        connectorRef: { provider: 'notion', toolkitId: 'notion', sessionId: 'session-1' },
        status: 'unconfigured' as const,
      })),
      refreshStatus: vi.fn(async ({ source }) => ({
        status: 'connected' as const,
        providerAccountLabel: 'demo@example.com',
        connectorRef: { ...source.connectorRef, connectedAccountId: 'account-1' },
        lastVerifiedAt: '2026-07-01T06:00:00.000Z',
      })),
      probe: vi.fn(),
    }
    const app = makeRouteHarness(provider)
    await app.ready()
    const headers = { 'x-boring-workspace-id': actor.workspaceId }
    const connected = await app.inject({ method: 'POST', url: '/api/v1/boring-mcp/connect', headers, payload: { provider: 'notion' } })
    const sourceId = connected.json().status.source.id
    await app.inject({ method: 'POST', url: '/api/v1/boring-mcp/refresh', headers, payload: { sourceId } })

    const tx = fakeTransport()
    const tools = createFullAppBoringMcpAgentTools(app as unknown as CoreWorkspaceAgentServer, actor, { transport: tx })
    const ctx = { toolCallId: 'tool-call-1', abortSignal: new AbortController().signal }
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]))

    await expect(byName.mcp_servers_list.execute({}, ctx).then(toolJson)).resolves.toMatchObject({
      sources: [expect.objectContaining({ id: sourceId, status: 'connected', provider: 'notion' })],
    })
    await expect(byName.mcp_tools_search.execute({ query: 'search' }, ctx).then(toolJson)).resolves.toMatchObject({
      tools: [expect.objectContaining({ sourceId, toolName: 'NOTION_SEARCH_NOTION_PAGE' })],
    })
    const described = await byName.mcp_tool_describe.execute({ sourceId, toolName: 'NOTION_SEARCH_NOTION_PAGE' }, ctx).then(toolJson) as McpToolDescribeResult
    await expect(byName.mcp_readonly_call.execute({ sourceId, toolName: 'NOTION_SEARCH_NOTION_PAGE', expectedSchemaHash: described.tool.schemaHash, input: {} }, ctx).then(toolJson)).resolves.toEqual({ content: { content: [{ type: 'text', text: 'fake ok' }] } })

    await app.close()
  })

  it('passes the app launch gate with a fake boring-mcp stack', () => {
    expect(evaluateTestBoringMcpLaunchGate()).toEqual({ ok: true, issues: [] })
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
