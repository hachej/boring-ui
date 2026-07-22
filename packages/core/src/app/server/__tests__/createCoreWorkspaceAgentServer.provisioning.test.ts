import Fastify from 'fastify'
import { beforeEach, expect, test, vi } from 'vitest'
import type { CoreConfig } from '../../../shared/types.js'
import { createTestCoreConfig } from '../../../server/__tests__/createTestApp.js'

const mocks = vi.hoisted(() => ({
  registerAgentRoutes: vi.fn(async () => {}),
  provisionWorkspaceRuntime: vi.fn(async () => ({ changed: false, env: {}, pathEntries: [], skillPaths: [] })),
  collectWorkspaceAgentServerPlugins: vi.fn(),
  createWorkspaceUiTools: vi.fn(() => []),
  runtimeHost: { source: 'custom-adapter-host' },
}))

vi.mock('@hachej/boring-agent/server', () => ({
  autoDetectMode: () => 'direct',
  compactPiPackages: (packages: unknown[]) => packages,
  provisionWorkspaceRuntime: mocks.provisionWorkspaceRuntime,
  registerAgentRoutes: mocks.registerAgentRoutes,
}))

vi.mock('@hachej/boring-workspace/app/server', () => ({
  collectWorkspaceAgentServerPlugins: mocks.collectWorkspaceAgentServerPlugins,
  createSandboxRuntimeModeAdapter: () => ({ id: 'direct', runtimeHost: mocks.runtimeHost }),
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
  resolveOnePluginEntry: async (entry: unknown) => entry,
  sandboxRuntimeHostOperations: {},
}))

vi.mock('@hachej/boring-workspace/server', () => ({
  createBrowserBridgeAuthPolicy: () => vi.fn(),
  createInMemoryBridge: () => ({ postCommand: vi.fn(), drainCommands: vi.fn(), getState: vi.fn(), emitUiEffect: vi.fn(), setState: vi.fn(), subscribeCommands: vi.fn() }),
  createWorkspaceBridgeRegistry: () => ({ call: vi.fn(), getDefinition: vi.fn(), registerHandler: vi.fn() }),
  createWorkspaceUiTools: mocks.createWorkspaceUiTools,
  InMemoryWorkspaceBridgeIdempotencyStore: class InMemoryWorkspaceBridgeIdempotencyStore {},
  uiRoutes: async () => {},
  workspaceBridgeHttpRoutes: async () => {},
}))

vi.mock('../../../server/app/index.js', () => ({
  createCoreApp: async (config: CoreConfig) => {
    const app = Fastify({ logger: false })
    app.decorate('config', config)
    return app
  },
  registerRoutes: async () => {},
}))

