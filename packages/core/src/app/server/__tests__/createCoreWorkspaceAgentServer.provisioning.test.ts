import { ErrorCode, type AgentTool, type AuthorizedAgentScope } from '@hachej/boring-agent/shared'
import { randomUUID } from 'node:crypto'
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { beforeEach, expect, test, vi } from 'vitest'
import type { CoreConfig } from '../../../shared/types.js'
import { createTestCoreConfig } from '../../../server/__tests__/createTestApp.js'

const mocks = vi.hoisted(() => {
  const hostRegisterDirectRoutes = vi.fn((_projection: any) => async () => {})
  const hostClose = vi.fn(async () => {})
  const acquireEnvironment = vi.fn()
  return {
    createAgentHost: vi.fn(async (options: any) => {
      await options.fleetCompiler.compile({ agents: options.agents })
      return {
        marker: 'prebuilt-agent-host',
        host: { close: hostClose, drain: vi.fn(async () => {}) },
        registerDirectRoutes: hostRegisterDirectRoutes,
        acquireEnvironment,
        runWithWorkspaceAgent: vi.fn(),
      }
    }),
    hostRegisterDirectRoutes,
    hostClose,
    acquireEnvironment,
    provisionWorkspaceRuntime: vi.fn(async () => ({ changed: false, env: {}, pathEntries: [], skillPaths: [] })),
    collectWorkspaceAgentServerPlugins: vi.fn(),
    createWorkspaceUiTools: vi.fn(() => []),
    isMember: vi.fn(async (_workspaceId: string, _userId: string) => true),
    getWorkspace: vi.fn(async (id: string) => ({ id, appId: 'test-app' })),
    getUser: vi.fn(async (id: string) => ({ id })),
    actualCreateAgentHost: undefined as undefined | ((options: any) => Promise<any>),
    runtimeHost: {
      source: 'custom-adapter-host',
      getBoringAgentRuntimePaths: vi.fn((root: string) => ({ workspaceRoot: root })),
    },
  }
})

