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
  resolveDefaultWorkspacePluginPackagePaths: () => [],
  resolveOnePluginEntry: async (entry: unknown) => entry,
}))

vi.mock('@hachej/boring-workspace/server', () => ({
  createBrowserBridgeAuthPolicy: vi.fn((opts: Record<string, unknown>) => {
    workspaceServerMock.browserAuthPolicyOptions.push(opts)
    return vi.fn()
  }),
  createHumanInputBridgeHandlers: () => [],
  createInMemoryBridge: () => ({
    drainCommands: vi.fn(),
    getState: vi.fn(),
    emitUiEffect: vi.fn(),
    setState: vi.fn(),
    subscribeCommands: vi.fn(),
  }),
  createWorkspaceBridgeRegistry: () => {
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
  InMemoryPendingQuestionStore: class InMemoryPendingQuestionStore {
    async getPending() {
      return null
    }
  },
  InMemoryWorkspaceBridgeIdempotencyStore: class InMemoryWorkspaceBridgeIdempotencyStore {},
  PendingQuestionRuntime: class PendingQuestionRuntime {
    abandonServerRestart = vi.fn()
  },
  uiRoutes: async () => {},
  verifyWorkspaceBridgeRuntimeToken: vi.fn((token: string) => {
    workspaceServerMock.runtimeTokenVerifications.push(token)
    return { authContext: { workspaceId: 'workspace-1' } }
  }),
  workspaceBridgeHttpRoutes: async (_app: unknown, opts: Record<string, unknown>) => {
    workspaceServerMock.httpRouteOpts.push(opts)
  },
}))

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
        ;(request as typeof request & { user?: { id: string; email?: string; name?: string | null } }).user = {
          id: userId,
          email: `${userId}@example.test`,
          name: userId,
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
})

describe('createCoreWorkspaceAgentServer workspace bridge wiring', () => {
  it('wires runtime env contributions and runtime token auth into the core host', async () => {
    const app = await createCoreWorkspaceAgentServer({
      serveFrontend: false,
      workspaceBridge: {
        runtimeTokenSecret: '12345678901234567890123456789012',
        runtimeEnv: {
          bridgeUrl: 'https://bridge.test',
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
      runtimeEnv: { bridgeUrl: 'https://bridge.test' },
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
            auditCategory: 'test',
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
