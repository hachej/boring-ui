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
import { createCoreApp } from '@hachej/boring-core/server'
import { ERROR_CODES, HttpError, type CoreConfig } from '@hachej/boring-core/shared'

const actor: McpActor = { workspaceId: 'workspace-1', userId: 'user-1' }
const authenticated = { authorization: 'Bearer test' }
const scopedRequest = {
  bindingId: 'binding-1', workspaceId: actor.workspaceId,
  defaultDeploymentId: 'deployment-1', activeRevision: 'revision-1',
  resolvedDigest: `sha256:${'a'.repeat(64)}`,
} as const
const routeTestConfig: CoreConfig = {
  appId: 'full-app-test', appName: 'Test', appLogo: null, port: 0, host: '127.0.0.1', staticDir: null,
  databaseUrl: null, stores: 'local', cors: { origins: [], credentials: true }, bodyLimit: 1024 * 1024, logLevel: 'fatal',
  security: { csp: { enabled: false } }, encryption: { workspaceSettingsKey: 'a'.repeat(64) },
  auth: { secret: 's'.repeat(64), url: 'http://localhost:3000', sessionTtlSeconds: 3600, sessionCookieSecure: false },
  features: { githubOauth: false, googleOauth: false, invitesEnabled: false, sendWelcomeEmail: false, inviteTtlDays: 7 },
}
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
      return workspaceId === actor.workspaceId && userId === actor.userId ? 'owner' : null
    },
  } as never)
  app.addHook('onRequest', async (request) => {
    request.user = { id: actor.userId, email: 'demo@example.com', name: 'Demo', emailVerified: true }
  })
  registerFullAppBoringMcpRoutes(app as unknown as CoreWorkspaceAgentServer, { provider, env, transport })
  return app
}

