import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, vi } from 'vitest'
import { createTestCoreConfig } from '../../../server/__tests__/createTestApp.js'
import {
  mocks,
  pluginContexts,
} from './createCoreWorkspaceAgentServer.testHarness.js'

const REGULAR_AGENTS = [
  { agentTypeId: 'general', definition: { label: 'General', instructions: 'Answer general questions.' } },
] as const

test.each([
  {
    label: 'invalid grammar',
    agents: [{ agentTypeId: 'Default', definition: { label: 'Invalid', instructions: 'Invalid.' } }],
  },
  {
    label: 'duplicate identities',
    agents: [
      { agentTypeId: 'default', definition: { label: 'First', instructions: 'First.' } },
      { agentTypeId: 'default', definition: { label: 'Second', instructions: 'Second.' } },
    ],
  },
] as const)('rejects $label before config normalization or resource allocation', async ({ agents }) => {
  const config = createTestCoreConfig({ stores: 'postgres', databaseUrl: 'postgres://test' })
  const configNormalizationProbe = vi.fn(() => undefined)
  Object.defineProperty(config, 'signupAgentDefaults', {
    enumerable: true,
    get: configNormalizationProbe,
  })
  const createEnvironment = vi.fn(async () => {
    throw new Error('Environment must not be constructed')
  })
  const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')

  await expect(createCoreWorkspaceAgentServer({
    config,
    agents,
    runtimeModeAdapter: { id: 'direct', create: createEnvironment } as never,
    workspaceRoot: '/tmp/full-app-workspaces',
    serveFrontend: false,
  })).rejects.toMatchObject({ code: 'invalid_default_agent_type_id' })

  expect(configNormalizationProbe).not.toHaveBeenCalled()
  expect(mocks.createDatabase).not.toHaveBeenCalled()
  expect(mocks.collectWorkspaceAgentServerPlugins).not.toHaveBeenCalled()
  expect(mocks.createAgentHost).not.toHaveBeenCalled()
  expect(mocks.inventoryDefaultAgentTypeIds).not.toHaveBeenCalled()
  expect(createEnvironment).not.toHaveBeenCalled()
}, 30_000)

test('core backfills through explicit CAS after fleet validation and before routes', async () => {
  mocks.collectWorkspaceAgentServerPlugins.mockReturnValue({
    runtimePlugins: [], agentOptions: { extraTools: [], pi: {}, systemPromptAppend: undefined },
    preservedUiStateKeys: [], routeContributions: [],
  })
  mocks.inventoryDefaultAgentTypeIds
    .mockResolvedValueOnce([{ defaultAgentTypeId: null, count: 2 }])
    .mockResolvedValueOnce([{ defaultAgentTypeId: 'general', count: 2 }])
  mocks.compareAndSetNullDefaultAgentTypeId.mockResolvedValueOnce(2)
  const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')
  const app = await createCoreWorkspaceAgentServer({
    config: createTestCoreConfig({ stores: 'postgres', databaseUrl: 'postgres://test' }),
    agents: REGULAR_AGENTS,
    workspaceRoot: '/tmp/full-app-workspaces',
    serveFrontend: false,
  })
  try {
    expect(mocks.inventoryDefaultAgentTypeIds).toHaveBeenNthCalledWith(1, 'boring-ui-v2-test')
    expect(mocks.compareAndSetNullDefaultAgentTypeId).toHaveBeenCalledWith('boring-ui-v2-test', 'general')
    expect(mocks.inventoryDefaultAgentTypeIds).toHaveBeenCalledTimes(2)
    expect(mocks.createAgentHost.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.compareAndSetNullDefaultAgentTypeId.mock.invocationCallOrder[0]!)
    expect(mocks.compareAndSetNullDefaultAgentTypeId.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.hostRegisterDirectRoutes.mock.invocationCallOrder[0]!)
  } finally { await app.close() }
}, 60_000)

