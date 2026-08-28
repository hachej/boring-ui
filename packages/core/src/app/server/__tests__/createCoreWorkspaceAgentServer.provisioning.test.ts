import { AgentGatewayErrorCode, ErrorCode, type AgentTool, type AuthorizedAgentScope } from '@hachej/boring-agent/shared'
import { randomUUID } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, vi } from 'vitest'
import { createTestCoreConfig } from '../../../server/__tests__/createTestApp.js'
import { fakeRequest, mocks } from './createCoreWorkspaceAgentServer.testHarness.js'

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
}, 30_000) // Full Core composition can exceed 15 seconds on a cold module load.

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

test('core enforces workspace Seats before product entitlement policy', async () => {
  mocks.collectWorkspaceAgentServerPlugins.mockReturnValue({
    runtimePlugins: [],
    agentOptions: { extraTools: [], pi: {}, systemPromptAppend: undefined },
    preservedUiStateKeys: [],
    routeContributions: [],
  })
  mocks.getWorkspace.mockImplementation(async (id) => ({
    id,
    appId: 'boring-ui-v2-test',
    defaultAgentTypeId: 'default',
  }))
  mocks.hasAgentSeat.mockImplementation(async (_workspaceId, agentTypeId) => agentTypeId === 'default')
  const resolveAgentEntitlement = vi.fn(async () => ({ state: 'allowed' as const, seatId: 'seat-default' }))
  const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')
  const app = await createCoreWorkspaceAgentServer({
    config: createTestCoreConfig({ stores: 'postgres', databaseUrl: 'postgres://test' }),
    workspaceRoot: '/tmp/full-app-workspaces',
    serveFrontend: false,
    workspaceAgentAccessMode: 'enforce',
    resolveAgentEntitlement,
  })

  try {
    const hostOptions = (mocks.createAgentHost as any).mock.calls[0]?.[0] as Record<string, any>
    const projection = (mocks.hostRegisterDirectRoutes as any).mock.calls[0]?.[0] as Record<string, any>
    const scope = await projection.authorizeAgentRequest(fakeRequest('workspace-a', 'user-a'))
    const verifiedClaim = await hostOptions.scopeVerifier.verify(scope)
    await expect(hostOptions.resolveAgentAccess({
      verifiedClaim,
      agentTypeId: 'other-agent',
      operation: 'session.create',
    })).resolves.toEqual({ state: 'not-available', reason: 'not-seated' })
    expect(resolveAgentEntitlement).not.toHaveBeenCalled()

    await expect(hostOptions.resolveAgentAccess({
      verifiedClaim,
      agentTypeId: 'default',
      operation: 'session.create',
    })).resolves.toEqual({ state: 'allowed', seatId: 'seat-default' })
    expect(mocks.hasAgentSeat).toHaveBeenCalledWith('workspace-a', 'default')
    expect(resolveAgentEntitlement).toHaveBeenCalledWith({
      workspaceId: 'workspace-a',
      userId: 'user-a',
      agentTypeId: 'default',
      operation: 'session.create',
    })
  } finally {
    await app.close()
  }
}, 15_000)

