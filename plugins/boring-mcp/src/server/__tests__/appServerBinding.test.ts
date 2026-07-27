import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import type { CoreWorkspaceAgentServer } from '@hachej/boring-core/app/server'
import {
  createBoringMcpAppBindings,
  createManagedConnectorSecretResolver,
  readBoringMcpServerConfig,
  registerBoringMcpRoutes,
  type BoringMcpAppBindingsConfig,
  type BoringMcpBindingConfig,
} from '../appServerBinding'
import { BORING_MCP_PLUGIN_ID } from '../../shared'
import type { ManagedConnectorConfig } from '../managedConnectorAdapter'

const CONFIGS: readonly ManagedConnectorConfig[] = [
  { provider: 'notion', displayName: 'Notion', toolkitId: 'notion' },
]

const BINDING: BoringMcpBindingConfig = {
  connectorConfigs: CONFIGS,
  clientName: 'boring-mcp-test',
}

describe('readBoringMcpServerConfig', () => {
  it('enables outside production and honors the disable flag', () => {
    expect(readBoringMcpServerConfig({} as NodeJS.ProcessEnv).enabled).toBe(true)
    expect(readBoringMcpServerConfig({ BORING_MCP_ENABLED: '0' } as NodeJS.ProcessEnv).enabled).toBe(false)
    expect(readBoringMcpServerConfig({ NODE_ENV: 'production' } as NodeJS.ProcessEnv).enabled).toBe(false)
    expect(readBoringMcpServerConfig({ NODE_ENV: 'production', BORING_MCP_PROD_ENABLED: '1' } as NodeJS.ProcessEnv).enabled).toBe(true)
  })

  it('reports the composio key across the configured env var fallbacks', () => {
    expect(readBoringMcpServerConfig({ COMPOSIO_API_KEY: 'k' } as NodeJS.ProcessEnv).composioApiKeyConfigured).toBe(true)
    expect(readBoringMcpServerConfig({ ALT_KEY: 'k' } as NodeJS.ProcessEnv, { secretEnvVars: ['COMPOSIO_API_KEY', 'ALT_KEY'] }).composioApiKeyConfigured).toBe(true)
    expect(readBoringMcpServerConfig({} as NodeJS.ProcessEnv).composioApiKeyConfigured).toBe(false)
  })
})

describe('createManagedConnectorSecretResolver', () => {
  it('resolves from the first configured env var and rejects unsupported providers', async () => {
    const resolver = createManagedConnectorSecretResolver({
      env: { ALT_KEY: 'secret-value' } as NodeJS.ProcessEnv,
      configs: CONFIGS,
      secretEnvVars: ['COMPOSIO_API_KEY', 'ALT_KEY'],
    })
    await expect(resolver.resolveSecret('notion')).resolves.toEqual({ storage: 'server-env', value: 'secret-value' })
    await expect(resolver.resolveSecret('airtable')).rejects.toThrow('Unsupported MCP provider: airtable')
    await expect(
      createManagedConnectorSecretResolver({ env: {} as NodeJS.ProcessEnv, configs: CONFIGS }).resolveSecret('notion'),
    ).rejects.toThrow('COMPOSIO_API_KEY is not configured')
  })
})

describe('registerBoringMcpRoutes disabled behavior', () => {
  const disabledEnv = { NODE_ENV: 'production' } as NodeJS.ProcessEnv

  it('skips route registration by default (client sees 404)', async () => {
    const app = Fastify()
    registerBoringMcpRoutes(app as unknown as CoreWorkspaceAgentServer, { config: BINDING, env: disabledEnv })
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/api/v1/boring-mcp/sources', headers: { 'x-boring-workspace-id': 'w1' } })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('serves a stable 503 when whenDisabled is serve-503', async () => {
    const app = Fastify()
    // The core host maps HttpError.status to the HTTP status; mirror that here.
    app.setErrorHandler((error: unknown, _request, reply) => {
      const err = error as { status?: number; statusCode?: number; code?: string; message?: string }
      const status = err.status ?? err.statusCode ?? 500
      reply.code(status).send({ code: err.code ?? 'internal', message: err.message })
    })
    registerBoringMcpRoutes(app as unknown as CoreWorkspaceAgentServer, { config: BINDING, env: disabledEnv, whenDisabled: 'serve-503' })
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/api/v1/boring-mcp/sources', headers: { 'x-boring-workspace-id': 'w1' } })
    expect(res.statusCode).toBe(503)
    await app.close()
  })
})