test('uses one validated config default for plugins, backfill, and future workspace writers', async () => {
  mocks.collectWorkspaceAgentServerPlugins.mockReturnValue({
    runtimePlugins: [], agentOptions: { extraTools: [], pi: {}, systemPromptAppend: undefined },
    preservedUiStateKeys: [], routeContributions: [],
  })
  const config = createTestCoreConfig({
    stores: 'postgres',
    databaseUrl: 'postgres://test',
    defaultAgentTypeId: 'reviewer',
  })
  const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')
  const app = await createCoreWorkspaceAgentServer({
    config,
    agents: [
      { agentTypeId: 'default', legacyDefault: true },
      { agentTypeId: 'reviewer', definition: { label: 'Reviewer', instructions: 'Review.' } },
    ],
    plugins: [{ id: 'default-context-probe' }],
    workspaceRoot: '/tmp/full-app-workspaces',
    serveFrontend: false,
  })
  try {
    expect(mocks.compareAndSetNullDefaultAgentTypeId)
      .toHaveBeenCalledWith(config.appId, 'reviewer')
    expect(pluginContexts).toEqual([
      expect.objectContaining({
        agentTypeId: 'reviewer',
        availableAgentTypeIds: ['default', 'reviewer'],
      }),
    ])
    expect(app.config.defaultAgentTypeId).toBe('reviewer')
  } finally { await app.close() }
}, 30_000)

test('normalizes the deprecated option into the one application default', async () => {
  mocks.collectWorkspaceAgentServerPlugins.mockReturnValue({
    runtimePlugins: [], agentOptions: { extraTools: [], pi: {}, systemPromptAppend: undefined },
    preservedUiStateKeys: [], routeContributions: [],
  })
  const config = createTestCoreConfig({ stores: 'postgres', databaseUrl: 'postgres://test' })
  const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')
  const app = await createCoreWorkspaceAgentServer({
    config,
    defaultAgentTypeId: 'reviewer',
    agents: [
      { agentTypeId: 'default', legacyDefault: true },
      { agentTypeId: 'reviewer', definition: { label: 'Reviewer', instructions: 'Review.' } },
    ],
    plugins: [{ id: 'deprecated-default-context-probe' }],
    workspaceRoot: '/tmp/full-app-workspaces',
    serveFrontend: false,
  })
  try {
    expect(mocks.compareAndSetNullDefaultAgentTypeId)
      .toHaveBeenCalledWith(config.appId, 'reviewer')
    expect(pluginContexts).toEqual([
      expect.objectContaining({
        agentTypeId: 'reviewer',
        availableAgentTypeIds: ['default', 'reviewer'],
      }),
    ])
    expect(app.config.defaultAgentTypeId).toBe('reviewer')
  } finally { await app.close() }
}, 30_000)

test('rejects legacyDefault as a configured workspace default', async () => {
  const config = createTestCoreConfig({
    stores: 'postgres',
    databaseUrl: 'postgres://test',
    defaultAgentTypeId: 'default',
  })
  const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')

  await expect(createCoreWorkspaceAgentServer({
    config,
    agents: [
      { agentTypeId: 'default', legacyDefault: true },
      { agentTypeId: 'general', definition: { label: 'General', instructions: 'Answer general questions.' } },
    ],
    workspaceRoot: '/tmp/full-app-workspaces',
    serveFrontend: false,
  })).rejects.toMatchObject({
    name: 'DefaultAgentTypeError',
    code: 'default_agent_type_unknown_seat',
  })

  expect(mocks.createDatabase).not.toHaveBeenCalled()
  expect(mocks.createAgentHost).not.toHaveBeenCalled()
}, 30_000)

test('rejects conflicting config and deprecated option defaults before resource allocation', async () => {
  const config = createTestCoreConfig({
    stores: 'postgres',
    databaseUrl: 'postgres://test',
    defaultAgentTypeId: 'reviewer',
  })
  const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')

  await expect(createCoreWorkspaceAgentServer({
    config,
    defaultAgentTypeId: 'default',
    agents: [
      { agentTypeId: 'default', legacyDefault: true },
      { agentTypeId: 'reviewer', definition: { label: 'Reviewer', instructions: 'Review.' } },
    ],
    workspaceRoot: '/tmp/full-app-workspaces',
    serveFrontend: false,
  })).rejects.toMatchObject({
    name: 'ConfigValidationError',
    code: 'config_validation_failed',
    issues: [{
      path: ['defaultAgentTypeId'],
      message: expect.stringContaining('conflicts'),
    }],
  })

  expect(mocks.createDatabase).not.toHaveBeenCalled()
  expect(mocks.collectWorkspaceAgentServerPlugins).not.toHaveBeenCalled()
  expect(mocks.createAgentHost).not.toHaveBeenCalled()
}, 30_000)