vi.mock('../../../server/auth/index.js', () => ({
  authHook: async () => {},
  createAuth: () => ({ handler: vi.fn(async () => new Response(null, { status: 404 })) }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.provisionWorkspaceRuntime.mockResolvedValue({ changed: false, env: {}, pathEntries: [], skillPaths: [] })
})

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
  const shutdown = { begin: vi.fn(), drain: vi.fn(async () => {}) }
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
    shutdownContributions: [{ id: 'full-app-runtime-plugin', shutdown }],
  })

  const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')
  const admitEffect = vi.fn(async () => {})
  const app = await createCoreWorkspaceAgentServer({
    config: createTestCoreConfig({ stores: 'postgres', databaseUrl: 'postgres://test' }),
    workspaceRoot: '/tmp/full-app-workspaces',
    serveFrontend: false,
    registerHealthRoute: false,
    admitEffect,
  })

  try {
    expect(mocks.registerAgentRoutes).toHaveBeenCalledTimes(1)
    const options = (mocks.registerAgentRoutes as any).mock.calls[0]?.[1] as Record<string, unknown>
    expect(options).toHaveProperty('provisionRuntime')
    expect(options.runtimeHost).toBe(mocks.runtimeHost)
    expect(options.admitEffect).toBe(admitEffect)
    expect(options.shutdownParticipants).toEqual([shutdown])
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

test('core/full-app defaults session namespace to workspace id', async () => {
  mocks.collectWorkspaceAgentServerPlugins.mockReturnValue({
    runtimePlugins: [],
    provisioningContributions: [],
    agentOptions: {
      extraTools: [],
      pi: { additionalSkillPaths: [], packages: [] },
      systemPromptAppend: undefined,
    },
    preservedUiStateKeys: [],
    routeContributions: [],
    shutdownContributions: [],
  })

  const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')
  const app = await createCoreWorkspaceAgentServer({
    config: createTestCoreConfig({ stores: 'postgres', databaseUrl: 'postgres://test' }),
    workspaceRoot: '/tmp/full-app-workspaces',
    serveFrontend: false,
    registerHealthRoute: false,
  })

  try {
    const options = (mocks.registerAgentRoutes as any).mock.calls[0]?.[1] as Record<string, unknown>
    expect(options).not.toHaveProperty('sessionNamespace')
    const getSessionNamespace = options.getSessionNamespace as (ctx: { workspaceId: string; workspaceRoot: string }) => Promise<string>
    await expect(getSessionNamespace({ workspaceId: 'workspace-a', workspaceRoot: '/tmp/full-app-workspaces/workspace-a' })).resolves.toBe('workspace-a')
  } finally {
    await app.close()
  }
})

test('core/full-app skips built-in plugin CLI provisioning unless plugin authoring is enabled', async () => {
  const runtimePlugin = {
    id: 'workspace-runtime-plugin',
    provisioning: { python: [] },
  }
  mocks.collectWorkspaceAgentServerPlugins.mockReturnValue({
    runtimePlugins: [runtimePlugin],
    provisioningContributions: [],
    agentOptions: {
      extraTools: [],
      pi: { additionalSkillPaths: [], packages: [] },
      systemPromptAppend: undefined,
    },
    preservedUiStateKeys: [],
    routeContributions: [],
    shutdownContributions: [],
  })

  const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')
  const app = await createCoreWorkspaceAgentServer({
    config: createTestCoreConfig({ stores: 'postgres', databaseUrl: 'postgres://test' }),
    workspaceRoot: '/tmp/full-app-workspaces',
    serveFrontend: false,
    registerHealthRoute: false,
  })

  try {
    const options = (mocks.registerAgentRoutes as any).mock.calls[0]?.[1] as Record<string, unknown>
    const provisionRuntime = options.provisionRuntime as (ctx: Record<string, unknown>) => Promise<unknown>
    const adapter = { workspaceFs: {} }
    const runtimeLayout = { workspaceRoot: '/workspace' }
    expect(mocks.collectWorkspaceAgentServerPlugins).toHaveBeenCalledWith(expect.objectContaining({
      installPluginAuthoring: false,
    }))
    await provisionRuntime({ provisioningAdapter: adapter, runtimeLayout, runtimeMode: 'vercel-sandbox' })
    expect(mocks.provisionWorkspaceRuntime).toHaveBeenCalledWith(expect.objectContaining({
      plugins: [runtimePlugin],
      adapter,
      runtimeLayout,
    }))
  } finally {
    await app.close()
  }
})

test('core/full-app can enable plugin CLI provisioning for remote plugin editing', async () => {
  const pluginCli = {
    id: 'boring-ui-plugin-cli-package',
    provisioning: { nodePackages: [{ packageName: '@hachej/boring-ui-plugin-cli' }] },
  }
  const runtimePlugin = {
    id: 'workspace-runtime-plugin',
    provisioning: { python: [] },
  }
  mocks.collectWorkspaceAgentServerPlugins.mockReturnValue({
    runtimePlugins: [pluginCli, runtimePlugin],
    provisioningContributions: [],
    agentOptions: {
      extraTools: [],
      pi: { additionalSkillPaths: [], packages: [] },
      systemPromptAppend: 'plugin authoring prompt',
    },
    preservedUiStateKeys: [],
    routeContributions: [],
    shutdownContributions: [],
  })

  const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')
  const app = await createCoreWorkspaceAgentServer({
    config: createTestCoreConfig({ stores: 'postgres', databaseUrl: 'postgres://test' }),
    workspaceRoot: '/tmp/full-app-workspaces',
    serveFrontend: false,
    registerHealthRoute: false,
    installPluginAuthoring: true,
  })

  try {
    expect(mocks.collectWorkspaceAgentServerPlugins).toHaveBeenCalledWith(expect.objectContaining({
      installPluginAuthoring: true,
    }))
    const options = (mocks.registerAgentRoutes as any).mock.calls[0]?.[1] as Record<string, unknown>
    expect(options.systemPromptAppend).toBe('plugin authoring prompt')
    const provisionRuntime = options.provisionRuntime as (ctx: Record<string, unknown>) => Promise<unknown>
    const adapter = { workspaceFs: {} }
    const runtimeLayout = { workspaceRoot: '/workspace' }
    await provisionRuntime({ provisioningAdapter: adapter, runtimeLayout, runtimeMode: 'vercel-sandbox' })
    expect(mocks.provisionWorkspaceRuntime).toHaveBeenCalledWith(expect.objectContaining({
      plugins: [pluginCli, runtimePlugin],
      adapter,
      runtimeLayout,
    }))
  } finally {
    await app.close()
  }
})

test('core/full-app composition honors BORING_AGENT_WORKSPACE_ROOT for workspace provisioning while keeping plugin collection rooted at cwd', async () => {
  mocks.collectWorkspaceAgentServerPlugins.mockReturnValue({
    runtimePlugins: [],
    provisioningContributions: [],
    agentOptions: {
      extraTools: [],
      pi: { additionalSkillPaths: [], packages: [] },
      systemPromptAppend: undefined,
    },
    preservedUiStateKeys: [],
    routeContributions: [],
    shutdownContributions: [],
  })

  const previous = process.env.BORING_AGENT_WORKSPACE_ROOT
  const previousSessionRoot = process.env.BORING_AGENT_SESSION_ROOT
  const previousMode = process.env.BORING_AGENT_MODE
  process.env.BORING_AGENT_WORKSPACE_ROOT = '/tmp/workspaces'
  process.env.BORING_AGENT_SESSION_ROOT = '  '
  process.env.BORING_AGENT_MODE = 'vercel-sandbox'

  try {
    const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')
    const app = await createCoreWorkspaceAgentServer({
      config: createTestCoreConfig({ stores: 'postgres', databaseUrl: 'postgres://test' }),
      serveFrontend: false,
      registerHealthRoute: false,
    })

    try {
      const options = (mocks.registerAgentRoutes as any).mock.calls.at(-1)?.[1] as Record<string, unknown>
      expect(options.workspaceRoot).toBe('/tmp/workspaces')
      expect(options.sessionRoot).toBe('/tmp/pi-sessions')
      expect(mocks.collectWorkspaceAgentServerPlugins).toHaveBeenCalledWith(expect.objectContaining({
        workspaceRoot: process.cwd(),
      }))
    } finally {
      await app.close()
    }
  } finally {
    if (previous === undefined) delete process.env.BORING_AGENT_WORKSPACE_ROOT
    else process.env.BORING_AGENT_WORKSPACE_ROOT = previous
    if (previousSessionRoot === undefined) delete process.env.BORING_AGENT_SESSION_ROOT
    else process.env.BORING_AGENT_SESSION_ROOT = previousSessionRoot
    if (previousMode === undefined) delete process.env.BORING_AGENT_MODE
    else process.env.BORING_AGENT_MODE = previousMode
  }
})
