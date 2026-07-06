import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@hachej/boring-workspace/app/server', () => ({
  assertWorkspaceBridgeHandlersTrusted: () => {},
  collectWorkspaceAgentServerPlugins: () => ({
    agentOptions: {
      extraTools: [],
      pi: undefined,
      systemPromptAppend: undefined,
    },
    preservedUiStateKeys: [],
    provisioningContributions: [],
    routeContributions: [],
    runtimePlugins: [],
    workspaceBridgeHandlers: [],
  }),
  hasDirServerPlugin: () => false,
  omitPluginAuthoringProvisioning: (plugins: unknown[]) => plugins,
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
  createWorkspaceBridgeRuntimeCore: () => ({
    registry: {
      call: vi.fn(),
      getDefinition: vi.fn(),
      registerHandler: vi.fn(),
    },
  }),
  createWorkspaceBridgeRuntimeEnvContribution: () => undefined,
  createWorkspaceUiTools: () => [],
  runWithWorkspaceBridgeIdempotency: vi.fn(async (_store: unknown, _options: unknown, execute: () => Promise<unknown>) => execute()),
  InMemoryWorkspaceBridgeIdempotencyStore: class InMemoryWorkspaceBridgeIdempotencyStore {},
  InMemoryWorkspaceBridgeRuntimeRefreshTokenStore: class InMemoryWorkspaceBridgeRuntimeRefreshTokenStore {},
  uiRoutes: async () => {},
  verifyWorkspaceBridgeRuntimeToken: vi.fn(),
  workspaceBridgeHttpRoutes: async () => {},
}))

vi.mock('../../../server/auth/index.js', () => ({
  authHook: async () => {},
  createAuth: () => ({
    handler: vi.fn(async () => new Response(null, { status: 404 })),
  }),
}))

vi.mock('../../../server/app/index.js', () => ({
  createCoreApp: async (config: Record<string, unknown>) => {
    const app = Fastify({ logger: false })
    app.decorate('config', config as never)
    app.addHook('onRequest', async (request) => {
      const userId = request.headers['x-test-user-id']
      if (typeof userId === 'string' && userId.length > 0) {
        request.user = {
          id: userId,
          email: `${userId}@example.test`,
          name: userId,
          emailVerified: true,
        }
      }
    })
    return app
  },
  registerRoutes: async () => {},
}))

vi.mock('../../../server/routes/index.js', () => ({
  registerInviteRoutes: async () => {},
  registerMemberRoutes: async () => {},
  registerOutreachRoutes: async () => {},
  registerSettingsRoutes: async () => {},
  registerWorkspaceRoutes: async () => {},
}))

vi.mock('../../../server/db/index.js', () => ({
  createDatabase: () => ({
    db: {},
    sql: { end: vi.fn(async () => {}) },
  }),
  PostgresMeteringStore: class PostgresMeteringStore {},
  PostgresUserStore: class PostgresUserStore {},
  PostgresWorkspaceStore: class PostgresWorkspaceStore {
    async isMember(_workspaceId: string, userId: string) {
      return Boolean(await this.getMemberRole(_workspaceId, userId))
    }

    async getMemberRole(_workspaceId: string, userId: string) {
      if (userId === 'viewer') return 'viewer'
      if (userId === 'outsider') return null
      return 'editor'
    }
  },
}))

vi.mock('../../../server/config/index.js', () => ({
  loadConfig: async () => ({
    appId: 'test-app',
    appName: 'Test App',
    appLogo: null,
    port: 0,
    host: '127.0.0.1',
    staticDir: null,
    databaseUrl: 'postgres://test',
    stores: 'postgres',
    cors: { origins: ['http://localhost:3000'], credentials: true },
    bodyLimit: 16 * 1024 * 1024,
    logLevel: 'silent',
    encryption: { workspaceSettingsKey: 'test-key' },
    auth: {
      secret: 's'.repeat(64),
      url: 'http://localhost:3000',
      sessionTtlSeconds: 3600,
      sessionCookieSecure: false,
    },
    features: { githubOauth: false, googleOauth: false, invitesEnabled: true, sendWelcomeEmail: true, inviteTtlDays: 7 },
  }),
}))

vi.mock('../../../server/runtime/index.js', () => ({
  WorkspaceRuntimeSandboxHandleStore: class WorkspaceRuntimeSandboxHandleStore {},
}))

const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')

describe('createCoreWorkspaceAgentServer agent authorization', () => {
  it('preserves stable forbidden code on real agent file writes', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'boring-core-agent-auth-'))
    const app = await createCoreWorkspaceAgentServer({
      serveFrontend: false,
      workspaceRoot,
      mode: 'direct',
      registerHealthRoute: false,
      externalPlugins: false,
    })

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/files',
        headers: {
          'content-type': 'application/json',
          'x-boring-workspace-id': 'workspace-1',
          'x-test-user-id': 'viewer',
        },
        payload: { path: 'README.md', content: 'changed' },
      })

      expect(res.statusCode).toBe(403)
      expect(res.json()).toMatchObject({
        error: { code: 'forbidden', message: 'workspace editor role required' },
      })
    } finally {
      await app.close()
    }
  })
})