test.each(['before-inventory', 'cas', 'cas-undefined-table', 'after-inventory', 'after-inventory-undefined-table', 'remaining-null'] as const)(
  'closes AgentHost when default migration fails at %s',
  async (stage) => {
    mocks.collectWorkspaceAgentServerPlugins.mockReturnValue({
      runtimePlugins: [], agentOptions: { extraTools: [], pi: {}, systemPromptAppend: undefined },
      preservedUiStateKeys: [], routeContributions: [],
    })
    if (stage === 'before-inventory') {
      mocks.inventoryDefaultAgentTypeIds.mockRejectedValueOnce(new Error('inventory unavailable'))
    } else if (stage === 'cas' || stage === 'cas-undefined-table') {
      mocks.inventoryDefaultAgentTypeIds.mockResolvedValueOnce([])
      mocks.compareAndSetNullDefaultAgentTypeId.mockRejectedValueOnce(
        stage === 'cas'
          ? new Error('CAS unavailable')
          : Object.assign(new Error('CAS relation failure'), { cause: { code: '42P01' } }),
      )
    } else if (stage === 'after-inventory' || stage === 'after-inventory-undefined-table') {
      mocks.inventoryDefaultAgentTypeIds
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(stage === 'after-inventory'
          ? new Error('post-inventory unavailable')
          : Object.assign(new Error('post-inventory relation failure'), { cause: { code: '42P01' } }))
    } else {
      mocks.inventoryDefaultAgentTypeIds
        .mockResolvedValueOnce([{ defaultAgentTypeId: null, count: 1 }])
        .mockResolvedValueOnce([{ defaultAgentTypeId: null, count: 1 }])
    }
    const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')
    await expect(createCoreWorkspaceAgentServer({
      config: createTestCoreConfig({ stores: 'postgres', databaseUrl: 'postgres://test' }),
      agents: REGULAR_AGENTS,
      workspaceRoot: '/tmp/full-app-workspaces',
      serveFrontend: false,
    })).rejects.toThrow(stage === 'remaining-null'
      ? 'Workspace default Agent legacy reconciliation did not converge'
      : stage.includes('undefined-table') ? /relation failure/ : /unavailable/)
    expect(mocks.hostClose).toHaveBeenCalledOnce()
    expect(mocks.hostRegisterDirectRoutes).not.toHaveBeenCalled()
  },
  30_000,
)

test('keeps the pre-schema reference health composition bootable without weakening other migration failures', async () => {
  mocks.collectWorkspaceAgentServerPlugins.mockReturnValue({
    runtimePlugins: [], agentOptions: { extraTools: [], pi: {}, systemPromptAppend: undefined },
    preservedUiStateKeys: [], routeContributions: [],
  })
  mocks.inventoryDefaultAgentTypeIds.mockRejectedValueOnce(Object.assign(
    new Error('inventory query failed'),
    { cause: Object.assign(new Error('relation workspaces does not exist'), { code: '42P01' }) },
  ))
  const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')
  const app = await createCoreWorkspaceAgentServer({
    config: createTestCoreConfig({ stores: 'postgres', databaseUrl: 'postgres://test' }),
    agents: REGULAR_AGENTS,
    workspaceRoot: '/tmp/full-app-workspaces',
    serveFrontend: false,
  })
  try {
    expect(mocks.compareAndSetNullDefaultAgentTypeId).not.toHaveBeenCalled()
    expect(mocks.hostRegisterDirectRoutes).toHaveBeenCalledOnce()
  } finally { await app.close() }
}, 30_000)

