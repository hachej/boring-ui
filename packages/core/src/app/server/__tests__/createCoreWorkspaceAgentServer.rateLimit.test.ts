import { describe, expect, it, vi } from 'vitest'
import type { CoreConfig } from '../../../shared/types.js'
import { createTestCoreConfig } from '../../../server/__tests__/createTestApp.js'

const mocks = vi.hoisted(() => ({
  authHandler: vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })),
  registerAgentRoutes: vi.fn(async () => {}),
}))

vi.mock('@hachej/boring-agent/server', () => ({
  compactPiPackages: (packages: unknown[]) => packages,
  registerAgentRoutes: mocks.registerAgentRoutes,
}))

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
    handler: mocks.authHandler,
  }),
}))

vi.mock('../../../server/app/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../server/app/index.js')>()
  return {
    ...actual,
    createCoreApp: async (config: CoreConfig) =>
      await actual.createCoreApp(config, { manageShutdown: false }),
    registerRoutes: async () => {},
  }
})

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
    async isMember() { return true }
    async getMemberRole() { return 'editor' }
  },
}))

vi.mock('../../../server/runtime/index.js', () => ({
  WorkspaceRuntimeSandboxHandleStore: class WorkspaceRuntimeSandboxHandleStore {},
}))

const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')

function assertRateLimitEnvelope(res: {
  statusCode: number
  body: string
  headers: Record<string, unknown>
}) {
  expect(res.statusCode).toBe(429)
  expect(res.headers['retry-after']).toBeDefined()
  expect(JSON.parse(res.body)).toMatchObject({
    error: 'rate_limited',
    code: 'rate_limited',
    message: expect.any(String),
    requestId: expect.any(String),
  })
}

describe('createCoreWorkspaceAgentServer auth proxy rate limits', () => {
  it('limits real Better Auth signup proxy route before the wildcard proxy', async () => {
    mocks.authHandler.mockClear()
    const app = await createCoreWorkspaceAgentServer({
      config: createTestCoreConfig({
        stores: 'postgres',
        databaseUrl: 'postgres://test',
        logLevel: 'error',
        rateLimit: {
          '/auth/sign-up/email': { max: 2, window: '1 minute' },
        },
      }),
      serveFrontend: false,
      registerHealthRoute: false,
    })

    try {
      const payload = {
        name: 'Rate Limited',
        email: 'rate-limit@example.test',
        password: 'Zk8$mN!qR2xFgWpJ',
      }
      const responses = []
      for (let index = 0; index < 3; index += 1) {
        responses.push(await app.inject({
          method: 'POST',
          url: '/auth/sign-up/email',
          headers: { 'x-forwarded-for': '1.2.3.4' },
          payload,
        }))
      }

      expect(responses[0].statusCode).not.toBe(429)
      expect(responses[1].statusCode).not.toBe(429)
      assertRateLimitEnvelope(responses[2])
      expect(mocks.authHandler).toHaveBeenCalledTimes(2)
    } finally {
      await app.close()
    }
  })
})
