import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TelemetrySink } from '../../../shared/telemetry.js'
import type { CoreConfig } from '../../../shared/types.js'

const posthogMock = vi.hoisted(() => {
  type MockPostHogClient = {
    capture: ReturnType<typeof vi.fn>
    shutdown: ReturnType<typeof vi.fn>
  }

  const clients: MockPostHogClient[] = []
  const PostHog = vi.fn(() => {
    const client = {
      capture: vi.fn(),
      shutdown: vi.fn(),
    }
    clients.push(client)
    return client
  })

  return { clients, PostHog }
})

const agentMock = vi.hoisted(() => ({
  registerOptions: [] as Array<Record<string, unknown>>,
}))

const coreAppMock = vi.hoisted(() => ({
  debugLogs: [] as unknown[][],
}))

vi.mock('posthog-node', () => ({
  PostHog: posthogMock.PostHog,
}))

vi.mock('@hachej/boring-agent/server', () => ({
  compactPiPackages: (packages: unknown[]) => packages,
  registerAgentRoutes: async (_app: unknown, opts: Record<string, unknown>) => {
    agentMock.registerOptions.push(opts)
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
  createInMemoryBridge: () => ({
    drainCommands: vi.fn(),
    getState: vi.fn(),
    postCommand: vi.fn(),
    setState: vi.fn(),
    subscribeCommands: vi.fn(),
  }),
  createWorkspaceUiTools: () => [],
  uiRoutes: async () => {},
}))

vi.mock('../../../server/auth/index.js', () => ({
  authHook: async () => {},
  createAuth: () => ({
    handler: vi.fn(),
  }),
}))

vi.mock('../../../server/app/index.js', () => ({
  createCoreApp: async (config: CoreConfig) => {
    const app = Fastify({ logger: false })
    app.decorate('config', config)
    app.log.debug = (...args: unknown[]) => {
      coreAppMock.debugLogs.push(args)
    }
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
  PostgresWorkspaceStore: class PostgresWorkspaceStore {},
}))

vi.mock('../../../server/config/index.js', () => ({
  loadConfig: async () => ({
    auth: { url: 'http://localhost:3000' },
    encryption: { workspaceSettingsKey: 'test-key' },
    stores: 'postgres',
  }),
}))

vi.mock('../../../server/runtime/index.js', () => ({
  WorkspaceRuntimeSandboxHandleStore: class WorkspaceRuntimeSandboxHandleStore {},
}))

const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')

function resetTelemetryEnv(): void {
  delete process.env.BORING_TELEMETRY_ENABLED
  delete process.env.POSTHOG_KEY
  delete process.env.POSTHOG_HOST
  delete process.env.BORING_TELEMETRY_PROJECT
}

describe('createCoreWorkspaceAgentServer telemetry wiring', () => {
  beforeEach(() => {
    resetTelemetryEnv()
    agentMock.registerOptions.length = 0
    coreAppMock.debugLogs.length = 0
    posthogMock.clients.length = 0
    posthogMock.PostHog.mockClear()
  })

  afterEach(() => {
    resetTelemetryEnv()
    vi.clearAllMocks()
  })

  it('uses the core PostHog env helper by default and passes the sink to agent routes', async () => {
    process.env.BORING_TELEMETRY_ENABLED = 'true'
    process.env.POSTHOG_KEY = 'phc_redacted_test_key'
    process.env.BORING_TELEMETRY_PROJECT = 'full-app'

    const app = await createCoreWorkspaceAgentServer({ serveFrontend: false })
    try {
      const telemetry = agentMock.registerOptions[0]?.telemetry as TelemetrySink | undefined
      telemetry?.capture({
        name: 'agent.chat.started',
        properties: { workspaceId: 'workspace_1', prompt: 'do not send' },
      })

      expect(agentMock.registerOptions, 'agent routes should be registered once').toHaveLength(1)
      expect(telemetry, 'resolved telemetry sink should be passed to agent routes').toBeDefined()
      expect(posthogMock.PostHog, 'enabled env should construct PostHog from the core helper').toHaveBeenCalledOnce()
      expect(posthogMock.clients[0]?.capture).toHaveBeenCalledWith({
        distinctId: 'anonymous',
        event: 'full-app.agent.chat.started',
        properties: {
          workspaceId: 'workspace_1',
          boringProject: 'full-app',
          eventName: 'agent.chat.started',
        },
      })
      expect(coreAppMock.debugLogs).toContainEqual([
        { telemetry: { source: 'posthog-env' } },
        'resolved telemetry sink',
      ])
    } finally {
      await app.close()
    }
  })

  it('lets a custom telemetry sink override env helper creation', async () => {
    process.env.BORING_TELEMETRY_ENABLED = 'true'
    process.env.POSTHOG_KEY = 'phc_redacted_test_key'
    const customTelemetry: TelemetrySink = { capture: vi.fn() }

    const app = await createCoreWorkspaceAgentServer({
      serveFrontend: false,
      telemetry: customTelemetry,
    })
    try {
      expect(agentMock.registerOptions[0]?.telemetry).toBe(customTelemetry)
      expect(posthogMock.PostHog, 'custom sink should bypass PostHog env helper').not.toHaveBeenCalled()
      expect(coreAppMock.debugLogs).toContainEqual([
        { telemetry: { source: 'custom' } },
        'resolved telemetry sink',
      ])
    } finally {
      await app.close()
    }
  })

  it('passes noop telemetry when env telemetry is disabled', async () => {
    process.env.POSTHOG_KEY = 'phc_redacted_test_key'

    const app = await createCoreWorkspaceAgentServer({ serveFrontend: false })
    try {
      const telemetry = agentMock.registerOptions[0]?.telemetry as TelemetrySink | undefined
      telemetry?.capture({ name: 'app.opened' })

      expect(telemetry, 'disabled env still passes a safe noop sink').toBeDefined()
      expect(posthogMock.PostHog, 'POSTHOG_KEY alone must not construct PostHog').not.toHaveBeenCalled()
      expect(posthogMock.clients[0]?.capture).toBeUndefined()
      expect(coreAppMock.debugLogs).toContainEqual([
        { telemetry: { source: 'noop-env' } },
        'resolved telemetry sink',
      ])
    } finally {
      await app.close()
    }
  })
})