test('keeps the pre-0024 reference health composition bootable when the default_agent_type_id column is absent', async () => {
  mocks.collectWorkspaceAgentServerPlugins.mockReturnValue({
    runtimePlugins: [], agentOptions: { extraTools: [], pi: {}, systemPromptAppend: undefined },
    preservedUiStateKeys: [], routeContributions: [],
  })
  // A workspaces table that exists but predates migration 0024 raises
  // undefined_column (42703), not undefined_table (42P01) — the inventory
  // query selects a column the schema does not yet have.
  mocks.inventoryDefaultAgentTypeIds.mockRejectedValueOnce(Object.assign(
    new Error('inventory query failed'),
    { cause: Object.assign(new Error('column "default_agent_type_id" does not exist'), { code: '42703' }) },
  ))
  const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')
  const app = await createCoreWorkspaceAgentServer({
    config: createTestCoreConfig({ stores: 'postgres', databaseUrl: 'postgres://test' }),
    agents: REGULAR_AGENTS,
    workspaceRoot: '/tmp/full-app-workspaces',
    serveFrontend: false,
  })
  try {
    expect(mocks.compareAndSetNullDefaultAgentTypeId).not.toHaveBeenCalled()
    expect(mocks.hostRegisterDirectRoutes).toHaveBeenCalledOnce()
  } finally { await app.close() }
}, 30_000)

test('unknown persisted default denies execution but preserves session and history reads', async () => {
  mocks.collectWorkspaceAgentServerPlugins.mockReturnValue({
    runtimePlugins: [], agentOptions: { extraTools: [], pi: {}, systemPromptAppend: undefined },
    preservedUiStateKeys: [], routeContributions: [],
  })
  mocks.getWorkspace.mockImplementation(async (id: string) => ({
    id, appId: 'boring-ui-v2-test', defaultAgentTypeId: 'retired-seat',
  }))
  const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')
  let dispatcher: import('@hachej/boring-agent/server').WorkspaceAgentDispatcherResolver | undefined
  const app = await createCoreWorkspaceAgentServer({
    config: createTestCoreConfig({ stores: 'postgres', databaseUrl: 'postgres://test' }),
    workspaceRoot: '/tmp/full-app-workspaces',
    serveFrontend: false,
    onWorkspaceAgentDispatcher: (value) => { dispatcher = value },
  })
  try {
    const ref = { agentTypeId: 'default', sessionId: 'old-session' }
    await expect(dispatcher!.authorizeSession!({ workspaceId: 'workspace-a', userId: 'user-a' }, ref)).resolves.toBeUndefined()
    await expect(dispatcher!.readSessionRunDetails!(
      { workspaceId: 'workspace-a', userId: 'user-a' }, ref, ['tool'],
    )).resolves.toEqual([])
    expect(mocks.gatewayReadSessionState).toHaveBeenCalledTimes(2)

    const storageLease = vi.fn(async () => {})
    await expect(dispatcher!.runWithWorkspaceAgent!({
      agentTypeId: 'default',
      context: { workspaceId: 'workspace-a', userId: 'user-a' },
      requestId: 'automation-history-read',
    }, storageLease)).resolves.toBeUndefined()
    expect(mocks.hostRunWithWorkspaceAgent).toHaveBeenCalledOnce()
    expect(storageLease).toHaveBeenCalledWith({ marker: 'lease-bound-workspace-agent' })

    const meta = await app.inject({ method: 'GET', url: '/api/v1/workspace/meta?workspaceId=workspace-a',
      headers: { 'x-test-user-id': 'user-a' } })
    expect(meta.statusCode).toBe(409)
    expect(meta.json()).toMatchObject({
      code: 'default_agent_type_unknown_seat',
      message: 'Workspace default Agent is unavailable',
      requestId: expect.any(String),
    })
  } finally { await app.close() }
}, 60_000)

