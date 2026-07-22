import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ERROR_CODES } from '../../../shared/errors.js'
import type { TelemetrySink } from '../../../shared/telemetry.js'
import type { CoreConfig } from '../../../shared/types.js'

const agentMock = vi.hoisted(() => ({
  registerOptions: [] as Array<Record<string, unknown>>,
}))

const coreAppMock = vi.hoisted(() => ({
  debugLogs: [] as unknown[][],
}))

const dbMock = vi.hoisted(() => {
  const rows: Array<Record<string, unknown>> = []
  const values = vi.fn((row: Record<string, unknown>) => {
    rows.push(row)
    return Promise.resolve()
  })
  const insert = vi.fn(() => ({ values }))
  return { rows, insert, values }
})

vi.mock('@hachej/boring-agent/server', () => ({
  autoDetectMode: () => 'direct',
  compactPiPackages: (packages: unknown[]) => packages,
  registerAgentRoutes: async (_app: unknown, opts: Record<string, unknown>) => {
    agentMock.registerOptions.push(opts)
  },
}))

vi.mock('@hachej/boring-workspace/app/server', () => ({
  collectWorkspaceAgentServerPlugins: () => ({
    agentOptions: {
      extraTools: [],
      pi: undefined,
      systemPromptAppend: undefined,
    },
    preservedUiStateKeys: [],
    provisioningContributions: [],
    routeContributions: [],
    shutdownContributions: [],
  }),
  createSandboxRuntimeModeAdapter: () => ({ id: 'direct' }),
  hasDirServerPlugin: () => false,
  provisionWorkspaceAgentServer: vi.fn(),
  readWorkspacePluginPackagePiSnapshot: () => ({
    additionalSkillPaths: [],
    extensionFactories: [],
    extensionPaths: [],
    packages: [],
    systemPromptAppend: undefined,
  }),
  readWorkspacePluginPackageRuntimePlugins: () => [],
  resolveDefaultWorkspacePluginPackagePaths: () => [],
  resolveOnePluginEntry: async (entry: unknown) => entry,
  sandboxRuntimeHostOperations: {},
}))

vi.mock('@hachej/boring-workspace/server', () => ({
  createBrowserBridgeAuthPolicy: () => vi.fn(),
  createInMemoryBridge: () => ({
    drainCommands: vi.fn(),
    getState: vi.fn(),
    emitUiEffect: vi.fn(),
    setState: vi.fn(),
    subscribeCommands: vi.fn(),
  }),
  createWorkspaceBridgeRegistry: () => ({
    call: vi.fn(),
    getDefinition: vi.fn(),
    registerHandler: vi.fn(),
  }),
  createWorkspaceUiTools: () => [],
  InMemoryWorkspaceBridgeIdempotencyStore: class InMemoryWorkspaceBridgeIdempotencyStore {},
  uiRoutes: async () => {},
  workspaceBridgeHttpRoutes: async () => {},
}))

vi.mock('../../../server/auth/index.js', () => ({
  authHook: async () => {},
  createAuth: () => ({
    handler: vi.fn(),
  }),
}))

vi.mock('../../../server/app/index.js', () => ({
  createCoreApp: async (config: CoreConfig, options?: { requestScopeResolver?: (request: unknown) => Promise<unknown> }) => {
    const app = Fastify({ logger: false })
    app.decorate('config', config)
    if (options?.requestScopeResolver) {
      app.addHook('onRequest', async (request) => {
        request.requestScope = await options.requestScopeResolver!(request) as never
      })
    }
    app.log.debug = (...args: unknown[]) => {
      coreAppMock.debugLogs.push(args)
    }
    return app
  },
  registerRoutes: async () => {},
}))

vi.mock('../../../server/routes/index.js', () => ({
  registerInviteRoutes: async () => {},
  registerMemberRoutes: async () => {},
  registerSettingsRoutes: async () => {},
  registerWorkspaceRoutes: async () => {},
}))

vi.mock('../../../server/db/index.js', () => ({
  createDatabase: () => ({
    db: dbMock,
    sql: { end: vi.fn() },
  }),
  PostgresUserStore: class PostgresUserStore {},
  PostgresWorkspaceStore: class PostgresWorkspaceStore {},
}))

vi.mock('../../../server/config/index.js', () => ({
  loadConfig: async () => ({
    appId: 'test-app',
    cors: { origins: ['http://localhost:3000'], credentials: true },
    auth: { url: 'http://localhost:3000' },
    encryption: { workspaceSettingsKey: 'test-key' },
    stores: 'postgres',
  }),
}))