test('core exposes idempotent add-only workspace Agent Seat routes', async () => {
  mocks.collectWorkspaceAgentServerPlugins.mockReturnValue({
    runtimePlugins: [],
    agentOptions: { extraTools: [], pi: {}, systemPromptAppend: undefined },
    preservedUiStateKeys: [],
    routeContributions: [],
  })
  mocks.getWorkspace.mockImplementation(async (id) => ({
    id,
    appId: 'boring-ui-v2-test',
    defaultAgentTypeId: 'default',
  }))
  mocks.listAgentSeats.mockResolvedValue([{
    seatId: 'seat-default',
    workspaceId: 'workspace-a',
    agentTypeId: 'default',
    source: 'operator',
    enrolledByUserId: 'private-operator-id',
    createdAt: '2026-08-27T00:00:00.000Z',
  }])
  let entitlementUnavailable = false
  const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')
  const app = await createCoreWorkspaceAgentServer({
    config: createTestCoreConfig({ stores: 'postgres', databaseUrl: 'postgres://test' }),
    workspaceRoot: '/tmp/full-app-workspaces',
    serveFrontend: false,
    canEnrollAgent: async () => true,
    resolveAgentEntitlement: async () => entitlementUnavailable
      ? { state: 'policy-unavailable' }
      : { state: 'allowed', seatId: 'seat-default' },
    requestScopeResolver: () => ({
      bindingId: 'binding-a',
      workspaceId: 'workspace-a',
      defaultDeploymentId: 'deployment-a',
      activeRevision: 'revision-a',
      resolvedDigest: 'digest-a',
    }),
  })

  try {
    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/workspaces/workspace-a/agent-seats',
      headers: { 'x-test-user-id': 'user-a' },
    })
    expect(listed.statusCode).toBe(200)
    expect(listed.json()).toEqual({
      seats: [{ agentTypeId: 'default', createdAt: '2026-08-27T00:00:00.000Z' }],
    })
    expect(listed.body).not.toContain('source')
    expect(listed.body).not.toContain('private-operator-id')

    entitlementUnavailable = true
    const unavailable = await app.inject({
      method: 'GET',
      url: '/api/v1/workspaces/workspace-a/agent-seats',
      headers: { 'x-test-user-id': 'user-a' },
    })
    expect(unavailable.statusCode).toBe(503)
    entitlementUnavailable = false

    const added = await app.inject({
      method: 'POST',
      url: '/api/v1/workspaces/workspace-a/agent-seats/default',
      headers: {
        'x-test-user-id': 'user-a',
        'x-boring-workspace-id': 'workspace-a',
        origin: 'http://localhost:3000',
      },
    })
    expect(added.statusCode, added.body).toBe(200)
    expect(added.json()).toMatchObject({
      seat: { agentTypeId: 'default' },
    })
    expect(added.json().seat).not.toHaveProperty('source')
    expect(added.json().seat).not.toHaveProperty('enrolledByUserId')
    expect(mocks.addAgentSeat).toHaveBeenCalledWith(
      'workspace-a',
      'default',
      'user-add',
      'user-a',
    )

    const unknown = await app.inject({
      method: 'POST',
      url: '/api/v1/workspaces/workspace-a/agent-seats/not-deployed',
      headers: {
        'x-test-user-id': 'user-a',
        'x-boring-workspace-id': 'workspace-a',
        origin: 'http://localhost:3000',
      },
    })
    expect(unknown.statusCode).toBe(404)

    const crossBound = await app.inject({
      method: 'POST',
      url: '/api/v1/workspaces/workspace-b/agent-seats/default',
      headers: {
        'x-test-user-id': 'user-a',
        origin: 'http://localhost:3000',
      },
    })
    expect(crossBound.statusCode).toBe(421)
  } finally {
    await app.close()
  }
}, 30_000)

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
    const admissionInput = {
      key: { requestId: 'interrupt-1' },
      operation: 'session.interrupt',
      scope: {},
      target: { kind: 'session' },
    }
    await expect(hostOptions.effectAdmission.admit(admissionInput)).resolves.toMatchObject({ type: 'accepted' })
    expect(effectAdmission.admit).toHaveBeenCalledWith(admissionInput)
    expect(hostOptions).not.toHaveProperty('effectPolicy')
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
    config: createTestCoreConfig({
      stores: 'postgres',
      databaseUrl: 'postgres://test',
      defaultAgentTypeId: 'configured',
    }),
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
    config: createTestCoreConfig({
      stores: 'postgres',
      databaseUrl: 'postgres://test',
      defaultAgentTypeId: 'configured',
    }),
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
    config: createTestCoreConfig({
      stores: 'postgres',
      databaseUrl: 'postgres://test',
      defaultAgentTypeId: 'configured',
    }),
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
  mocks.getWorkspace.mockImplementation(async (id: string) => ({ id, appId: config.appId, defaultAgentTypeId: null }))
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
  const seenWorkspaceIds: string[] = []
  const seenPiAgentTypes: string[] = []
  let macroSearchDescription = 'macro search v1'

  const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')
  const app = await createCoreWorkspaceAgentServer({
    config: createTestCoreConfig({ stores: 'postgres', databaseUrl: 'postgres://test' }),
    workspaceRoot: '/tmp/full-app-workspaces',
    getExtraTools: async () => [tool('shared_tool')],
    getAgentExtraTools: async ({ agentTypeId, workspaceId }) => {
      seenAgentTypes.push(agentTypeId)
      seenWorkspaceIds.push(workspaceId)
      return agentTypeId === 'macro'
        ? [tool('macro_search', macroSearchDescription), tool('persist_derived_series')]
        : []
    },
    getAgentPi: async ({ agentTypeId }) => {
      seenPiAgentTypes.push(agentTypeId)
      return agentTypeId === 'macro'
        ? { packages: ['npm:macro-only-pi-package'] }
        : undefined
    },
    serveFrontend: false,
  })

  try {
    const hostOptions = (mocks.createAgentHost as any).mock.calls[0]?.[0]
    const projection = (mocks.hostRegisterDirectRoutes as any).mock.calls[0]?.[0]
    const scope = await projection.authorizeAgentRequest(fakeRequest('workspace-a', 'user-a'))
    const verifiedClaim = { workspaceScopeId: 'workspace-a', authSubjectId: 'user-a' }
    const environment = {
      runtimeWorkspaceId: 'runtime-workspace-a',
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
    expect(macro.pi.packages).toContain('npm:macro-only-pi-package')
    expect(charlotte.pi.packages).not.toContain('npm:macro-only-pi-package')
    expect(changedMacroContract.identity).not.toBe(macro.identity)
    expect(changedMacroContract.physicalBindingIdentity).toBe(macro.physicalBindingIdentity)
    expect(changedMacroContract.resourceInputDigest).not.toBe(macro.resourceInputDigest)
    expect(seenAgentTypes).toEqual(['macro', 'charlotteledoux', 'macro'])
    expect(seenWorkspaceIds).toEqual([
      'runtime-workspace-a',
      'runtime-workspace-a',
      'runtime-workspace-a',
    ])
    expect(seenPiAgentTypes).toEqual(['macro', 'charlotteledoux', 'macro'])
  } finally {
    await app.close()
  }
}, 15_000)