test('rejects actual execution paths before binding or Environment acquisition', async () => {
  mocks.collectWorkspaceAgentServerPlugins.mockReturnValue({
    runtimePlugins: [], agentOptions: { extraTools: [], pi: {}, systemPromptAppend: undefined },
    preservedUiStateKeys: [], routeContributions: [],
  })
  const config = createTestCoreConfig({ stores: 'postgres', databaseUrl: 'postgres://test' })
  mocks.getWorkspace.mockImplementation(async (id: string) => ({
    id,
    appId: config.appId,
    defaultAgentTypeId: 'retired-seat',
  }))
  const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')
  const actualCreateAgentHost = mocks.actualCreateAgentHost
  const createRuntimeModeAdapter = mocks.actualCreateSandboxRuntimeModeAdapter
  if (!actualCreateAgentHost || !createRuntimeModeAdapter) {
    throw new Error('real AgentHost test dependencies were not captured')
  }
  mocks.createAgentHost.mockImplementationOnce(actualCreateAgentHost)
  const baseAdapter = createRuntimeModeAdapter('direct')
  const createEnvironment = vi.fn(baseAdapter.create.bind(baseAdapter))
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'core-default-policy-workspaces-'))
  const sessionRoot = await mkdtemp(join(tmpdir(), 'core-default-policy-sessions-'))
  const app = await createCoreWorkspaceAgentServer({
    config,
    workspaceRoot,
    sessionRoot,
    getWorkspaceRoot: async () => workspaceRoot,
    runtimeModeAdapter: { ...baseAdapter, create: createEnvironment },
    serveFrontend: false,
  })
  try {
    mocks.provisionWorkspaceRuntime.mockClear()
    const headers = {
      'x-test-user-id': 'user-a',
      'x-boring-workspace-id': 'workspace-a',
    }
    const requests = [
      {
        method: 'POST' as const,
        url: '/api/v1/agents/default/sessions',
        payload: { requestId: 'blocked-create' },
      },
      {
        method: 'POST' as const,
        url: '/api/v1/agents/default/sessions/missing/prompt',
        payload: { requestId: 'blocked-prompt', clientNonce: 'prompt-1', content: 'hello' },
      },
      {
        method: 'POST' as const,
        url: '/api/v1/agents/default/sessions/missing/followup',
        payload: { requestId: 'blocked-followup', clientNonce: 'followup-1', clientSeq: 1, content: 'next' },
      },
      {
        method: 'POST' as const,
        url: '/api/v1/agents/default/commands/execute',
        payload: { requestId: 'blocked-command', sessionId: 'missing', name: 'help', args: '' },
      },
      {
        method: 'POST' as const,
        url: '/api/v1/agents/default/reload',
        payload: { requestId: 'blocked-reload' },
      },
    ]
    for (const request of requests) {
      const response = await app.inject({ ...request, headers })
      expect(response.statusCode, `${request.url}: ${response.body}`).toBe(404)
      expect(response.json(), request.url).toMatchObject({
        error: {
          code: 'AGENT_TYPE_UNKNOWN',
          details: { code: 'default_agent_type_unknown_seat' },
        },
      })
    }
    expect(createEnvironment).not.toHaveBeenCalled()
    expect(mocks.provisionWorkspaceRuntime).not.toHaveBeenCalled()
  } finally {
    await app.close()
  }
}, 60_000)

test('workspace meta resolves a legacy NULL default from the configured application default, not the first fleet seat', async () => {
  mocks.collectWorkspaceAgentServerPlugins.mockReturnValue({
    runtimePlugins: [], agentOptions: { extraTools: [], pi: {}, systemPromptAppend: undefined },
    preservedUiStateKeys: [], routeContributions: [],
  })
  // Simulates a rollback-compatible NULL read racing ahead of the startup
  // backfill: workspace meta must still use the same validated application
  // default from config as every other consumer, not agents[0].
  const config = createTestCoreConfig({
    stores: 'postgres',
    databaseUrl: 'postgres://test',
    defaultAgentTypeId: 'reviewer',
  })
  mocks.getWorkspace.mockImplementation(async (id: string) => ({
    id, appId: config.appId, defaultAgentTypeId: null as unknown as string,
  }))
  const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')
  const app = await createCoreWorkspaceAgentServer({
    config,
    agents: [
      { agentTypeId: 'default', legacyDefault: true },
      { agentTypeId: 'reviewer', definition: { label: 'Reviewer', instructions: 'Review.' } },
    ],
    workspaceRoot: '/tmp/full-app-workspaces',
    serveFrontend: false,
  })
  try {
    const meta = await app.inject({ method: 'GET', url: '/api/v1/workspace/meta?workspaceId=workspace-a',
      headers: { 'x-test-user-id': 'user-a' } })
    expect(meta.statusCode).toBe(200)
    expect(meta.json()).toMatchObject({ defaultAgentTypeId: 'reviewer' })
  } finally { await app.close() }
}, 30_000)
