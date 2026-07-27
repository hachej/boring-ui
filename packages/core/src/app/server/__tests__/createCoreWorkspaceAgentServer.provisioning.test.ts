import { ErrorCode, type AuthorizedAgentScope } from '@hachej/boring-agent/shared'
import { randomUUID } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { beforeEach, expect, test, vi } from 'vitest'
import type { CoreConfig } from '../../../shared/types.js'
import { createTestCoreConfig } from '../../../server/__tests__/createTestApp.js'

const mocks = vi.hoisted(() => {
  const mountLegacyRoutes = vi.fn(async (app: any, options: any) => {
    app.post('/api/v1/agent/reload', async (request: any) => {
      await options.admitEffect?.({ workspaceId: 'default', requestId: request.id })
      return { ok: true }
    })
    app.post('/api/v1/agent/commands/execute', async (request: any) => {
      await options.admitEffect?.({ workspaceId: 'default', requestId: request.id })
      return { ok: true }
    })
  })
  const hostRegisterRoutes = vi.fn((projection: any) => async (app: any) => {
    await mountLegacyRoutes(app, projection.legacyRoutePolicy.options)
  })
  return {
    createAgentHost: vi.fn(async (options: any) => {
      await options.fleetCompiler.compile({ agents: options.agents })
      return { marker: 'prebuilt-agent-host', registerRoutes: hostRegisterRoutes }
    }),
    createAgentHostLegacyRoutePolicy: vi.fn((options: any, scopePolicy: any) => ({ options, scopePolicy })),
    hostRegisterRoutes,
    mountLegacyRoutes,
    provisionWorkspaceRuntime: vi.fn(async () => ({ changed: false, env: {}, pathEntries: [], skillPaths: [] })),
    collectWorkspaceAgentServerPlugins: vi.fn(),
    createWorkspaceUiTools: vi.fn(() => []),
    isMember: vi.fn(async (_workspaceId: string, _userId: string) => true),
    getWorkspace: vi.fn(async (id: string) => ({ id, appId: 'test-app' })),
    getUser: vi.fn(async (id: string) => ({ id })),
    actualCreateAgentHost: undefined as undefined | ((options: any) => Promise<any>),
    runtimeHost: { source: 'custom-adapter-host' },
  }
})

vi.mock('@hachej/boring-agent/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@hachej/boring-agent/server')>()
  mocks.actualCreateAgentHost = actual.createAgentHost
  return {
    autoDetectMode: () => 'direct',
    compactPiPackages: (packages: unknown[]) => packages,
    createAgentHost: mocks.createAgentHost,
    createAgentHostLegacyRoutePolicy: mocks.createAgentHostLegacyRoutePolicy,
    createValidatingAgentFleetCompiler: actual.createValidatingAgentFleetCompiler,
    provisionWorkspaceRuntime: mocks.provisionWorkspaceRuntime,
  }
})

