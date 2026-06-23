import type { ExtensionAPI, ExtensionFactory, ToolDefinition } from '@mariozechner/pi-coding-agent'
import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'

const agentServerMock = vi.hoisted(() => ({
  registerOpts: [] as Array<Record<string, unknown>>,
}))

const workspaceServerMock = vi.hoisted(() => ({
  browserAuthPolicyOptions: [] as Array<Record<string, unknown>>,
  runtimeEnvCalls: [] as Array<Record<string, unknown>>,
  httpRouteOpts: [] as Array<Record<string, unknown>>,
  runtimeTokenVerifications: [] as string[],
  idempotencyCalls: [] as Array<Record<string, unknown>>,
}))

vi.mock('@hachej/boring-agent/server', () => ({
  compactPiPackages: (packages: unknown[]) => packages,
  registerAgentRoutes: async (app: any, opts: Record<string, unknown>) => {
    agentServerMock.registerOpts.push(opts)
    app.post('/api/v1/agent/chat', async () => ({ ok: true }))
    app.get('/api/v1/agent/chat/:sessionId/messages', async () => ({ ok: true }))
    app.get('/__bridge-owner/:sessionId', async (request: any) => {
      const tools = await (opts.getExtraTools as Function)?.({
        workspaceId: String(request.headers['x-boring-workspace-id'] ?? 'default'),
        workspaceRoot: '/tmp/workspace',
        runtimeMode: 'direct',
        workspaceFsCapability: 'strong',
      })
      const tool = tools?.[0]
      if (!tool) return { ownerId: null }
      return await tool.execute({}, {
        abortSignal: new AbortController().signal,
        toolCallId: 'tool-call-1',
        sessionId: (request.params as { sessionId: string }).sessionId,
      })
    })
  },
}))

