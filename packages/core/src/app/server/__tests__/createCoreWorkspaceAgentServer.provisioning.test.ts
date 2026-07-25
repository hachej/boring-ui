import Fastify from 'fastify'
import { beforeEach, expect, test, vi } from 'vitest'
import type { CoreConfig } from '../../../shared/types.js'
import { createTestCoreConfig } from '../../../server/__tests__/createTestApp.js'

const mocks = vi.hoisted(() => ({
  createAgentHost: vi.fn(async (options: any) => {
    await options.fleetCompiler.compile({ agents: options.agents })
    return { marker: 'prebuilt-agent-host' }
  }),
  registerAgentRoutes: vi.fn(async (app: any, options: any) => {
    app.post('/api/v1/agent/reload', async (request: any) => {
      await options.admitEffect?.({ workspaceId: 'default', requestId: request.id })
      return { ok: true }
    })
    app.post('/api/v1/agent/commands/execute', async (request: any) => {
      await options.admitEffect?.({ workspaceId: 'default', requestId: request.id })
      return { ok: true }
    })
  }),
  provisionWorkspaceRuntime: vi.fn(async () => ({ changed: false, env: {}, pathEntries: [], skillPaths: [] })),
  collectWorkspaceAgentServerPlugins: vi.fn(),
  createWorkspaceUiTools: vi.fn(() => []),
  isMember: vi.fn(async (_workspaceId: string, _userId: string) => true),
  getWorkspace: vi.fn(async (id: string) => ({ id, appId: 'test-app' })),
  getUser: vi.fn(async (id: string) => ({ id })),
  runtimeHost: { source: 'custom-adapter-host' },
}))