vi.mock('@hachej/boring-agent/server', async (importOriginal) => {
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

vi.mock('@hachej/boring-workspace/app/server', () => ({
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

vi.mock('../../../server/auth/index.js', () => ({
  authHook: async () => {},
  createAuth: () => ({ handler: vi.fn(async () => new Response(null, { status: 404 })) }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.provisionWorkspaceRuntime.mockResolvedValue({ changed: false, env: {}, pathEntries: [], skillPaths: [] })
  mocks.acquireEnvironment.mockReset()
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

function fakeRequest(workspaceId: string, userId: string) {
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

test('core production mounts only the awaited CreatedAgentHost route projection', async () => {
  const source = await readFile(join(import.meta.dirname, '..', 'createCoreWorkspaceAgentServer.ts'), 'utf8')

  expect(source.match(/\bcreateAgentHost\s*\(/g)).toHaveLength(1)
  expect(source).toMatch(/registerDirectRoutes/)
  expect(source).toMatch(/await app\.register\s*\(\s*agentHost\.registerDirectRoutes\s*\(/)

  const orderedCompositionEdges = [
    'const agentHost = await createAgentHost({',
    "app.get('/api/v1/workspace/meta'",
    'await registerCoreAgentHostEnvironmentRoutes(app, {',
    'await app.register(agentHost.registerDirectRoutes({',
    'workspaceAgentDispatcherResolver = directDispatcherResolver',
    'await app.register(uiRoutes, {',
    'await coreBridge.registerHttpRoutes(app)',
    'for (const { routes } of pluginCollection.routeContributions)',
    'await registerFrontendFallback(app, appRoot, telemetry, options.frontendRootHandler)',
  ].map((edge) => source.indexOf(edge))
  expect(orderedCompositionEdges.every((index) => index >= 0)).toBe(true)
  expect(orderedCompositionEdges).toEqual([...orderedCompositionEdges].sort((left, right) => left - right))
})

test('core environment routes acquire one Host lease and release it after a finite response', async () => {
  mocks.collectWorkspaceAgentServerPlugins.mockReturnValue({
    runtimePlugins: [],
    agentOptions: { extraTools: [], pi: {}, systemPromptAppend: undefined },
    preservedUiStateKeys: [],
    routeContributions: [],
  })
  const release = vi.fn(async () => {})
  mocks.acquireEnvironment.mockResolvedValue({
    workspace: {
      fsCapability: 'strong',
      root: '/tmp/full-app-workspaces/workspace-a',
      stat: vi.fn(async () => ({ kind: 'file', size: 5, mtimeMs: 1 })),
      readBinaryFile: vi.fn(async () => new TextEncoder().encode('hello')),
    },
    fileSearch: {},
    gitWorkspace: {},
    release,
  })

  const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')
  const app = await createCoreWorkspaceAgentServer({
    config: createTestCoreConfig({ stores: 'postgres', databaseUrl: 'postgres://test' }),
    workspaceRoot: '/tmp/full-app-workspaces',
    serveFrontend: false,
  })
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/files/raw?workspaceId=workspace-a&path=note.txt',
      headers: { 'x-test-user-id': 'user-a' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.body).toBe('hello')
    expect(mocks.acquireEnvironment).toHaveBeenCalledOnce()
    expect(mocks.acquireEnvironment).toHaveBeenCalledWith(expect.objectContaining({
      intent: expect.objectContaining({ kind: 'http-route' }),
    }))
    expect(release).toHaveBeenCalledOnce()
  } finally {
    await app.close()
  }
}, 15_000)

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
    admitEffect,
  })

  try {
    expect(mocks.createAgentHost).toHaveBeenCalledTimes(1)
    expect(mocks.hostRegisterDirectRoutes).toHaveBeenCalledTimes(1)
    const hostOptions = (mocks.createAgentHost as any).mock.calls[0]?.[0] as Record<string, any>
    const projection = (mocks.hostRegisterDirectRoutes as any).mock.calls[0]?.[0] as Record<string, any>
    const scope = await projection.authorizeAgentRequest(fakeRequest('workspace-a', 'user-a'))
    const environment = await hostOptions.resolveAuthorizedEnvironmentScope({ authorizedScope: scope })
    const adapter = { workspaceFs: {} }
    await environment.provisionRuntime({
      runtimeBundle: { provisioningAdapter: adapter },
      signal: new AbortController().signal,
    })
    expect(mocks.provisionWorkspaceRuntime).toHaveBeenCalledWith(expect.objectContaining({
      plugins: [runtimePlugin],
      adapter,
      runtimeLayout: { workspaceRoot: '/tmp/full-app-workspaces/workspace-a' },
      telemetry: expect.any(Object),
    }))
  } finally {
    await app.close()
  }
}, 15_000) // Full Core composition can exceed Vitest's default timeout on a cold module load.

test('core/full-app gives strong admission only to the direct Host projection', async () => {
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
    expect(hostOptions.effectAdmission).toBe(effectAdmission)
    expect(hostOptions).not.toHaveProperty('admitEffect')
    expect(mocks.hostRegisterDirectRoutes).toHaveBeenCalledOnce()
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
  expect(mocks.hostRegisterDirectRoutes).not.toHaveBeenCalled()
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
  expect(mocks.hostRegisterDirectRoutes).not.toHaveBeenCalled()
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
      getRuntimeLayoutRoot: ({ workspaceRoot }) => workspaceRoot,
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
  expect(mocks.hostRegisterDirectRoutes).not.toHaveBeenCalled()
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
    const projection = (mocks.hostRegisterDirectRoutes as any).mock.calls[0]?.[0]
    const scope = await projection.authorizeAgentRequest(fakeRequest('workspace-a', 'user-a'))
    expect(scope.workspaceScopeId).toBe(JSON.stringify(['workspace-a', 'workspace-a']))
    mocks.isMember.mockClear()
    await expect(hostOptions.scopeVerifier.verify(scope)).resolves.toEqual({
      workspaceScopeId: JSON.stringify(['workspace-a', 'workspace-a']),
      authSubjectId: 'user-a',
    })
    await expect(hostOptions.resolveAuthorizedEnvironmentScope({ authorizedScope: scope }))
      .resolves.toMatchObject({ runtimeWorkspaceId: 'workspace-a' })
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
        hostOptions.resolveAuthorizedEnvironmentScope({ authorizedScope: forgery.scope }),
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
  })

  const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')
  const app = await createCoreWorkspaceAgentServer({
    config: createTestCoreConfig({ stores: 'postgres', databaseUrl: 'postgres://test' }),
    workspaceRoot: '/tmp/full-app-workspaces',
    serveFrontend: false,
  })

  try {
    const hostOptions = (mocks.createAgentHost as any).mock.calls[0]?.[0]
    const projection = (mocks.hostRegisterDirectRoutes as any).mock.calls[0]?.[0]
    const scope = await projection.authorizeAgentRequest(fakeRequest('workspace-a', 'user-a'))
    await expect(hostOptions.resolveAuthorizedAgentRuntimeScope({ authorizedScope: scope }))
      .resolves.toMatchObject({ sessionNamespace: 'workspace-a' })
  } finally {
    await app.close()
  }
})

test('core/full-app grants addressed tools only to the selected agent type', async () => {
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
  const tool = (name: string, description = name): AgentTool => ({
    name,
    description,
    parameters: { type: 'object', properties: {} },
    execute: vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'ok' }] })),
  })
  const seenAgentTypes: string[] = []
  let macroSearchDescription = 'macro search v1'

  const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')
  const app = await createCoreWorkspaceAgentServer({
    config: createTestCoreConfig({ stores: 'postgres', databaseUrl: 'postgres://test' }),
    workspaceRoot: '/tmp/full-app-workspaces',
    getExtraTools: async () => [tool('shared_tool')],
    getAgentExtraTools: async ({ agentTypeId }) => {
      seenAgentTypes.push(agentTypeId)
      return agentTypeId === 'macro'
        ? [tool('macro_search', macroSearchDescription), tool('persist_derived_series')]
        : []
    },
    serveFrontend: false,
  })

  try {
    const hostOptions = (mocks.createAgentHost as any).mock.calls[0]?.[0]
    const projection = (mocks.hostRegisterDirectRoutes as any).mock.calls[0]?.[0]
    const scope = await projection.authorizeAgentRequest(fakeRequest('workspace-a', 'user-a'))
    const verifiedClaim = { workspaceScopeId: 'workspace-a', authSubjectId: 'user-a' }
    const environment = {
      workspaceRoot: '/tmp/full-app-workspaces/workspace-a',
      placementIdentity: 'workspace-a',
      provisioningFingerprint: 'test-provisioning',
    }
    const resolveFor = async (agentTypeId: string) => hostOptions.resolveAuthorizedAgentRuntimeScope({
      authorizedScope: scope,
      verifiedClaim,
      agentTypeId,
      environment,
      intent: { kind: 'agent-binding', operation: 'new-binding', requestId: `request-${agentTypeId}` },
    })

    const macro = await resolveFor('macro')
    const charlotte = await resolveFor('charlotteledoux')
    macroSearchDescription = 'macro search v2'
    const changedMacroContract = await resolveFor('macro')
    expect(macro.extraTools.map((entry: { name: string }) => entry.name)).toEqual([
      'shared_tool',
      'macro_search',
      'persist_derived_series',
    ])
    expect(charlotte.extraTools.map((entry: { name: string }) => entry.name)).toEqual(['shared_tool'])
    expect(macro.identity).not.toBe(charlotte.identity)
    expect(macro.physicalBindingIdentity).not.toBe(charlotte.physicalBindingIdentity)
    expect(macro.resourceInputDigest).not.toBe(charlotte.resourceInputDigest)
    expect(changedMacroContract.identity).not.toBe(macro.identity)
    expect(changedMacroContract.physicalBindingIdentity).not.toBe(macro.physicalBindingIdentity)
    expect(changedMacroContract.resourceInputDigest).not.toBe(macro.resourceInputDigest)
    expect(seenAgentTypes).toEqual(['macro', 'charlotteledoux', 'macro'])
  } finally {
    await app.close()
  }
}, 15_000)

test('core/full-app keeps semantic identity stable across physical workspace roots', async () => {
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
  const resolveRuntime = async (root: string) => {
    const app = await createCoreWorkspaceAgentServer({
      config: createTestCoreConfig({ stores: 'postgres', databaseUrl: 'postgres://test' }),
      workspaceRoot: root,
      getWorkspaceRoot: async () => root,
      serveFrontend: false,
    })
    try {
      const hostOptions = (mocks.createAgentHost as any).mock.calls.at(-1)?.[0]
      const projection = (mocks.hostRegisterDirectRoutes as any).mock.calls.at(-1)?.[0]
      const scope = await projection.authorizeAgentRequest(fakeRequest('workspace-a', 'user-a'))
      return await hostOptions.resolveAuthorizedAgentRuntimeScope({ authorizedScope: scope })
    } finally {
      await app.close()
    }
  }

  const first = await resolveRuntime('/tmp/core-runtime-physical-a')
  const second = await resolveRuntime('/tmp/core-runtime-physical-b')
  expect(first.identity).toBe(second.identity)
  expect(first.physicalBindingIdentity).not.toBe(second.physicalBindingIdentity)
})

test('core/full-app fences Pi extension and prompt content through reload revalidation', async () => {
  mocks.collectWorkspaceAgentServerPlugins.mockReturnValue({
    runtimePlugins: [],
    provisioningContributions: [],
    agentOptions: {
      extraTools: [],
      pi: { additionalSkillPaths: [], packages: [] },
      systemPromptAppend: 'static prompt',
    },
    preservedUiStateKeys: [],
    routeContributions: [],
  })
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'core-resource-fence-'))
  const extensionPath = join(workspaceRoot, 'extension.ts')
  await writeFile(extensionPath, "export default 'before'\n", 'utf8')
  let dynamicPrompt = 'dynamic before'

  const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')
  const app = await createCoreWorkspaceAgentServer({
    config: createTestCoreConfig({ stores: 'postgres', databaseUrl: 'postgres://test' }),
    workspaceRoot,
    getWorkspaceRoot: async () => workspaceRoot,
    getPi: async () => ({ extensionPaths: [extensionPath] }),
    getRuntimeScopeContribution: async () => ({
      identity: 'dynamic-prompt',
      loadSystemPromptAppend: async () => dynamicPrompt,
    }),
    serveFrontend: false,
  })

  try {
    const hostOptions = (mocks.createAgentHost as any).mock.calls[0]?.[0]
    const projection = (mocks.hostRegisterDirectRoutes as any).mock.calls[0]?.[0]
    const scope = await projection.authorizeAgentRequest(fakeRequest('workspace-a', 'user-a'))
    const runtime = await hostOptions.resolveAuthorizedAgentRuntimeScope({ authorizedScope: scope })
    expect(runtime.resourceInputDigest).toMatch(/^sha256:/)
    await expect(runtime.revalidateResourceInputs()).resolves.toBeUndefined()

    await writeFile(extensionPath, "export default 'after'\n", 'utf8')
    await expect(runtime.revalidateResourceInputs()).rejects.toMatchObject({
      code: 'AGENT_REQUEST_CONFLICT',
    })

    const nextScope = await projection.authorizeAgentRequest(fakeRequest('workspace-a', 'user-a'))
    const nextRuntime = await hostOptions.resolveAuthorizedAgentRuntimeScope({ authorizedScope: nextScope })
    dynamicPrompt = 'dynamic after'
    await expect(nextRuntime.revalidateResourceInputs()).rejects.toMatchObject({
      code: 'AGENT_REQUEST_CONFLICT',
    })
  } finally {
    await app.close()
  }
}, 15_000)

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
  })

  try {
    const hostOptions = (mocks.createAgentHost as any).mock.calls[0]?.[0]
    const projection = (mocks.hostRegisterDirectRoutes as any).mock.calls[0]?.[0]
    const scope = await projection.authorizeAgentRequest(fakeRequest('workspace-a', 'user-a'))
    const environment = await hostOptions.resolveAuthorizedEnvironmentScope({ authorizedScope: scope })
    const adapter = { workspaceFs: {} }
    expect(mocks.collectWorkspaceAgentServerPlugins).toHaveBeenCalledWith(expect.objectContaining({
      installPluginAuthoring: false,
    }))
    await environment.provisionRuntime({
      runtimeBundle: { provisioningAdapter: adapter },
      signal: new AbortController().signal,
    })
    expect(mocks.provisionWorkspaceRuntime).toHaveBeenCalledWith(expect.objectContaining({
      plugins: [runtimePlugin],
      adapter,
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
    installPluginAuthoring: true,
    runtimeModeAdapter: {
      id: 'vercel-sandbox',
      getRuntimeLayoutRoot: () => '/workspace',
      runtimeHost: mocks.runtimeHost as any,
      create: vi.fn(),
    },
  })

  try {
    expect(mocks.collectWorkspaceAgentServerPlugins).toHaveBeenCalledWith(expect.objectContaining({
      installPluginAuthoring: true,
    }))
    const hostOptions = (mocks.createAgentHost as any).mock.calls[0]?.[0]
    const projection = (mocks.hostRegisterDirectRoutes as any).mock.calls[0]?.[0]
    const scope = await projection.authorizeAgentRequest(fakeRequest('workspace-a', 'user-a'))
    await expect(hostOptions.resolveAuthorizedAgentRuntimeScope({ authorizedScope: scope }))
      .resolves.toMatchObject({ systemPromptAppend: 'plugin authoring prompt' })
    const environment = await hostOptions.resolveAuthorizedEnvironmentScope({ authorizedScope: scope })
    const adapter = { workspaceFs: {} }
    await environment.provisionRuntime({
      runtimeBundle: { provisioningAdapter: adapter },
      signal: new AbortController().signal,
    })
    expect(mocks.provisionWorkspaceRuntime).toHaveBeenCalledWith(expect.objectContaining({
      plugins: [pluginCli, runtimePlugin],
      adapter,
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
    })

    try {
      const hostOptions = (mocks.createAgentHost as any).mock.calls.at(-1)?.[0] as Record<string, unknown>
      expect(hostOptions.sessionRoot).toBe('/tmp/pi-sessions')
      const projection = (mocks.hostRegisterDirectRoutes as any).mock.calls.at(-1)?.[0]
      const scope = await projection.authorizeAgentRequest(fakeRequest('workspace-a', 'user-a'))
      await expect((hostOptions.resolveAuthorizedEnvironmentScope as Function)({ authorizedScope: scope }))
        .resolves.toMatchObject({ workspaceRoot: '/tmp/workspaces/workspace-a' })
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
