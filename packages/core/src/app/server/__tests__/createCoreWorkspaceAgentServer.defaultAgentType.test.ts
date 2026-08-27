import { access, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, vi } from 'vitest'
import { createTestCoreConfig as createBaseTestCoreConfig } from '../../../server/__tests__/createTestApp.js'
import { reconcileWorkspaceDefaultAgentTypes } from '../../../server/reconcileWorkspaceDefaultAgentTypes.js'
import type { CoreConfig } from '../../../shared/types.js'
import {
  mocks,
  pluginContexts,
} from './createCoreWorkspaceAgentServer.testHarness.js'

const REGULAR_AGENTS = [
  { agentTypeId: 'general', definition: { label: 'General', instructions: 'Answer general questions.' } },
] as const

function createTestCoreConfig(overrides: Partial<CoreConfig> = {}): CoreConfig {
  return createBaseTestCoreConfig({ defaultAgentTypeId: 'general', ...overrides })
}

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
      { agentTypeId: 'default', definition: { label: 'Agent', instructions: 'Default.' } },
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

test('reconciles only NULL rows and reports scalar convergence counts', async () => {
  const workspaceStore = {
    countNullDefaultAgentTypeIds: vi.fn()
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(0),
    compareAndSetNullDefaultAgentTypeId: vi.fn().mockResolvedValueOnce(2),
  }
  const log = { info: vi.fn(), warn: vi.fn() }

  await reconcileWorkspaceDefaultAgentTypes({
    workspaceStore,
    appId: 'app-a',
    applicationDefaultAgentTypeId: 'reviewer',
    log,
  })

  expect(workspaceStore.compareAndSetNullDefaultAgentTypeId).toHaveBeenCalledWith('app-a', 'reviewer')
  expect(log.info).toHaveBeenCalledWith(expect.objectContaining({
    beforeNullCount: 2,
    migratedCount: 2,
    afterNullCount: 0,
  }), expect.any(String))
})

test.each(['42P01', '42703'])('skips only a missing pre-migration schema (%s)', async (code) => {
  const workspaceStore = {
    countNullDefaultAgentTypeIds: vi.fn().mockRejectedValueOnce(Object.assign(
      new Error('pre-schema'),
      { cause: { code } },
    )),
    compareAndSetNullDefaultAgentTypeId: vi.fn(),
  }
  const log = { info: vi.fn(), warn: vi.fn() }

  await reconcileWorkspaceDefaultAgentTypes({
    workspaceStore,
    appId: 'app-a',
    applicationDefaultAgentTypeId: 'reviewer',
    log,
  })

  expect(workspaceStore.compareAndSetNullDefaultAgentTypeId).not.toHaveBeenCalled()
  expect(log.warn).toHaveBeenCalledOnce()
})

test('fails when NULL reconciliation does not converge', async () => {
  const workspaceStore = {
    countNullDefaultAgentTypeIds: vi.fn().mockResolvedValue(1),
    compareAndSetNullDefaultAgentTypeId: vi.fn().mockResolvedValue(0),
  }

  await expect(reconcileWorkspaceDefaultAgentTypes({
    workspaceStore,
    appId: 'app-a',
    applicationDefaultAgentTypeId: 'reviewer',
    log: { info: vi.fn(), warn: vi.fn() },
  })).rejects.toMatchObject({ code: 'default_agent_type_unknown_seat' })
})

test('workspace meta rejects a deleted workspace before recreating its root', async () => {
  mocks.collectWorkspaceAgentServerPlugins.mockReturnValue({
    runtimePlugins: [], agentOptions: { extraTools: [], pi: {}, systemPromptAppend: undefined },
    preservedUiStateKeys: [], routeContributions: [],
  })
  mocks.getWorkspace.mockResolvedValue(null)
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'core-deleted-default-workspace-'))
  const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')
  const app = await createCoreWorkspaceAgentServer({
    config: createTestCoreConfig({ stores: 'postgres', databaseUrl: 'postgres://test' }),
    agents: REGULAR_AGENTS,
    workspaceRoot,
    serveFrontend: false,
  })
  try {
    const meta = await app.inject({
      method: 'GET',
      url: '/api/v1/workspace/meta?workspaceId=workspace-a',
      headers: { 'x-test-user-id': 'user-a' },
    })
    expect(meta.statusCode).toBe(403)
    await expect(access(join(workspaceRoot, 'workspace-a'))).rejects.toThrow()
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
    config: createBaseTestCoreConfig({ stores: 'postgres', databaseUrl: 'postgres://test' }),
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
  const config = createBaseTestCoreConfig({ stores: 'postgres', databaseUrl: 'postgres://test' })
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
    const directlyGatedRequests = [
      {
        method: 'POST' as const,
        url: '/api/v1/agents/default/sessions',
        payload: { requestId: 'blocked-create' },
      },
    ]
    for (const request of directlyGatedRequests) {
      const response = await app.inject({ ...request, headers })
      expect(response.statusCode, `${request.url}: ${response.body}`).toBe(404)
      expect(response.json(), request.url).toMatchObject({
        error: {
          code: 'AGENT_TYPE_UNKNOWN',
          details: { code: 'default_agent_type_unknown_seat' },
        },
      })
    }

    // Effects with unresolved runtime/session targets retain the canonical
    // Host ordering: target validation may reject before effect admission.
    // That is still fail-closed and does not acquire an Environment or mutate.
    const missingBindingReload = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/default/reload',
      headers,
      payload: { requestId: 'blocked-reload' },
    })
    expect(missingBindingReload.statusCode).toBe(409)
    expect(missingBindingReload.json()).toMatchObject({
      error: { code: 'AGENT_COMMAND_INVALID_STATE' },
    })

    for (const request of [
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
    ]) {
      const response = await app.inject({ ...request, headers })
      expect(response.statusCode, `${request.url}: ${response.body}`).toBe(404)
      expect(response.json(), request.url).toMatchObject({
        error: { code: 'AGENT_SESSION_NOT_FOUND' },
      })
    }

    mocks.getWorkspace.mockResolvedValue(null)
    const deletedWorkspace = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/default/sessions',
      headers,
      payload: { requestId: 'blocked-deleted-workspace' },
    })
    expect(deletedWorkspace.statusCode).toBe(403)
    expect(deletedWorkspace.json()).toMatchObject({
      error: { code: 'AGENT_SCOPE_DENIED' },
    })
    const deletedReplay = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/default/sessions',
      headers,
      payload: { requestId: 'blocked-deleted-workspace' },
    })
    expect(deletedReplay.statusCode).toBe(403)
    expect(deletedReplay.json()).toMatchObject({ error: { code: 'AGENT_SCOPE_DENIED' } })

    expect(createEnvironment).not.toHaveBeenCalled()
    expect(mocks.provisionWorkspaceRuntime).not.toHaveBeenCalled()
  } finally {
    await app.close()
  }
}, 60_000)

test('workspace meta resolves a rolling-migration NULL from the configured application default, not the first fleet seat', async () => {
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
      { agentTypeId: 'default', definition: { label: 'Agent', instructions: 'Default.' } },
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
