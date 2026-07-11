import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import type { CoreWorkspaceAgentServer } from '@hachej/boring-core/app/server'
import {
  createManagedConnectorSecretResolver,
  readBoringMcpServerConfig,
  registerBoringMcpRoutes,
  type BoringMcpBindingConfig,
} from '../appServerBinding'
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
