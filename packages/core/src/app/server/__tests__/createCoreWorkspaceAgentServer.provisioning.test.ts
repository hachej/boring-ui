import Fastify from 'fastify'
import { expect, test, vi } from 'vitest'
import { createTestCoreConfig } from '../../../server/__tests__/createTestApp.js'

const mocks = vi.hoisted(() => ({
  registerAgentRoutes: vi.fn(async () => {}),
  provisionWorkspaceRuntime: vi.fn(async () => ({ changed: false, env: {}, pathEntries: [], skillPaths: [] })),
  collectWorkspaceAgentServerPlugins: vi.fn(),
  createWorkspaceUiTools: vi.fn(() => []),
}))

vi.mock('@hachej/boring-agent/server', () => ({
  compactPiPackages: (packages: unknown[]) => packages,
  provisionWorkspaceRuntime: mocks.provisionWorkspaceRuntime,
  registerAgentRoutes: mocks.registerAgentRoutes,
}))

vi.mock('@hachej/boring-workspace/app/server', () => ({
  collectWorkspaceAgentServerPlugins: mocks.collectWorkspaceAgentServerPlugins,
  hasDirServerPlugin: () => false,
  readWorkspacePluginPackagePiSnapshot: () => ({
    additionalSkillPaths: [],
    packages: [],
    extensionPaths: [],
    systemPromptAppend: undefined,
  }),
  readWorkspacePluginPackageRuntimePlugins: () => [],
  resolveDefaultWorkspacePluginPackagePaths: () => [],
  resolveOnePluginEntry: async (entry: unknown) => entry,
}))

vi.mock('@hachej/boring-workspace/server', () => ({
  createInMemoryBridge: () => ({ postCommand: vi.fn() }),
  createWorkspaceUiTools: mocks.createWorkspaceUiTools,
  uiRoutes: async () => {},
}))

vi.mock('../../../server/app/index.js', () => ({
  createCoreApp: async () => Fastify({ logger: false }),
  registerRoutes: async () => {},
}))

vi.mock('../../../server/auth/index.js', () => ({
  authHook: async () => {},
  createAuth: () => ({ handler: vi.fn(async () => new Response(null, { status: 404 })) }),
}))

vi.mock('../../../server/routes/index.js', () => ({
  registerInviteRoutes: async () => {},
  registerMemberRoutes: async () => {},
  registerSettingsRoutes: async () => {},
  registerWorkspaceRoutes: async () => {},
}))

vi.mock('../../../server/db/index.js', () => ({
  createDatabase: () => ({ db: {}, sql: { end: vi.fn(async () => {}) } }),
  PostgresUserStore: class {},
  PostgresWorkspaceStore: class {
    async isMember() { return true }
  },
}))

vi.mock('../../../server/runtime/index.js', () => ({
  WorkspaceRuntimeSandboxHandleStore: class {},
}))

test('core/full-app composition forwards collected runtime provisioning plugins to agent routes', async () => {
  const runtimePlugin = {
    id: 'full-app-runtime-plugin',
    provisioning: { nodePackages: [] },
  }
  mocks.collectWorkspaceAgentServerPlugins.mockReturnValue({
    runtimePlugins: [runtimePlugin],
    provisioningContributions: [{ kind: 'legacy-contribution-should-not-run' }],
    agentOptions: {
      extraTools: [],
      pi: { additionalSkillPaths: [], packages: [] },
      systemPromptAppend: 'core plugin prompt',
    },
    preservedUiStateKeys: [],
    routeContributions: [],
  })

  const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')
  const app = await createCoreWorkspaceAgentServer({
    config: createTestCoreConfig({ stores: 'postgres', databaseUrl: 'postgres://test' }),
    workspaceRoot: '/tmp/full-app-workspaces',
    serveFrontend: false,
    registerHealthRoute: false,
  })

  try {
    expect(mocks.registerAgentRoutes).toHaveBeenCalledTimes(1)
    const options = (mocks.registerAgentRoutes as any).mock.calls[0]?.[1] as Record<string, unknown>
    expect(options).toHaveProperty('provisionRuntime')
    expect(options).not.toHaveProperty('runtimeProvisioningPlugins')
    expect(options).not.toHaveProperty('provisioningContributions')

    const provisionRuntime = options.provisionRuntime as (ctx: Record<string, unknown>) => Promise<unknown>
    const adapter = { workspaceFs: {} }
    const runtimeLayout = { workspaceRoot: '/workspace' }
    await provisionRuntime({ provisioningAdapter: adapter, runtimeLayout })
    expect(mocks.provisionWorkspaceRuntime).toHaveBeenCalledWith(expect.objectContaining({
      plugins: [runtimePlugin],
      adapter,
      runtimeLayout,
      telemetry: expect.any(Object),
    }))
  } finally {
    await app.close()
  }
})