async function makeScopedRouteHarness(scoped = true) {
  let member = true
  const settings = { settings: {}, displayName: '', email: '' }
  const calls = {
    getWorkspace: vi.fn(async (workspaceId: string) => workspaceId === actor.workspaceId
      ? { id: workspaceId, appId: routeTestConfig.appId, name: 'Workspace', createdBy: actor.userId, createdAt: '', deletedAt: null, isDefault: true }
      : null),
    getMemberRole: vi.fn(async (workspaceId: string, userId: string) => member && workspaceId === actor.workspaceId && userId === actor.userId ? 'owner' : null),
    getUserSettings: vi.fn(async () => settings),
    putUserSettings: vi.fn(async () => settings),
    startConnect: vi.fn(async () => ({
      connectorRef: { provider: 'notion', toolkitId: 'notion', sessionId: 'session-1' },
      status: 'unconfigured' as const,
      connectUrl: 'https://app.composio.dev/connect/fake',
    })),
    refreshStatus: vi.fn(),
    revoke: vi.fn(),
  }
  const app = await createCoreApp(routeTestConfig, {
    manageShutdown: false,
    ...(scoped ? { requestScopeResolver: async () => scopedRequest } : {}),
  })
  app.decorate('workspaceStore', { get: calls.getWorkspace, getMemberRole: calls.getMemberRole } as never)
  app.decorate('userStore', { getUserSettings: calls.getUserSettings, putUserSettings: calls.putUserSettings } as never)
  app.addHook('onRequest', async (request) => {
    request.user = null
    if (request.headers.authorization !== authenticated.authorization) {
      throw new HttpError({ status: 401, code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required', requestId: request.id })
    }
    request.user = { id: actor.userId, email: 'demo@example.com', name: 'Demo', emailVerified: true }
  })
  const provider: ManagedConnectorProvider = {
    startConnect: calls.startConnect,
    refreshStatus: calls.refreshStatus,
    probe: vi.fn(),
    revoke: calls.revoke,
  }
  const transport = fakeTransport()
  await app.register(async (routeApp) => {
    routeApp.setErrorHandler((error, _request, reply) => {
      const status = (error as { status?: number; statusCode?: number }).status ?? (error as { statusCode?: number }).statusCode
      const code = status === 429 ? ERROR_CODES.RATE_LIMITED : (error as { code?: string }).code
      return reply.status(status ?? 500).send({ code: code ?? ERROR_CODES.INTERNAL_ERROR })
    })
    registerFullAppBoringMcpRoutes(routeApp as unknown as CoreWorkspaceAgentServer, {
      provider,
      env: { COMPOSIO_API_KEY: 'test-key' } as NodeJS.ProcessEnv,
      transport,
    })
  })
  await app.ready()
  return { app, calls, transport, setMember: (value: boolean) => { member = value } }
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

  it('derives trusted scope and accepts every matching selector before MCP effects', async () => {
    const { app, calls } = await makeScopedRouteHarness()
    const absent = await app.inject({ method: 'GET', url: '/api/v1/boring-mcp/sources', headers: authenticated })
    expect(absent.statusCode).toBe(200)

    const matching = await app.inject({
      method: 'POST',
      url: `/api/v1/boring-mcp/connect?workspaceId=${actor.workspaceId}&workspaceId=${actor.workspaceId}`,
      headers: { ...authenticated, 'x-boring-workspace-id': `${actor.workspaceId}, ${actor.workspaceId}` },
      payload: { workspaceId: actor.workspaceId, provider: 'notion' },
    })
    expect(matching.statusCode).toBe(201)
    expect(calls.getWorkspace).toHaveBeenCalledWith(actor.workspaceId)
    expect(calls.startConnect).toHaveBeenCalledOnce()
    await app.close()
  })

  it('rejects every malformed, conflicting, or foreign scoped selector before downstream work', async () => {
    const { app, calls, transport } = await makeScopedRouteHarness()
    const requests = [
      { method: 'GET' as const, url: '/api/v1/boring-mcp/sources', headers: { ...authenticated, 'x-boring-workspace-id': 'foreign-workspace' } },
      { method: 'GET' as const, url: '/api/v1/boring-mcp/sources', headers: { ...authenticated, 'x-boring-workspace-id': `${actor.workspaceId},foreign-workspace` } },
      { method: 'GET' as const, url: '/api/v1/boring-mcp/sources?workspaceId=../bad', headers: authenticated },
      { method: 'GET' as const, url: `/api/v1/boring-mcp/sources?workspaceId=${actor.workspaceId}&workspaceId=foreign-workspace`, headers: authenticated },
      { method: 'POST' as const, url: '/api/v1/boring-mcp/connect', headers: authenticated, payload: { workspaceId: 42, provider: 'notion' } },
      { method: 'POST' as const, url: '/api/v1/boring-mcp/connect', headers: authenticated, payload: { workspaceId: [], provider: 'notion' } },
      { method: 'POST' as const, url: '/api/v1/boring-mcp/refresh', headers: { ...authenticated, 'x-boring-workspace-id': 'foreign-workspace' }, payload: { sourceId: 'source-1' } },
      { method: 'POST' as const, url: '/api/v1/boring-mcp/disconnect?workspaceId=../bad', headers: authenticated, payload: { sourceId: 'source-1' } },
      { method: 'POST' as const, url: '/api/v1/boring-mcp/tools', headers: authenticated, payload: { workspaceId: 'foreign-workspace', sourceId: 'source-1' } },
    ]
    for (const request of requests) {
      const response = await app.inject(request)
      expect(response.statusCode, response.body).toBe(421)
      expect(response.json()).toMatchObject({ code: ERROR_CODES.D1_HOST_SCOPE_VIOLATION })
    }
    expect(calls.getWorkspace).not.toHaveBeenCalled()
    expect(calls.getMemberRole).not.toHaveBeenCalled()
    expect(calls.getUserSettings).not.toHaveBeenCalled()
    expect(calls.startConnect).not.toHaveBeenCalled()
    expect(calls.refreshStatus).not.toHaveBeenCalled()
    expect(calls.revoke).not.toHaveBeenCalled()
    expect(transport.listTools).not.toHaveBeenCalled()
    await app.close()
  })

  it('charges scoped POST selector failures and nonmembers to one trusted bucket', async () => {
    const { app, calls, setMember } = await makeScopedRouteHarness()
    for (let index = 0; index < 9; index += 1) {
      const denied = await app.inject({
        method: 'POST', url: '/api/v1/boring-mcp/connect',
        headers: { ...authenticated, 'x-boring-workspace-id': `foreign-${index}` }, payload: { provider: 'notion' },
      })
      expect(denied.statusCode).toBe(421)
    }
    setMember(false)
    const nonmember = await app.inject({ method: 'POST', url: '/api/v1/boring-mcp/connect', headers: authenticated, payload: { provider: 'notion' } })
    expect(nonmember.statusCode).toBe(403)
    setMember(true)
    const limited = await app.inject({ method: 'POST', url: '/api/v1/boring-mcp/connect', headers: authenticated, payload: { provider: 'notion' } })
    expect(limited.statusCode).toBe(429)
    expect(limited.json()).toMatchObject({ code: ERROR_CODES.RATE_LIMITED })
    expect(calls.startConnect).not.toHaveBeenCalled()
    await app.close()
  })

  it('bounds scoped GET traffic through the shared Fastify route limiter', async () => {
    const { app, calls } = await makeScopedRouteHarness()
    for (let index = 0; index < 60; index += 1) {
      const denied = await app.inject({ method: 'GET', url: '/api/v1/boring-mcp/sources', headers: { ...authenticated, 'x-boring-workspace-id': `foreign-${index}` } })
      expect(denied.statusCode).toBe(421)
    }
    const limited = await app.inject({ method: 'GET', url: '/api/v1/boring-mcp/sources', headers: authenticated })
    expect(limited.statusCode).toBe(429)
    expect(calls.getWorkspace).not.toHaveBeenCalled()
    expect(calls.getUserSettings).not.toHaveBeenCalled()
    await app.close()
  })

  it('keeps global unauthenticated 401 ahead of the scoped POST limiter', async () => {
    const { app } = await makeScopedRouteHarness()
    const unauthenticated = await app.inject({ method: 'POST', url: '/api/v1/boring-mcp/connect', payload: { provider: 'notion' } })
    expect(unauthenticated.statusCode).toBe(401)
    for (let index = 0; index < 10; index += 1) {
      const denied = await app.inject({
        method: 'POST', url: '/api/v1/boring-mcp/connect',
        headers: { ...authenticated, 'x-boring-workspace-id': `foreign-${index}` }, payload: { provider: 'notion' },
      })
      expect(denied.statusCode).toBe(421)
    }
    const limited = await app.inject({ method: 'POST', url: '/api/v1/boring-mcp/connect', headers: authenticated, payload: { provider: 'notion' } })
    expect(limited.statusCode).toBe(429)
    await app.close()
  })

  it('preserves unscoped GET bypass and POST raw-selector buckets', async () => {
    const { app, setMember } = await makeScopedRouteHarness(false)
    expect((await app.inject({ method: 'GET', url: '/api/v1/boring-mcp/sources' })).statusCode).toBe(401)
    for (let index = 0; index < 61; index += 1) {
      expect((await app.inject({ method: 'GET', url: '/api/v1/boring-mcp/sources', headers: authenticated })).statusCode).toBe(400)
    }
    for (let index = 0; index < 10; index += 1) {
      expect((await app.inject({ method: 'POST', url: '/api/v1/boring-mcp/connect', headers: { ...authenticated, 'x-boring-workspace-id': 'workspace-2' }, payload: { provider: 'notion' } })).statusCode).toBe(404)
    }
    expect((await app.inject({ method: 'POST', url: '/api/v1/boring-mcp/connect', headers: { ...authenticated, 'x-boring-workspace-id': 'workspace-3' }, payload: { provider: 'notion' } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: '/api/v1/boring-mcp/connect', headers: { ...authenticated, 'x-boring-workspace-id': 'workspace-2' }, payload: { provider: 'notion' } })).statusCode).toBe(429)
    setMember(false)
    expect((await app.inject({ method: 'POST', url: '/api/v1/boring-mcp/connect', headers: { ...authenticated, 'x-boring-workspace-id': actor.workspaceId }, payload: { provider: 'notion' } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/api/v1/boring-mcp/sources?workspaceId=../bad', headers: authenticated })).statusCode).toBe(400)
    await app.close()
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