describe('createBoringMcpAppBindings', () => {
  const APP_CONFIG: BoringMcpAppBindingsConfig = {
    connectorConfigs: CONFIGS,
    secretEnvVars: ['COMPOSIO_API_KEY', 'ALT_KEY'],
    clientName: 'boring-mcp-app-test',
    systemPrompt: 'stub system prompt',
    whenDisabled: 'serve-503',
  }

  it('pre-binds readConfig secret env vars and resolves in configured order', async () => {
    const bindings = createBoringMcpAppBindings(APP_CONFIG)
    // secretEnvVars from config drive both the runtime config and the resolver.
    expect(bindings.readConfig({ ALT_KEY: 'k' } as NodeJS.ProcessEnv).composioApiKeyConfigured).toBe(true)
    expect(bindings.readConfig({} as NodeJS.ProcessEnv).composioApiKeyConfigured).toBe(false)

    const resolver = bindings.createSecretResolver({ ALT_KEY: 'from-alt' } as NodeJS.ProcessEnv)
    await expect(resolver.resolveSecret('notion')).resolves.toEqual({ storage: 'server-env', value: 'from-alt' })
    // Primary env var wins over the fallback when both are present.
    const primary = bindings.createSecretResolver({ COMPOSIO_API_KEY: 'primary', ALT_KEY: 'alt' } as NodeJS.ProcessEnv)
    await expect(primary.resolveSecret('notion')).resolves.toEqual({ storage: 'server-env', value: 'primary' })
    await expect(resolver.resolveSecret('airtable')).rejects.toThrow('Unsupported MCP provider: airtable')
  })

  it('contributes an enabled server plugin only when boring-mcp is enabled', () => {
    const bindings = createBoringMcpAppBindings(APP_CONFIG)
    expect(bindings.createServerPlugins({ BORING_MCP_ENABLED: '0' } as NodeJS.ProcessEnv)).toEqual([])
    expect(bindings.createServerPlugins({ BORING_MCP_ENABLED: '1' } as NodeJS.ProcessEnv).map((plugin) => plugin.id))
      .toEqual([BORING_MCP_PLUGIN_ID])
  })

  it('honors the config whenDisabled when registering routes', async () => {
    const bindings = createBoringMcpAppBindings(APP_CONFIG)
    const app = Fastify()
    app.setErrorHandler((error: unknown, _request, reply) => {
      const err = error as { status?: number; statusCode?: number; code?: string; message?: string }
      reply.code(err.status ?? err.statusCode ?? 500).send({ code: err.code ?? 'internal', message: err.message })
    })
    bindings.registerRoutes(app as unknown as CoreWorkspaceAgentServer, { env: { NODE_ENV: 'production' } as NodeJS.ProcessEnv })
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/api/v1/boring-mcp/sources', headers: { 'x-boring-workspace-id': 'w1' } })
    expect(res.statusCode).toBe(503)
    await app.close()
  })

  it('registers working per-user source routes from a stub app', async () => {
    const bindings = createBoringMcpAppBindings({ ...APP_CONFIG, whenDisabled: 'skip' })
    const settings = new Map<string, Record<string, unknown>>([['user-1', {}]])
    const app = Fastify()
    app.decorate('config', { appId: 'app-test' } as never)
    app.decorate('userStore', {
      async getUserSettings(userId: string) { return { displayName: '', email: '', settings: settings.get(userId) ?? {} } },
      async putUserSettings(userId: string, _appId: string, updates: { settings?: Record<string, unknown> }) {
        settings.set(userId, updates.settings ?? {})
        return { displayName: '', email: '', settings: updates.settings ?? {} }
      },
    } as never)
    app.decorate('workspaceStore', {
      async get(workspaceId: string) { return workspaceId === 'w1' ? { id: 'w1', appId: 'app-test', name: 'W', createdBy: 'user-1', createdAt: '', deletedAt: null, isDefault: true } : null },
      async getMemberRole(workspaceId: string, userId: string) { return workspaceId === 'w1' && userId === 'user-1' ? 'owner' : null },
    } as never)
    app.addHook('onRequest', async (request) => {
      request.user = { id: 'user-1', email: 'd@e.com', name: 'D', emailVerified: true }
    })
    bindings.registerRoutes(app as unknown as CoreWorkspaceAgentServer, { env: { COMPOSIO_API_KEY: 'k' } as NodeJS.ProcessEnv })
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/api/v1/boring-mcp/sources', headers: { 'x-boring-workspace-id': 'w1' } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ sourceStatuses: [] })
    await app.close()
  })
})