test('core/full-app keeps the physical slot stable when only addressed Pi changes', async () => {
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
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'core-pi-identity-'))
  const firstSkillPath = join(workspaceRoot, 'skills', 'first')
  const secondSkillPath = join(workspaceRoot, 'skills', 'second')
  await mkdir(firstSkillPath, { recursive: true })
  await mkdir(secondSkillPath, { recursive: true })
  await writeFile(join(firstSkillPath, 'SKILL.md'), '---\nname: first\ndescription: First identity input.\n---\n')
  await writeFile(join(secondSkillPath, 'SKILL.md'), '---\nname: second\ndescription: Second identity input.\n---\n')
  let addressedSkillPath = firstSkillPath

  const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')
  const app = await createCoreWorkspaceAgentServer({
    config: createTestCoreConfig({ stores: 'postgres', databaseUrl: 'postgres://test' }),
    workspaceRoot,
    getWorkspaceRoot: async () => workspaceRoot,
    getAgentPi: async () => ({ additionalSkillPaths: [addressedSkillPath] }),
    serveFrontend: false,
  })

  try {
    const hostOptions = (mocks.createAgentHost as any).mock.calls[0]?.[0]
    const projection = (mocks.hostRegisterDirectRoutes as any).mock.calls[0]?.[0]
    const scope = await projection.authorizeAgentRequest(fakeRequest('workspace-a', 'user-a'))
    const input = {
      authorizedScope: scope,
      verifiedClaim: { workspaceScopeId: 'workspace-a', authSubjectId: 'user-a' },
      agentTypeId: 'macro',
      environment: {
        runtimeWorkspaceId: 'runtime-workspace-a',
        workspaceRoot,
        placementIdentity: 'workspace-a',
        provisioningFingerprint: 'test-provisioning',
      },
      intent: { kind: 'agent-binding', operation: 'new-binding', requestId: 'same-request' },
    }
    const first = await hostOptions.resolveAuthorizedAgentRuntimeScope(input)
    addressedSkillPath = secondSkillPath
    const second = await hostOptions.resolveAuthorizedAgentRuntimeScope(input)

    expect.soft(second.identity).not.toBe(first.identity)
    expect.soft(second.physicalBindingIdentity).toBe(first.physicalBindingIdentity)
    expect.soft(second.resourceInputDigest).not.toBe(first.resourceInputDigest)
  } finally {
    await app.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  }
}, 30_000)

