import Fastify from 'fastify'
import { beforeEach, vi } from 'vitest'
import type { CoreConfig } from '../../../shared/types.js'

export const pluginContexts: unknown[] = []

export const mocks = (() => {
  const hostRegisterDirectRoutes = vi.fn((_projection: any) => async () => {})
  const hostClose = vi.fn(async () => {})
  const acquireEnvironment = vi.fn()
  const hostRunWithWorkspaceAgent = vi.fn(async (_input: unknown, run: (binding: unknown) => Promise<void>) => {
    await run({ marker: 'lease-bound-workspace-agent' })
  })
  const gatewayReadSessionState = vi.fn(async ({ ref }: { ref: unknown }) => ({
    ref,
    seq: 0,
    summary: {},
    state: { messages: [] },
  }))
  const createDatabase = vi.fn(() => ({ db: {}, sql: { end: vi.fn(async () => {}) } }))
  return {
    createAgentHost: vi.fn(async (options: any) => {
      await options.fleetCompiler.compile({ agents: options.agents })
      return {
        marker: 'prebuilt-agent-host',
        host: { close: hostClose, drain: vi.fn(async () => {}) },
        registerDirectRoutes: hostRegisterDirectRoutes,
        acquireEnvironment,
        gateway: { readSessionState: gatewayReadSessionState },
        runWithWorkspaceAgent: hostRunWithWorkspaceAgent,
      }
    }),
    hostRegisterDirectRoutes,
    hostClose,
    acquireEnvironment,
    hostRunWithWorkspaceAgent,
    gatewayReadSessionState,
    createDatabase,
    provisionWorkspaceRuntime: vi.fn(async () => ({ changed: false, env: {}, pathEntries: [], skillPaths: [] })),
    collectWorkspaceAgentServerPlugins: vi.fn(),
    createWorkspaceUiTools: vi.fn(() => []),
    isMember: vi.fn(async (_workspaceId: string, _userId: string) => true),
    getWorkspace: vi.fn(async (id: string): Promise<{
      id: string
      appId: string
      defaultAgentTypeId: string | null
    }> => ({ id, appId: 'test-app', defaultAgentTypeId: null })),
    getUser: vi.fn(async (id: string) => ({ id })),
    inventoryDefaultAgentTypeIds: vi.fn(async (_appId: string): Promise<Array<{ defaultAgentTypeId: string | null; count: number }>> => []),
    compareAndSetNullDefaultAgentTypeId: vi.fn(async (_appId: string, _value: string) => 0),
    actualCreateAgentHost: undefined as undefined | ((options: any) => Promise<any>),
    actualCreateSandboxRuntimeModeAdapter: undefined as undefined | ((mode: 'direct') => any),
    runtimeHost: {
      source: 'custom-adapter-host',
      getBoringAgentRuntimePaths: vi.fn((root: string) => ({ workspaceRoot: root })),
    },
  }
})()

vi.doMock('@hachej/boring-agent/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@hachej/boring-agent/server')>()
  mocks.actualCreateAgentHost = actual.createAgentHost
  return {
    ...actual,
    autoDetectMode: () => 'direct',
    compactPiPackages: (packages: unknown[]) => packages,
    createAgentHost: mocks.createAgentHost,
    createValidatingAgentFleetCompiler: actual.createValidatingAgentFleetCompiler,
    provisionWorkspaceRuntime: mocks.provisionWorkspaceRuntime,
  }
})

vi.doMock('@hachej/boring-workspace/app/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@hachej/boring-workspace/app/server')>()
  mocks.actualCreateSandboxRuntimeModeAdapter = actual.createSandboxRuntimeModeAdapter as never
  return {
    assertWorkspaceBridgeHandlersTrusted: () => {},
    collectWorkspaceAgentServerPlugins: mocks.collectWorkspaceAgentServerPlugins,
    createSandboxRuntimeModeAdapter: () => ({
      id: 'direct',
      getRuntimeLayoutRoot: ({ workspaceRoot }: { workspaceRoot: string }) => workspaceRoot,
      runtimeHost: mocks.runtimeHost,
    }),
    hasDirServerPlugin: () => false,
    omitPluginAuthoringProvisioning: (plugins: Array<{ id: string }>) => plugins.filter((plugin) => plugin.id !== 'boring-ui-plugin-cli-package'),
    readWorkspacePluginPackagePiSnapshot: () => ({
      additionalSkillPaths: [],
      packages: [],
      extensionPaths: [],
      systemPromptAppend: undefined,
    }),
    readWorkspacePluginPackageRuntimePlugins: () => [],
    resolveDefaultWorkspacePluginPackagePaths: () => [],
    resolveOnePluginEntry: async (entry: unknown, context: unknown) => {
      pluginContexts.push(context)
      return entry
    },
    sandboxRuntimeHostOperations: {},
  }
})