vi.mock('@hachej/boring-workspace/app/server', () => ({
  assertWorkspaceBridgeHandlersTrusted: () => {},
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
  createCoreApp: async (
    config: CoreConfig,
    options?: { requestScopeResolver?: (request: unknown) => Promise<unknown> | unknown },
  ) => {
    const app = Fastify({ logger: false })
    app.decorate('config', config)
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

test('core production mounts only the awaited CreatedAgentHost route projection', async () => {
  const source = await readFile(join(import.meta.dirname, '..', 'createCoreWorkspaceAgentServer.ts'), 'utf8')

  expect(source.match(/\bcreateAgentHost\s*\(/g)).toHaveLength(1)
  expect(source).not.toMatch(/\bregisterAgentRoutes\b/)
  expect(source).toMatch(/await app\.register\s*\(\s*agentHost\.registerRoutes\s*\(/)
})

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
    expect(mocks.createAgentHost).toHaveBeenCalledTimes(1)
    expect(mocks.hostRegisterRoutes).toHaveBeenCalledTimes(1)
    expect(mocks.mountLegacyRoutes).toHaveBeenCalledTimes(1)
    const projection = (mocks.hostRegisterRoutes as any).mock.calls[0]?.[0] as Record<string, any>
    const options = (mocks.createAgentHostLegacyRoutePolicy as any).mock.calls[0]?.[0] as Record<string, any>
    expect(projection.defaultAgentTypeId).toBe('default')
    expect(projection.legacyRoutePolicy).toBeDefined()
    expect(options).toHaveProperty('provisionRuntime')
    expect(options.runtimeHost).toBe(mocks.runtimeHost)
    expect(options.admitEffect).toBe(admitEffect)
    expect(projection.shutdownParticipants).toEqual([shutdown])
    expect(options).not.toHaveProperty('shutdownParticipants')
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
}, 15_000) // Full Core composition can exceed Vitest's default timeout on a cold module load.

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
    const hostOptions = (mocks.createAgentHost as any).mock.calls.at(-1)?.[0]
    const routeOptions = (mocks.createAgentHostLegacyRoutePolicy as any).mock.calls.at(-1)?.[0]
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
    code: ErrorCode.enum.AGENT_FLEET_PLUGIN_UNKNOWN,
  },
  {
    label: 'uncompiled model policy',
    agent: {
      agentTypeId: 'configured',
      definition: { label: 'Configured', instructions: 'Be useful.' },
      model: { preferred: 'unknown/model' },
    },
    message: /requires an app fleet compiler/,
    code: ErrorCode.enum.AGENT_FLEET_MODEL_POLICY_UNCOMPILED,
  },
])('core/full-app rejects $label before route registration', async ({ agent, message, code }) => {
  mocks.collectWorkspaceAgentServerPlugins.mockReturnValue({
    runtimePlugins: [],
    agentOptions: { extraTools: [], pi: {}, systemPromptAppend: undefined },
    preservedUiStateKeys: [],
    routeContributions: [],
  })
  const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')
  const result = createCoreWorkspaceAgentServer({
    config: createTestCoreConfig({ stores: 'postgres', databaseUrl: 'postgres://test' }),
    workspaceRoot: '/tmp/full-app-workspaces',
    serveFrontend: false,
    agents: [agent],
  })
  await expect(result).rejects.toThrow(message)
  await expect(result).rejects.toMatchObject({ code })
  expect(mocks.hostRegisterRoutes).not.toHaveBeenCalled()
})

test('core/full-app rejects unknown plugin config keys with a stable code before route registration', async () => {
  mocks.collectWorkspaceAgentServerPlugins.mockReturnValue({
    runtimePlugins: [],
    agentOptions: { extraTools: [], pi: {}, systemPromptAppend: undefined },
    preservedUiStateKeys: [],
    routeContributions: [],
  })
  const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')
  const result = createCoreWorkspaceAgentServer({
    config: createTestCoreConfig({ stores: 'postgres', databaseUrl: 'postgres://test' }),
    workspaceRoot: '/tmp/full-app-workspaces',
    serveFrontend: false,
    plugins: [{
      id: 'configured-plugin',
      contentDigest: 'configured-plugin-v1',
      agentConfigContract: { keys: ['allowed'] },
    }],
    agents: [{
      agentTypeId: 'configured',
      definition: { label: 'Configured', instructions: 'Be useful.' },
      plugins: [{ name: 'configured-plugin', config: { unknown: true } }],
    }],
  })
  await expect(result).rejects.toMatchObject({
    code: ErrorCode.enum.AGENT_FLEET_CONFIG_BINDING_UNKNOWN,
    details: {
      agentTypeId: 'configured',
      pluginId: 'configured-plugin',
      configKey: 'unknown',
    },
  })
  expect(mocks.hostRegisterRoutes).not.toHaveBeenCalled()
})

test('core/full-app rejects an invalid fleet before Host identity or Environment setup', async () => {
  mocks.collectWorkspaceAgentServerPlugins.mockReturnValue({
    runtimePlugins: [],
    agentOptions: { extraTools: [], pi: {}, systemPromptAppend: undefined },
    preservedUiStateKeys: [],
    routeContributions: [],
  })
  const actualCreateAgentHost = mocks.actualCreateAgentHost
  if (!actualCreateAgentHost) throw new Error('real createAgentHost implementation was not captured')
  mocks.createAgentHost.mockImplementationOnce(actualCreateAgentHost)
  const createEnvironment = vi.fn(async () => {
    throw new Error('Environment must not be constructed')
  })
  const sessionRoot = join(tmpdir(), `boring-core-rejected-fleet-${randomUUID()}`)
  const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')
  const result = createCoreWorkspaceAgentServer({
    config: createTestCoreConfig({ stores: 'postgres', databaseUrl: 'postgres://test' }),
    workspaceRoot: '/tmp/full-app-workspaces',
    sessionRoot,
    serveFrontend: false,
    runtimeModeAdapter: {
      id: 'direct',
      create: createEnvironment,
    },
    agents: [{
      agentTypeId: 'configured',
      definition: { label: 'Configured', instructions: 'Be useful.' },
      plugins: [{ name: 'not-loaded' }],
    }],
  })

  await expect(result).rejects.toMatchObject({
    code: ErrorCode.enum.AGENT_FLEET_PLUGIN_UNKNOWN,
  })
  expect(createEnvironment).not.toHaveBeenCalled()
  expect(mocks.provisionWorkspaceRuntime).not.toHaveBeenCalled()
  expect(mocks.hostRegisterRoutes).not.toHaveBeenCalled()
  await expect(access(join(sessionRoot, '.agent-host-id'))).rejects.toThrow()
})

test('core/full-app scope authority rejects forgeries and cross-workspace route targets', async () => {
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
    requestScopeResolver: async () => ({
      bindingId: 'binding-b',
      workspaceId: 'workspace-b',
      defaultDeploymentId: 'deployment-b',
      activeRevision: 'revision-b',
      resolvedDigest: `sha256:${'b'.repeat(64)}`,
    }),
  })

  try {
    const hostOptions = (mocks.createAgentHost as any).mock.calls[0]?.[0]
    const routePolicy = (mocks.createAgentHostLegacyRoutePolicy as any).mock.calls[0]?.[1]
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
    mocks.isMember.mockClear()
    await expect(hostOptions.scopeVerifier.verify(scope)).resolves.toEqual({
      workspaceScopeId: JSON.stringify(['workspace-a', 'storage-a']),
      authSubjectId: 'user-a',
    })

    const forgedScopes = [
      { label: 'spread copy', scope: { ...scope } },
      { label: 'JSON round-trip', scope: JSON.parse(JSON.stringify(scope)) },
      {
        label: 'direct structural cast',
        scope: {
          workspaceScopeId: scope.workspaceScopeId,
          authSubjectId: scope.authSubjectId,
        } as AuthorizedAgentScope,
      },
    ]
    for (const forgery of forgedScopes) {
      await expect(
        hostOptions.scopeVerifier.verify(forgery.scope),
        `${forgery.label} must fail production scope verification`,
      ).rejects.toThrow(/not issued/)
      await expect(
        hostOptions.resolveRuntimeScope({ agentTypeId: 'default', scope: forgery.scope }),
        `${forgery.label} must not resolve production runtime context`,
      ).rejects.toThrow(/not issued/)
    }
    expect(mocks.isMember).toHaveBeenCalledTimes(1)

    const crossWorkspaceResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/workspace/meta?workspaceId=workspace-a',
    })
    expect(crossWorkspaceResponse.statusCode).toBe(421)
    expect(crossWorkspaceResponse.json()).toMatchObject({
      code: 'AGENT_HOST_SCOPE_VIOLATION',
    })

    mocks.isMember.mockResolvedValue(false)
    await expect(hostOptions.scopeVerifier.verify(scope)).rejects.toThrow(/no longer valid/)
    expect(mocks.isMember).toHaveBeenCalledTimes(2)
  } finally {
    await app.close()
  }
})

test('core/full-app defaults an internal session namespace to workspace id', async () => {
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
    const options = (mocks.createAgentHostLegacyRoutePolicy as any).mock.calls[0]?.[0] as Record<string, unknown>
    expect(options).not.toHaveProperty('sessionNamespace')
    const getSessionNamespace = options.getSessionNamespace as (ctx: { workspaceId: string; workspaceRoot: string; request?: any }) => Promise<string>
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
    const options = (mocks.createAgentHostLegacyRoutePolicy as any).mock.calls[0]?.[0] as Record<string, unknown>
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
    const options = (mocks.createAgentHostLegacyRoutePolicy as any).mock.calls[0]?.[0] as Record<string, unknown>
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
      const options = (mocks.createAgentHostLegacyRoutePolicy as any).mock.calls.at(-1)?.[0] as Record<string, unknown>
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