test('core/full-app addressed routes deny a sibling another agent\'s Pi grants', async () => {
  const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')
  const actualCreateAgentHost = mocks.actualCreateAgentHost
  const createRuntimeModeAdapter = mocks.actualCreateSandboxRuntimeModeAdapter
  if (!actualCreateAgentHost || !createRuntimeModeAdapter) {
    throw new Error('real AgentHost test dependencies were not captured')
  }
  mocks.createAgentHost.mockImplementationOnce(actualCreateAgentHost)
  mocks.collectWorkspaceAgentServerPlugins.mockReturnValue({
    runtimePlugins: [],
    provisioningContributions: [],
    agentOptions: {
      extraTools: [],
      pi: { additionalSkillPaths: [], packages: [], noSkills: false, noExtensions: false },
      systemPromptAppend: undefined,
    },
    preservedUiStateKeys: [],
    routeContributions: [],
  })
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'core-sibling-pi-grants-'))
  const sessionRoot = await mkdtemp(join(tmpdir(), 'core-sibling-pi-sessions-'))
  const packageRoot = join(workspaceRoot, 'macro-package')
  const packageSkillPath = join(packageRoot, 'skills', 'macro-package-skill')
  const directSkillPath = join(workspaceRoot, 'macro-direct-skill')
  const revisedSkillPath = join(workspaceRoot, 'macro-revised-skill')
  const extensionPath = join(workspaceRoot, 'macro-extension.ts')
  await mkdir(packageSkillPath, { recursive: true })
  await mkdir(directSkillPath, { recursive: true })
  await mkdir(revisedSkillPath, { recursive: true })
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
    name: 'macro-pi-package',
    version: '1.0.0',
    type: 'module',
    pi: { skills: ['skills/macro-package-skill'] },
  }))
  await writeFile(join(packageSkillPath, 'SKILL.md'), [
    '---',
    'name: macro-package-skill',
    'description: Package grant visible only to Macro.',
    '---',
    '# Macro package skill',
  ].join('\n'))
  await writeFile(join(directSkillPath, 'SKILL.md'), [
    '---',
    'name: macro-direct-skill',
    'description: Direct skill grant visible only to Macro.',
    '---',
    '# Macro direct skill',
  ].join('\n'))
  await writeFile(join(revisedSkillPath, 'SKILL.md'), [
    '---',
    'name: macro-revised-skill',
    'description: Revised grant used to prove physical binding stability.',
    '---',
    '# Macro revised skill',
  ].join('\n'))
  await writeFile(extensionPath, [
    'export default function (pi: any) {',
    "  pi.registerCommand('macro-extension-grant', {",
    "    description: 'Extension grant visible only to Macro.',",
    '    handler: async () => {},',
    '  })',
    '}',
  ].join('\n'))

  const config = createTestCoreConfig({
    stores: 'postgres',
    databaseUrl: 'postgres://test',
    defaultAgentTypeId: 'macro',
  })
  mocks.getWorkspace.mockImplementation(async (id) => ({
    id,
    appId: config.appId,
    defaultAgentTypeId: 'macro',
  }))
  let addressedSkillPath = directSkillPath
  const app = await createCoreWorkspaceAgentServer({
    config,
    agents: [
      { agentTypeId: 'macro', definition: { label: 'Macro', instructions: 'Analyze macros.' } },
      { agentTypeId: 'sibling', definition: { label: 'Sibling', instructions: 'Stay isolated.' } },
    ],
    workspaceRoot,
    sessionRoot,
    getWorkspaceRoot: async () => workspaceRoot,
    runtimeModeAdapter: createRuntimeModeAdapter('direct'),
    getAgentPi: async ({ agentTypeId }) => agentTypeId === 'macro'
      ? {
          packages: [packageRoot],
          additionalSkillPaths: [addressedSkillPath],
          extensionPaths: [extensionPath],
        }
      : undefined,
    serveFrontend: false,
  })

  try {
    const headers = {
      'x-test-user-id': 'user-a',
      'x-boring-workspace-id': 'workspace-a',
    }
    const createSession = async (agentTypeId: string) => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/agents/${agentTypeId}/sessions`,
        headers,
        payload: { requestId: `create-${agentTypeId}` },
      })
      expect(response.statusCode, response.body).toBe(201)
      return response.json().sessionId as string
    }
    const macroSessionId = await createSession('macro')
    const siblingSessionId = await createSession('sibling')
    const macroSkills = await app.inject({ method: 'GET', url: '/api/v1/agents/macro/skills', headers })
    const siblingSkills = await app.inject({ method: 'GET', url: '/api/v1/agents/sibling/skills', headers })
    expect(macroSkills.statusCode, macroSkills.body).toBe(200)
    expect(siblingSkills.statusCode, siblingSkills.body).toBe(200)
    expect(macroSkills.json()).not.toHaveProperty('error')
    expect(siblingSkills.json()).not.toHaveProperty('error')
    const macroSkillNames = macroSkills.json().skills.map((skill: { name: string }) => skill.name)
    const siblingSkillNames = siblingSkills.json().skills.map((skill: { name: string }) => skill.name)
    expect(macroSkillNames).toEqual(expect.arrayContaining(['macro-package-skill', 'macro-direct-skill']))
    expect(siblingSkillNames).not.toContain('macro-package-skill')
    expect(siblingSkillNames).not.toContain('macro-direct-skill')

    const macroCommands = await app.inject({
      method: 'GET',
      url: `/api/v1/agents/macro/commands?sessionId=${macroSessionId}`,
      headers,
    })
    const siblingCommands = await app.inject({
      method: 'GET',
      url: `/api/v1/agents/sibling/commands?sessionId=${siblingSessionId}`,
      headers,
    })
    expect(macroCommands.statusCode, macroCommands.body).toBe(200)
    expect(siblingCommands.statusCode, siblingCommands.body).toBe(200)
    expect(macroCommands.json().commands.map((command: { name: string }) => command.name))
      .toContain('macro-extension-grant')
    expect(siblingCommands.json().commands.map((command: { name: string }) => command.name))
      .not.toContain('macro-extension-grant')

    addressedSkillPath = revisedSkillPath
    const revisedGrantReload = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/macro/reload',
      headers,
      payload: { requestId: 'reload-macro-revised-pi', sessionId: macroSessionId },
    })
    expect(revisedGrantReload.statusCode, revisedGrantReload.body).toBe(409)
    expect(revisedGrantReload.json()).toMatchObject({
      error: { code: AgentGatewayErrorCode.AGENT_RUNTIME_RESTART_REQUIRED },
    })
  } finally {
    await app.close()
    await Promise.all([
      rm(workspaceRoot, { recursive: true, force: true }),
      rm(sessionRoot, { recursive: true, force: true }),
    ])
  }
}, 60_000)

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
    getAgentPi: async ({ agentTypeId }) => agentTypeId === 'factory-orchestrator'
      ? { extensionPaths: [extensionPath] }
      : undefined,
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
    const agentRuntimeInput = {
      authorizedScope: scope,
      verifiedClaim: { workspaceScopeId: 'workspace-a', authSubjectId: 'user-a' },
      agentTypeId: 'factory-orchestrator',
      environment: {
        runtimeWorkspaceId: 'workspace-a',
        workspaceRoot,
        placementIdentity: 'workspace-a',
        provisioningFingerprint: 'test-provisioning',
      },
    }
    const runtime = await hostOptions.resolveAuthorizedAgentRuntimeScope(agentRuntimeInput)
    expect(runtime.resourceInputDigest).toMatch(/^sha256:/)
    await expect(runtime.revalidateResourceInputs()).resolves.toBeUndefined()

    await writeFile(extensionPath, "export default 'after'\n", 'utf8')
    await expect(runtime.revalidateResourceInputs()).rejects.toMatchObject({
      code: 'AGENT_REQUEST_CONFLICT',
    })

    const nextScope = await projection.authorizeAgentRequest(fakeRequest('workspace-a', 'user-a'))
    const nextRuntime = await hostOptions.resolveAuthorizedAgentRuntimeScope({ ...agentRuntimeInput, authorizedScope: nextScope })
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

test.each(['vercel-sandbox', 'blaxel', 'remote-worker'] as const)(
  'core/full-app keeps %s extension isolation when getAgentPi is invoked',
  async (runtimeMode) => {
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
      runtimeModeAdapter: {
        id: runtimeMode,
        getRuntimeLayoutRoot: () => '/workspace',
        runtimeHost: mocks.runtimeHost as any,
        create: vi.fn(),
      },
      // Runtime callers are untyped; ignore unsupported fields rather than
      // allowing an agent-specific grant to relax remote isolation.
      getAgentPi: async () => ({ noExtensions: false } as never),
      serveFrontend: false,
    })

    try {
      const hostOptions = (mocks.createAgentHost as any).mock.calls[0]?.[0]
      const projection = (mocks.hostRegisterDirectRoutes as any).mock.calls[0]?.[0]
      const scope = await projection.authorizeAgentRequest(fakeRequest('workspace-a', 'user-a'))
      await expect(hostOptions.resolveAuthorizedAgentRuntimeScope({
        authorizedScope: scope,
        verifiedClaim: { workspaceScopeId: 'workspace-a', authSubjectId: 'user-a' },
        agentTypeId: 'remote-agent',
        environment: {
          runtimeWorkspaceId: 'workspace-a',
          workspaceRoot: '/tmp/full-app-workspaces/workspace-a',
          placementIdentity: 'workspace-a',
          provisioningFingerprint: 'test-provisioning',
        },
      })).resolves.toMatchObject({ pi: { noExtensions: true } })
    } finally {
      await app.close()
    }
  },
  30_000,
)

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