vi.doMock('@hachej/boring-workspace/server', async (importOriginal) => ({
  ...await importOriginal<typeof import('@hachej/boring-workspace/server')>(),
  createBrowserBridgeAuthPolicy: () => vi.fn(),
  createInMemoryBridge: () => ({ postCommand: vi.fn(), drainCommands: vi.fn(), getState: vi.fn(), emitUiEffect: vi.fn(), setState: vi.fn(), subscribeCommands: vi.fn() }),
  createWorkspaceBridgeRegistry: () => ({ call: vi.fn(), getDefinition: vi.fn(), registerHandler: vi.fn() }),
  createWorkspaceUiTools: mocks.createWorkspaceUiTools,
  InMemoryWorkspaceBridgeIdempotencyStore: class InMemoryWorkspaceBridgeIdempotencyStore {},
  uiRoutes: async () => {},
  workspaceBridgeHttpRoutes: async () => {},
}))

vi.doMock('../../../server/app/index.js', () => ({
  createCoreApp: async (
    config: CoreConfig,
    options?: { requestScopeResolver?: (request: unknown) => Promise<unknown> | unknown },
  ) => {
    const app = Fastify({ logger: false })
    app.decorate('config', config)
    app.addHook('onRequest', async (request) => {
      const userId = request.headers['x-test-user-id']
      if (typeof userId === 'string') request.user = { id: userId } as never
    })
    if (options?.requestScopeResolver) {
      app.addHook('onRequest', async (request) => {
        request.requestScope = await options.requestScopeResolver!(request) as never
      })
    }
    app.setErrorHandler((error, request, reply) => {
      const status = (error as { status?: unknown }).status
      const code = (error as { code?: unknown }).code
      if (typeof status === 'number' && typeof code === 'string') {
        return reply.code(status).send({ code, message: (error as Error).message, requestId: request.id })
      }
      return reply.send(error)
    })
    return app
  },
  registerRoutes: async () => {},
  registerDirectRoutes: () => async () => {},
}))

vi.doMock('../../../server/auth/index.js', () => ({
  authHook: async () => {},
  createAuth: () => ({ handler: vi.fn(async () => new Response(null, { status: 404 })) }),
}))

vi.doMock('../../../server/routes/index.js', () => ({
  registerInviteRoutes: async () => {},
  registerMemberRoutes: async () => {},
  registerSettingsRoutes: async () => {},
  registerWorkspaceRoutes: async () => {},
}))

vi.doMock('../../../server/db/index.js', () => ({
  createDatabase: mocks.createDatabase,
  PostgresUserStore: class {
    getById(id: string) { return mocks.getUser(id) }
  },
  PostgresWorkspaceStore: class {
    get(id: string) { return mocks.getWorkspace(id) }
    isMember(workspaceId: string, userId: string) { return mocks.isMember(workspaceId, userId) }
    inventoryDefaultAgentTypeIds(appId: string) { return mocks.inventoryDefaultAgentTypeIds(appId) }
    compareAndSetNullDefaultAgentTypeId(appId: string, value: string) {
      return mocks.compareAndSetNullDefaultAgentTypeId(appId, value)
    }
  },
}))

vi.doMock('../../../server/runtime/index.js', () => ({
  WorkspaceRuntimeSandboxHandleStore: class {},
}))

beforeEach(() => {
  vi.clearAllMocks()
  pluginContexts.length = 0
  mocks.provisionWorkspaceRuntime.mockResolvedValue({ changed: false, env: {}, pathEntries: [], skillPaths: [] })
  mocks.acquireEnvironment.mockReset()
  mocks.hostRunWithWorkspaceAgent.mockClear()
  mocks.gatewayReadSessionState.mockClear()
  mocks.isMember.mockResolvedValue(true)
  mocks.getWorkspace.mockImplementation(async (id: string) => ({ id, appId: 'test-app', defaultAgentTypeId: null }))
  mocks.getUser.mockImplementation(async (id: string) => ({ id }))
  mocks.inventoryDefaultAgentTypeIds.mockResolvedValue([])
  mocks.compareAndSetNullDefaultAgentTypeId.mockResolvedValue(0)
})

export function fakeRequest(workspaceId: string, userId: string) {
  return {
    id: `request-${workspaceId}`,
    method: 'GET',
    url: '/api/v1/agents',
    headers: { 'x-boring-workspace-id': workspaceId },
    raw: { rawHeaders: ['x-boring-workspace-id', workspaceId] },
    query: {},
    user: { id: userId, email: `${userId}@example.com`, emailVerified: true },
  }
}