vi.mock('@hachej/boring-agent/server', () => ({
  autoDetectMode: () => 'direct',
  compactPiPackages: (packages: unknown[]) => packages,
  createAgentHost: mocks.createAgentHost,
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
  mocks.isMember.mockResolvedValue(true)
  mocks.getWorkspace.mockImplementation(async (id: string) => ({ id, appId: 'test-app' }))
  mocks.getUser.mockImplementation(async (id: string) => ({ id }))
})

vi.mock('../../../server/routes/index.js', () => ({
  registerInviteRoutes: async () => {},
  registerMemberRoutes: async () => {},
  registerSettingsRoutes: async () => {},
  registerWorkspaceRoutes: async () => {},
}))

vi.mock('../../../server/db/index.js', () => ({
  createDatabase: () => ({ db: {}, sql: { end: vi.fn(async () => {}) } }),
  PostgresUserStore: class {
    getById(id: string) { return mocks.getUser(id) }
  },
  PostgresWorkspaceStore: class {
    get(id: string) { return mocks.getWorkspace(id) }
    isMember(workspaceId: string, userId: string) { return mocks.isMember(workspaceId, userId) }
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
  const admitEffect = vi.fn(async () => {})
  const app = await createCoreWorkspaceAgentServer({
    config: createTestCoreConfig({ stores: 'postgres', databaseUrl: 'postgres://test' }),
    workspaceRoot: '/tmp/full-app-workspaces',
    serveFrontend: false,
    registerHealthRoute: false,
    admitEffect,
  })

  try {
    expect(mocks.createAgentHost).toHaveBeenCalledTimes(1)
    expect(mocks.registerAgentRoutes).toHaveBeenCalledTimes(1)
    const options = (mocks.registerAgentRoutes as any).mock.calls[0]?.[1] as Record<string, any>
    expect(options.agentHost.created).toEqual({ marker: 'prebuilt-agent-host' })
    expect(options.agentHost.defaultAgentTypeId).toBe('default')
    expect(options).toHaveProperty('provisionRuntime')
    expect(options.runtimeHost).toBe(mocks.runtimeHost)
    expect(options.admitEffect).toBe(admitEffect)
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

test('core/full-app partitions Gateway admission from legacy reload and command admission', async () => {
  mocks.collectWorkspaceAgentServerPlugins.mockReturnValue({
    runtimePlugins: [],
    agentOptions: { extraTools: [], pi: {}, systemPromptAppend: undefined },
    preservedUiStateKeys: [],
    routeContributions: [],
  })
  const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')
  const effectAdmission = { admit: vi.fn(async () => ({ type: 'accepted' as const, admissionReceipt: 'accepted' })) }
  const admitEffect = vi.fn(async () => {})
  const app = await createCoreWorkspaceAgentServer({
    config: createTestCoreConfig({ stores: 'postgres', databaseUrl: 'postgres://test' }),
    workspaceRoot: '/tmp/full-app-workspaces',
    serveFrontend: false,
    effectAdmission,
    admitEffect,
  })

  try {
    const hostOptions = (mocks.createAgentHost as any).mock.calls[0]?.[0]
    const routeOptions = (mocks.registerAgentRoutes as any).mock.calls[0]?.[1]
    expect(hostOptions.effectAdmission).toBe(effectAdmission)
    expect(routeOptions.admitEffect).toBe(admitEffect)

    expect((await app.inject({ method: 'POST', url: '/api/v1/agent/reload' })).statusCode).toBe(200)
    expect((await app.inject({
      method: 'POST',
      url: '/api/v1/agent/commands/execute',
      payload: { name: 'plan' },
    })).statusCode).toBe(200)
    expect(admitEffect).toHaveBeenCalledTimes(2)
    expect(effectAdmission.admit).not.toHaveBeenCalled()
  } finally {
    await app.close()
  }
})

test.each([
  {
    label: 'unknown plugin',
    agent: {
      agentTypeId: 'configured',
      definition: { label: 'Configured', instructions: 'Be useful.' },
      plugins: [{ name: 'not-loaded' }],
    },
    message: /unknown Agent fleet plugin/,
  },
  {
    label: 'uncompiled model policy',
    agent: {
      agentTypeId: 'configured',
      definition: { label: 'Configured', instructions: 'Be useful.' },
      model: { preferred: 'unknown/model' },
    },
    message: /requires an app fleet compiler/,
  },
])('core/full-app rejects $label before route registration', async ({ agent, message }) => {
  mocks.collectWorkspaceAgentServerPlugins.mockReturnValue({
    runtimePlugins: [],
    agentOptions: { extraTools: [], pi: {}, systemPromptAppend: undefined },
    preservedUiStateKeys: [],
    routeContributions: [],
  })
  const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')
  await expect(createCoreWorkspaceAgentServer({
    config: createTestCoreConfig({ stores: 'postgres', databaseUrl: 'postgres://test' }),
    workspaceRoot: '/tmp/full-app-workspaces',
    serveFrontend: false,
    agents: [agent],
  })).rejects.toThrow(message)
  expect(mocks.registerAgentRoutes).not.toHaveBeenCalled()
})

test('core/full-app scope authority binds storage and rechecks membership on every verification', async () => {
  mocks.collectWorkspaceAgentServerPlugins.mockReturnValue({
    runtimePlugins: [],
    agentOptions: { extraTools: [], pi: {}, systemPromptAppend: undefined },
    preservedUiStateKeys: [],
    routeContributions: [],
  })
  const config = createTestCoreConfig({ stores: 'postgres', databaseUrl: 'postgres://test' })
  mocks.getWorkspace.mockImplementation(async (id: string) => ({ id, appId: config.appId }))
  const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')
  const app = await createCoreWorkspaceAgentServer({
    config,
    workspaceRoot: '/tmp/full-app-workspaces',
    serveFrontend: false,
  })

  try {
    const hostOptions = (mocks.createAgentHost as any).mock.calls[0]?.[0]
    const routePolicy = (mocks.registerAgentRoutes as any).mock.calls[0]?.[1].agentHost
    const scope = routePolicy.issueScope({
      claim: { workspaceScopeId: 'workspace-a', authSubjectId: 'user-a' },
      runtimeScope: {
        identity: 'runtime-a',
        environment: {
          placementIdentity: 'workspace-a',
          workspaceRoot: '/tmp/full-app-workspaces/workspace-a',
          provisioningFingerprint: 'generation-a',
        },
        sessionNamespace: 'storage-a',
      },
    })
    expect(scope.workspaceScopeId).toBe(JSON.stringify(['workspace-a', 'storage-a']))
    await expect(hostOptions.scopeVerifier.verify(scope)).resolves.toEqual({
      workspaceScopeId: JSON.stringify(['workspace-a', 'storage-a']),
      authSubjectId: 'user-a',
    })
    await expect(hostOptions.scopeVerifier.verify({
      workspaceScopeId: scope.workspaceScopeId,
      authSubjectId: scope.authSubjectId,
    })).rejects.toThrow(/not issued/)
    mocks.isMember.mockResolvedValue(false)
    await expect(hostOptions.scopeVerifier.verify(scope)).rejects.toThrow(/no longer valid/)
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
    const getSessionNamespace = options.getSessionNamespace as (ctx: { workspaceId: string; workspaceRoot: string; request?: any }) => Promise<string>
    await expect(getSessionNamespace({ workspaceId: 'workspace-a', workspaceRoot: '/tmp/full-app-workspaces/workspace-a' })).resolves.toBe('workspace-a')
    await expect(getSessionNamespace({
      workspaceId: 'workspace-a',
      workspaceRoot: '/tmp/full-app-workspaces/workspace-a',
      request: {
        id: 'foreign-storage',
        headers: { 'x-boring-storage-scope': 'workspace-b' },
        raw: { rawHeaders: ['x-boring-storage-scope', 'workspace-b'] },
      },
    })).rejects.toMatchObject({ status: 421, code: 'AGENT_HOST_SCOPE_VIOLATION' })
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