vi.mock('@hachej/boring-workspace/app/server', () => ({
  collectWorkspaceAgentServerPlugins: () => ({
    agentOptions: {
      extraTools: [],
      pi: undefined,
      systemPromptAppend: undefined,
    },
    preservedUiStateKeys: [],
    provisioningContributions: [],
    routeContributions: [],
  }),
  hasDirServerPlugin: () => false,
  provisionWorkspaceAgentServer: vi.fn(),
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

vi.mock('@hachej/boring-workspace/server', () => {
  const makeRegistry = () => {
    const handlers = new Map<string, { definition: Record<string, unknown>; handler: (args: Record<string, unknown>) => unknown | Promise<unknown> }>()
    return {
      registerHandler: vi.fn((definition: Record<string, unknown>, handler: (args: Record<string, unknown>) => unknown | Promise<unknown>) => {
        handlers.set(String(definition.op), { definition, handler })
      }),
      getDefinition: vi.fn((op: string) => handlers.get(op)?.definition),
      call: vi.fn(async (request: { op: string; input: unknown }, context: Record<string, unknown>) => {
        const registered = handlers.get(request.op)
        if (!registered) return { ok: false, error: { code: 'BRIDGE_OP_NOT_FOUND' } }
        return {
          ok: true,
          op: request.op,
          requestId: 'req-1',
          output: await registered.handler({ input: request.input, context }),
        }
      }),
    }
  }
  return {
  createBrowserBridgeAuthPolicy: vi.fn((opts: Record<string, unknown>) => {
    workspaceServerMock.browserAuthPolicyOptions.push(opts)
    return vi.fn()
  }),
  createInMemoryBridge: () => ({
    drainCommands: vi.fn(),
    getState: vi.fn(),
    emitUiEffect: vi.fn(),
    setState: vi.fn(),
    subscribeCommands: vi.fn(),
  }),
  createWorkspaceBridgeRuntimeCore: (opts?: { handlers?: ReadonlyArray<{ definition: Record<string, unknown>; handler: (args: Record<string, unknown>) => unknown | Promise<unknown> }> }) => {
    const registry = makeRegistry()
    for (const entry of opts?.handlers ?? []) {
      registry.registerHandler(entry.definition, entry.handler)
    }
    return { registry }
  },
  createWorkspaceBridgeRuntimeEnvContribution: vi.fn((opts: Record<string, unknown>) => {
    workspaceServerMock.runtimeEnvCalls.push(opts)
    return {
      id: 'workspace-bridge-runtime-env',
      getEnv: () => ({
        BORING_WORKSPACE_BRIDGE_URL: 'https://bridge.test/api/v1/workspace-bridge/call',
        BORING_WORKSPACE_BRIDGE_TOKEN: 'runtime-token',
        BORING_WORKSPACE_ID: opts.workspaceId,
      }),
    }
  }),
  createWorkspaceUiTools: () => [],
  runWithWorkspaceBridgeIdempotency: vi.fn(async (_store: unknown, options: Record<string, any>, execute: () => Promise<unknown>) => {
    workspaceServerMock.idempotencyCalls.push(options)
    if (options.definition?.idempotencyPolicy === 'required' && !options.request?.idempotencyKey) {
      return {
        ok: false,
        op: options.request?.op ?? options.definition?.op,
        requestId: options.request?.requestId,
        error: { code: 'BRIDGE_IDEMPOTENCY_REQUIRED', message: 'WorkspaceBridge operation requires an idempotency key' },
      }
    }
    return await execute()
  }),
  InMemoryWorkspaceBridgeIdempotencyStore: class InMemoryWorkspaceBridgeIdempotencyStore {},
  InMemoryWorkspaceBridgeRuntimeRefreshTokenStore: class InMemoryWorkspaceBridgeRuntimeRefreshTokenStore {},
  uiRoutes: async () => {},
  verifyWorkspaceBridgeRuntimeToken: vi.fn((token: string) => {
    workspaceServerMock.runtimeTokenVerifications.push(token)
    return { authContext: { workspaceId: 'workspace-1' } }
  }),
  workspaceBridgeHttpRoutes: async (_app: unknown, opts: Record<string, unknown>) => {
    workspaceServerMock.httpRouteOpts.push(opts)
  },
  }
})

vi.mock('../../../server/auth/index.js', () => ({
  authHook: async () => {},
  createAuth: () => ({
    handler: vi.fn(),
  }),
}))

vi.mock('../../../server/app/index.js', () => ({
  createCoreApp: async (config: Record<string, unknown>) => {
    const app = Fastify({ logger: false })
    app.decorate('config', config as any)
    app.addHook('preHandler', async (request) => {
      const userId = request.headers['x-test-user-id']
      if (typeof userId === 'string' && userId.length > 0) {
        ;(request as typeof request & { user?: { id: string; email: string; name: string | null; emailVerified: boolean } }).user = {
          id: userId,
          email: `${userId}@example.test`,
          name: userId,
          emailVerified: true,
        }
      }
    })
    return app
  },
  registerRoutes: async () => {},
}))

vi.mock('../../../server/routes/index.js', () => ({
  registerInviteRoutes: async () => {},
  registerMemberRoutes: async () => {},
  registerSettingsRoutes: async () => {},
  registerWorkspaceRoutes: async () => {},
}))

vi.mock('../../../server/db/index.js', () => ({
  createDatabase: () => ({
    db: {},
    sql: { end: vi.fn() },
  }),
  PostgresUserStore: class PostgresUserStore {},
  PostgresWorkspaceStore: class PostgresWorkspaceStore {
    async isMember() {
      return true
    }
  },
}))

vi.mock('../../../server/config/index.js', () => ({
  loadConfig: async () => ({
    auth: { url: 'http://localhost:3000' },
    cors: { origins: ['https://app.example.test'] },
    encryption: { workspaceSettingsKey: 'test-key' },
    stores: 'postgres',
  }),
}))

vi.mock('../../../server/runtime/index.js', () => ({
  WorkspaceRuntimeSandboxHandleStore: class WorkspaceRuntimeSandboxHandleStore {},
}))

const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')

afterEach(() => {
  agentServerMock.registerOpts.length = 0
  workspaceServerMock.browserAuthPolicyOptions.length = 0
  workspaceServerMock.runtimeEnvCalls.length = 0
  workspaceServerMock.httpRouteOpts.length = 0
  workspaceServerMock.runtimeTokenVerifications.length = 0
  workspaceServerMock.idempotencyCalls.length = 0
})

describe('createCoreWorkspaceAgentServer workspace bridge wiring', () => {
  it('wires runtime env contributions and runtime token auth into the core host', async () => {
    const app = await createCoreWorkspaceAgentServer({
      serveFrontend: false,
      workspaceBridge: {
        runtimeTokenSecret: '12345678901234567890123456789012',
        runtimeEnv: {
          bridgeUrl: 'https://bridge.test',
          capabilities: ['test:runtime-env'],
        },
      },
    })

    const registerOpts = agentServerMock.registerOpts.at(-1)
    const contribution = (registerOpts?.runtimeEnvContributions as Array<{ id: string; getEnv: (ctx: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown> }> | undefined)
      ?.find((entry) => entry.id === 'workspace-bridge-runtime-env')
    expect(contribution).toBeTruthy()

    const env = await contribution!.getEnv({
      workspaceId: 'workspace-1',
      workspaceRoot: '/tmp/workspace-1',
      runtimeMode: 'direct',
      runtimeBundle: {},
    })

    expect(env).toMatchObject({
      BORING_WORKSPACE_BRIDGE_URL: 'https://bridge.test/api/v1/workspace-bridge/call',
      BORING_WORKSPACE_BRIDGE_TOKEN: 'runtime-token',
      BORING_WORKSPACE_ID: 'workspace-1',
    })
    expect(workspaceServerMock.runtimeEnvCalls.at(-1)).toMatchObject({
      workspaceId: 'workspace-1',
      runtimeMode: 'direct',
      runtimeTokenSecret: '12345678901234567890123456789012',
      runtimeEnv: { bridgeUrl: 'https://bridge.test', capabilities: ['test:runtime-env'] },
    })
    expect(workspaceServerMock.httpRouteOpts.at(-1)).toMatchObject({
      runtimeTokenSecret: '12345678901234567890123456789012',
    })
    expect(workspaceServerMock.browserAuthPolicyOptions.at(-1)).toMatchObject({
      allowedOrigins: ['https://app.example.test'],
      requireCsrfHeader: true,
    })
    const registry = await (workspaceServerMock.httpRouteOpts.at(-1)?.getRegistry as Function)?.({
      headers: { authorization: 'Bearer runtime-token' },
    }, { op: 'test.v1.runtime-env', input: {} })
    expect(registry).toBeTruthy()
    expect(workspaceServerMock.runtimeTokenVerifications).toContain('runtime-token')

    await app.close()
  })

  it('wires the runtime refresh-token secret and a per-workspace refresh-token store into the core host', async () => {
    const app = await createCoreWorkspaceAgentServer({
      serveFrontend: false,
      workspaceBridge: {
        runtimeTokenSecret: '12345678901234567890123456789012',
        runtimeRefreshTokenSecret: 'refresh-secret-1234567890123456789012',
        runtimeEnv: {
          bridgeUrl: 'https://bridge.test',
          capabilities: ['test:runtime-env'],
        },
      },
    })

    const httpOpts = workspaceServerMock.httpRouteOpts.at(-1)
    expect(httpOpts).toMatchObject({
      runtimeTokenSecret: '12345678901234567890123456789012',
      runtimeRefreshTokenSecret: 'refresh-secret-1234567890123456789012',
    })

    const getStore = httpOpts?.getRuntimeRefreshTokenStore as
      | ((request: unknown, claims: { workspaceId: string }) => unknown)
      | undefined
    expect(typeof getStore).toBe('function')
    const storeOne = getStore!({ headers: {} }, { workspaceId: 'workspace-1' })
    const storeTwo = getStore!({ headers: {} }, { workspaceId: 'workspace-2' })
    const storeOneAgain = getStore!({ headers: {} }, { workspaceId: 'workspace-1' })
    expect(storeOne).toBeTruthy()
    expect(storeTwo).toBeTruthy()
    // Per-workspace isolation: distinct workspaces get distinct stores...
    expect(storeOne).not.toBe(storeTwo)
    // ...and the same workspace reuses one store (revoke/rate-limit state persists).
    expect(storeOne).toBe(storeOneAgain)

    await app.close()
  })

  it('exposes bridge-aware Pi context so app shells do not need adapter tools', async () => {
    const app = await createCoreWorkspaceAgentServer({
      serveFrontend: false,
      workspaceBridge: {
        handlers: [{
          definition: {
            op: 'test.v1.owner',
            version: 1,
            owner: 'test',
            callerClassesAllowed: ['runtime'],
            requiredCapabilities: ['test:owner.read'],
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
            timeoutMs: 1_000,
            maxInputBytes: 1024,
            maxOutputBytes: 1024,
            idempotencyPolicy: 'none',
          },
          handler: ({ context }: { context: { actor?: { onBehalfOf?: { id?: string } } } }) => ({ ownerId: context.actor?.onBehalfOf?.id ?? null }),
        }],
      },
      getWorkspaceBridgePi: (ctx) => ({
        extensionFactories: [((pi: ExtensionAPI) => {
          pi.registerTool({
            name: 'test-owner',
            label: 'test owner',
            description: 'test owner bridge tool',
            parameters: { type: 'object', properties: {} },
            async execute(_toolCallId, _params, _signal, _onUpdate, toolCtx) {
              const response = await ctx.callAsRuntime<{ ownerId: string | null }>({ op: 'test.v1.owner', input: {} }, {
                sessionId: toolCtx.sessionManager.getSessionId(),
              })
              return { content: [{ type: 'text', text: JSON.stringify(response) }], details: response }
            },
          })
        }) satisfies ExtensionFactory],
      }),
    })

    await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      headers: { 'content-type': 'application/json', 'x-boring-workspace-id': 'workspace-1', 'x-test-user-id': 'user-1' },
      payload: { sessionId: 'session-1', message: 'hi' },
    })
    await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      headers: { 'content-type': 'application/json', 'x-boring-workspace-id': 'workspace-1', 'x-test-user-id': 'user-2' },
      payload: { sessionId: 'session-1', message: 'hi again' },
    })

    const registerOpts = agentServerMock.registerOpts.at(-1)
    const piOptions = await (registerOpts?.getPi as Function)?.({
      workspaceId: 'workspace-1',
      workspaceRoot: '/tmp/workspace',
    })
    const tools: ToolDefinition[] = []
    await piOptions.extensionFactories[0]({ registerTool: (tool: ToolDefinition) => tools.push(tool) } as unknown as ExtensionAPI)

    await expect(tools[0]?.execute('tool-call-1', {}, undefined, undefined, {
      sessionManager: { getSessionId: () => 'session-1' },
    } as never)).resolves.toMatchObject({
      details: {
        ok: true,
        output: { ownerId: 'user-2' },
      },
    })
    await app.close()
  })

  it('routes bridge-aware Pi runtime calls through idempotency enforcement', async () => {
    const app = await createCoreWorkspaceAgentServer({
      serveFrontend: false,
      workspaceBridge: {
        handlers: [{
          definition: {
            op: 'test.v1.persist',
            version: 1,
            owner: 'test',
            callerClassesAllowed: ['runtime'],
            requiredCapabilities: ['test:persist'],
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
            timeoutMs: 1_000,
            maxInputBytes: 1024,
            maxOutputBytes: 1024,
            idempotencyPolicy: 'required',
          },
          handler: () => ({ persisted: true }),
        }],
      },
      getWorkspaceBridgePi: (ctx) => ({
        extensionFactories: [((pi: ExtensionAPI) => {
          pi.registerTool({
            name: 'test-persist',
            label: 'test persist',
            description: 'test persist bridge tool',
            parameters: { type: 'object', properties: {} },
            async execute() {
              return {
                details: await ctx.callAsRuntime({ op: 'test.v1.persist', input: {} }),
                content: [{ type: 'text', text: 'ok' }],
              }
            },
          })
        }) satisfies ExtensionFactory],
      }),
    })

    const registerOpts = agentServerMock.registerOpts.at(-1)
    const piOptions = await (registerOpts?.getPi as Function)?.({
      workspaceId: 'workspace-1',
      workspaceRoot: '/tmp/workspace',
    })
    const tools: ToolDefinition[] = []
    await piOptions.extensionFactories[0]({ registerTool: (tool: ToolDefinition) => tools.push(tool) } as unknown as ExtensionAPI)

    await expect(tools[0]?.execute('tool-call-1', {}, undefined, undefined, {} as never)).resolves.toMatchObject({
      details: { ok: false, error: { code: 'BRIDGE_IDEMPOTENCY_REQUIRED' } },
    })
    expect(workspaceServerMock.idempotencyCalls.at(-1)).toMatchObject({
      definition: { op: 'test.v1.persist', idempotencyPolicy: 'required' },
      request: { op: 'test.v1.persist', input: {} },
      auth: { workspaceId: 'workspace-1' },
    })
    await app.close()
  })

  it('ignores read-only session hydration and lets the latest sender own future runtime bridge requests', async () => {
    const app = await createCoreWorkspaceAgentServer({
      serveFrontend: false,
      workspaceBridge: {
        handlers: [{
          definition: {
            op: 'test.v1.owner',
            version: 1,
            owner: 'test',
            callerClassesAllowed: ['runtime'],
            requiredCapabilities: ['test:owner.read'],
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
            timeoutMs: 1_000,
            maxInputBytes: 1024,
            maxOutputBytes: 1024,
            idempotencyPolicy: 'none',
          },
          handler: ({ context }: { context: { actor?: { onBehalfOf?: { id?: string } } } }) => ({ ownerId: context.actor?.onBehalfOf?.id ?? null }),
        }],
      },
      getWorkspaceBridgeExtraTools: (ctx) => [{
        name: 'test-owner',
        description: 'test owner bridge tool',
        parameters: {},
        async execute(_params, toolCtx) {
          const response = await ctx.callAsRuntime<{ ownerId: string | null }>({ op: 'test.v1.owner', input: {} }, { sessionId: toolCtx.sessionId })
          return { content: [{ type: 'text', text: JSON.stringify(response) }], details: response }
        },
      }],
    })

    await app.inject({
      method: 'GET',
      url: '/api/v1/agent/chat/session-1/messages',
      headers: { 'x-boring-workspace-id': 'workspace-1', 'x-test-user-id': 'user-2' },
    })
    await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      headers: { 'content-type': 'application/json', 'x-boring-workspace-id': 'workspace-1', 'x-test-user-id': 'user-1' },
      payload: { sessionId: 'session-1', message: 'hi' },
    })
    await app.inject({
      method: 'POST',
      url: '/api/v1/agent/chat',
      headers: { 'content-type': 'application/json', 'x-boring-workspace-id': 'workspace-1', 'x-test-user-id': 'user-2' },
      payload: { sessionId: 'session-1', message: 'hi again' },
    })

    const owner = await app.inject({
      method: 'GET',
      url: '/__bridge-owner/session-1',
      headers: { 'x-boring-workspace-id': 'workspace-1' },
    })

    expect(owner.json()).toMatchObject({
      details: {
        ok: true,
        output: { ownerId: 'user-2' },
      },
    })
    await app.close()
  })
})