vi.mock('../../../server/runtime/index.js', () => ({
  WorkspaceRuntimeSandboxHandleStore: class WorkspaceRuntimeSandboxHandleStore {},
}))

const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')

function resetTelemetryEnv(): void {
  delete process.env.BORING_TELEMETRY_ENABLED
}

async function flushTelemetry(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

async function createBuiltFrontendRoot(): Promise<string> {
  const appRoot = await mkdtemp(join(tmpdir(), 'boring-core-telemetry-'))
  const frontDir = join(appRoot, 'dist', 'front')
  await mkdir(frontDir, { recursive: true })
  await writeFile(join(frontDir, 'index.html'), '<!doctype html><html><body>app</body></html>')
  return appRoot
}

describe('createCoreWorkspaceAgentServer telemetry wiring', () => {
  beforeEach(() => {
    resetTelemetryEnv()
    agentMock.registerOptions.length = 0
    coreAppMock.debugLogs.length = 0
    dbMock.rows.length = 0
    dbMock.insert.mockClear()
    dbMock.values.mockClear()
  })

  afterEach(() => {
    resetTelemetryEnv()
    vi.clearAllMocks()
  })

  it('uses the core DB telemetry env helper by default and passes the sink to agent routes', async () => {
    process.env.BORING_TELEMETRY_ENABLED = 'true'

    const app = await createCoreWorkspaceAgentServer({ serveFrontend: false })
    try {
      const telemetry = agentMock.registerOptions[0]?.telemetry as TelemetrySink | undefined
      telemetry?.capture({
        name: 'agent.chat.started',
        distinctId: 'user_123',
        properties: { workspaceId: 'workspace_1', prompt: 'do not send' },
      })
      await flushTelemetry()

      expect(agentMock.registerOptions, 'agent routes should be registered once').toHaveLength(1)
      expect(telemetry, 'resolved telemetry sink should be passed to agent routes').toBeDefined()
      expect(dbMock.rows).toEqual([
        {
          appId: 'test-app',
          eventName: 'agent.chat.started',
          distinctId: 'user_123',
          properties: { workspaceId: 'workspace_1' },
        },
      ])
      expect(JSON.stringify(dbMock.rows)).not.toContain('do not send')
      expect(coreAppMock.debugLogs).toContainEqual([
        { telemetry: { source: 'db-env' } },
        'resolved telemetry sink',
      ])
    } finally {
      await app.close()
    }
  })

  it('lets a custom telemetry sink override DB helper creation', async () => {
    process.env.BORING_TELEMETRY_ENABLED = 'true'
    const customTelemetry: TelemetrySink = { capture: vi.fn() }

    const app = await createCoreWorkspaceAgentServer({
      serveFrontend: false,
      telemetry: customTelemetry,
    })
    try {
      expect(agentMock.registerOptions[0]?.telemetry).toBe(customTelemetry)
      expect(dbMock.insert, 'custom sink should bypass DB telemetry helper').not.toHaveBeenCalled()
      expect(coreAppMock.debugLogs).toContainEqual([
        { telemetry: { source: 'custom' } },
        'resolved telemetry sink',
      ])
    } finally {
      await app.close()
    }
  })

  it('passes noop telemetry when env telemetry is disabled', async () => {
    const app = await createCoreWorkspaceAgentServer({ serveFrontend: false })
    try {
      const telemetry = agentMock.registerOptions[0]?.telemetry as TelemetrySink | undefined
      telemetry?.capture({ name: 'app.opened' })
      await flushTelemetry()

      expect(telemetry, 'disabled env still passes a safe noop sink').toBeDefined()
      expect(dbMock.rows).toEqual([])
      expect(coreAppMock.debugLogs).toContainEqual([
        { telemetry: { source: 'noop-env' } },
        'resolved telemetry sink',
      ])
    } finally {
      await app.close()
    }
  })

  it('emits app.opened when the server shell is served without raw URL data', async () => {
    const capture = vi.fn()
    const app = await createCoreWorkspaceAgentServer({
      appRoot: await createBuiltFrontendRoot(),
      serveFrontend: true,
      telemetry: { capture },
    })
    try {
      const res = await app.inject({ method: 'GET', url: '/workspace/private-path?token=secret' })

      expect(res.statusCode).toBe(200)
      expect(capture).toHaveBeenCalledWith({
        name: 'app.opened',
        properties: { requestId: expect.any(String) },
      })
      expect(JSON.stringify(capture.mock.calls)).not.toContain('private-path')
      expect(JSON.stringify(capture.mock.calls)).not.toContain('secret')
    } finally {
      await app.close()
    }
  })

  it('emits server.request.failed with stable metadata only', async () => {
    const capture = vi.fn()
    const app = await createCoreWorkspaceAgentServer({ serveFrontend: false, telemetry: { capture } })
    app.get('/boom/private-path', async () => {
      throw new Error('raw secret failure with /tmp/private-path')
    })
    try {
      const res = await app.inject({ method: 'GET', url: '/boom/private-path?cookie=secret' })

      expect(res.statusCode).toBe(500)
      expect(capture).toHaveBeenCalledWith({
        name: 'server.request.failed',
        properties: {
          requestId: expect.any(String),
          status: 500,
          errorCode: ERROR_CODES.INTERNAL_ERROR,
        },
      })
      expect(JSON.stringify(capture.mock.calls)).not.toContain('private-path')
      expect(JSON.stringify(capture.mock.calls)).not.toContain('secret')
    } finally {
      await app.close()
    }
  })

  it('lets auth callback routes hit the auth proxy even for browser GET requests', async () => {
    const app = await createCoreWorkspaceAgentServer({
      appRoot: await createBuiltFrontendRoot(),
      serveFrontend: true,
      telemetry: { capture: vi.fn() },
    })
    const handler = vi.fn(async () => new Response('handled-by-auth-proxy', {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    }))
    app.auth.handler = handler as typeof app.auth.handler

    try {
      for (const url of ['/auth/callback/github', '/auth/callback/google']) {
        const res = await app.inject({
          method: 'GET',
          url,
          headers: { accept: 'text/html' },
        })

        expect(res.statusCode).toBe(200)
        expect(res.body).toContain('handled-by-auth-proxy')
      }

      expect(handler).toHaveBeenCalledTimes(2)
    } finally {
      await app.close()
    }
  })

  it('overwrites the private auth scope header from trusted request scope', async () => {
    const app = await createCoreWorkspaceAgentServer({
      serveFrontend: false,
      telemetry: { capture: vi.fn() },
      requestScopeResolver: async () => ({
        bindingId: 'binding-bound',
        workspaceId: 'workspace-保险',
        defaultDeploymentId: 'deployment-bound',
        activeRevision: 'revision-bound',
        resolvedDigest: `sha256:${'a'.repeat(64)}`,
      }),
    })
    const handler = vi.fn(async (_request: Request) => new Response('ok'))
    app.auth.handler = handler as typeof app.auth.handler

    try {
      await app.inject({
        method: 'POST',
        url: '/auth/test',
        headers: { 'x-boring-internal-request-workspace': 'workspace-attacker' },
        payload: {},
      })

      const forwarded = handler.mock.calls[0]?.[0]
      expect(forwarded).toBeInstanceOf(Request)
      expect(forwarded?.headers.get('x-boring-internal-request-workspace')).toBe(encodeURIComponent('workspace-保险'))
    } finally {
      await app.close()
    }
  })

  it('serves SPA-only auth pages through the frontend shell for browser GET requests', async () => {
    const app = await createCoreWorkspaceAgentServer({
      appRoot: await createBuiltFrontendRoot(),
      serveFrontend: true,
      telemetry: { capture: vi.fn() },
    })
    const handler = vi.fn(async () => new Response('handled-by-auth-proxy', {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    }))
    app.auth.handler = handler as typeof app.auth.handler

    try {
      for (const url of ['/auth/verify-email', '/auth/error?error=please_restart_the_process']) {
        const res = await app.inject({
          method: 'GET',
          url,
          headers: { accept: 'text/html' },
        })

        expect(res.statusCode).toBe(200)
        expect(res.body).toContain('<!doctype html>')
      }

      expect(handler).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })

  it('does not serve the SPA shell for missing built assets', async () => {
    const app = await createCoreWorkspaceAgentServer({
      appRoot: await createBuiltFrontendRoot(),
      serveFrontend: true,
      telemetry: { capture: vi.fn() },
    })
    try {
      const res = await app.inject({ method: 'GET', url: '/assets/missing-chunk.js' })

      expect(res.statusCode).toBe(404)
      expect(res.headers['cache-control']).toBe('no-store')
      expect(res.body).toContain('asset_not_found')
      expect(res.body).not.toContain('<!doctype html>')
    } finally {
      await app.close()
    }
  })

  it('keeps serving the shell when telemetry capture fails', async () => {
    const app = await createCoreWorkspaceAgentServer({
      appRoot: await createBuiltFrontendRoot(),
      serveFrontend: true,
      telemetry: {
        capture() {
          throw new Error('telemetry sink down')
        },
      },
    })
    try {
      const res = await app.inject({ method: 'GET', url: '/' })

      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('<!doctype html>')
    } finally {
      await app.close()
    }
  })
})
