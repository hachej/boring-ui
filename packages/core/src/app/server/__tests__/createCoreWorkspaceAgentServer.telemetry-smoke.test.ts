import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CoreConfig } from '../../../shared/types.js'

type TelemetryRow = {
  appId: string
  eventName: string
  distinctId: string
  properties?: Record<string, unknown>
}

const dbMock = vi.hoisted(() => {
  const rows: TelemetryRow[] = []
  const values = vi.fn((row: TelemetryRow) => {
    rows.push(row)
    return Promise.resolve()
  })
  const insert = vi.fn(() => ({ values }))
  return { rows, insert, values }
})

const smokeLogs = vi.hoisted(() => ({
  entries: [] as Array<Record<string, unknown>>,
}))

vi.mock('@hachej/boring-agent/server', () => ({
  autoDetectMode: () => 'direct',
  compactPiPackages: (packages: unknown[]) => packages,
  registerAgentRoutes: async (app: { post: (path: string, handler: () => Promise<unknown>) => void }, opts: { telemetry?: { capture: (event: { name: string; distinctId?: string; properties?: Record<string, unknown> }) => void | Promise<void> } }) => {
    app.post('/__telemetry-smoke/agent-turn', async () => {
      opts.telemetry?.capture({
        name: 'agent.chat.started',
        distinctId: 'user_123',
        properties: {
          workspaceId: 'workspace_1',
          sessionId: 'session_1',
          requestId: 'request_1',
          modelProvider: 'anthropic',
          prompt: 'secret prompt must not be captured',
          rawPath: '/tmp/private-path',
          headers: { authorization: 'Bearer secret-token' },
        },
      })
      opts.telemetry?.capture({
        name: 'agent.chat.message.submitted',
        distinctId: 'user_123',
        properties: {
          workspaceId: 'workspace_1',
          sessionId: 'session_1',
          requestId: 'request_1',
          command: 'cat .env',
          stdout: 'secret command output',
        },
      })
      opts.telemetry?.capture({
        name: 'agent.tool.completed',
        distinctId: 'user_123',
        properties: {
          workspaceId: 'workspace_1',
          sessionId: 'session_1',
          toolName: 'bash',
          status: 'ok',
          durationMs: 12,
          commandOutput: 'assistant/file content must not be captured',
        },
      })
      opts.telemetry?.capture({
        name: 'agent.chat.completed',
        distinctId: 'user_123',
        properties: {
          workspaceId: 'workspace_1',
          sessionId: 'session_1',
          status: 'ok',
          durationMs: 34,
          assistantOutput: 'secret assistant output must not be captured',
        },
      })
      return { ok: true }
    })

    app.post('/__telemetry-smoke/agent-failed-turn', async () => {
      opts.telemetry?.capture({
        name: 'agent.chat.failed',
        properties: {
          workspaceId: 'workspace_1',
          sessionId: 'session_failed',
          status: 'error',
          durationMs: 5,
          errorCode: 'INTERNAL_ERROR',
          stack: 'Error: stack with /tmp/private-path and secret-token',
        },
      })
      opts.telemetry?.capture({
        name: 'agent.tool.failed',
        properties: {
          workspaceId: 'workspace_1',
          sessionId: 'session_failed',
          toolName: 'bash',
          status: 'error',
          durationMs: 6,
          errorCode: 'TOOL_EXECUTION_ERROR',
          stderr: 'secret stderr',
        },
      })
      return { ok: true }
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
    shutdownContributions: [],
  }),
  createSandboxRuntimeModeAdapter: () => ({ id: 'direct' }),
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
  sandboxRuntimeHostOperations: {},
}))

vi.mock('@hachej/boring-workspace/server', () => ({
  createBrowserBridgeAuthPolicy: () => vi.fn(),
  createInMemoryBridge: () => ({
    drainCommands: vi.fn(),
    getState: vi.fn(),
    emitUiEffect: vi.fn(),
    setState: vi.fn(),
    subscribeCommands: vi.fn(),
  }),
  createWorkspaceBridgeRegistry: () => ({
    call: vi.fn(),
    getDefinition: vi.fn(),
    registerHandler: vi.fn(),
  }),
  createWorkspaceUiTools: () => [],
  InMemoryWorkspaceBridgeIdempotencyStore: class InMemoryWorkspaceBridgeIdempotencyStore {},
  uiRoutes: async () => {},
  workspaceBridgeHttpRoutes: async () => {},
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
    db: dbMock,
    sql: { end: vi.fn() },
  }),
  PostgresUserStore: class PostgresUserStore {},
  PostgresWorkspaceStore: class PostgresWorkspaceStore {},
}))

vi.mock('../../../server/config/index.js', () => ({
  loadConfig: async () => ({
    appId: 'test-app',
    cors: { origins: ['http://localhost:3000'], credentials: true },
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
}

async function flushTelemetry(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

async function createBuiltFrontendRoot(): Promise<string> {
  const appRoot = await mkdtemp(join(tmpdir(), 'boring-core-telemetry-smoke-'))
  const frontDir = join(appRoot, 'dist', 'front')
  await mkdir(frontDir, { recursive: true })
  await writeFile(join(frontDir, 'index.html'), '<!doctype html><html><body>telemetry smoke</body></html>')
  return appRoot
}

function currentRows(): TelemetryRow[] {
  return dbMock.rows
}

function logSmoke(label: string, rows: TelemetryRow[]): Record<string, unknown> {
  const summary = {
    label,
    env: {
      enabled: process.env.BORING_TELEMETRY_ENABLED ?? '<unset>',
      sink: process.env.BORING_TELEMETRY_ENABLED === 'true' ? 'db' : 'noop',
    },
    capturedCount: rows.length,
    eventNames: rows.map((row) => row.eventName),
    distinctIdKinds: rows.map((row) => (row.distinctId === 'anonymous' ? 'anonymous' : typeof row.distinctId)),
    sanitizedPropertyKeys: rows.map((row) => Object.keys(row.properties ?? {}).sort()),
  }
  smokeLogs.entries.push(summary)
  console.info('[telemetry-smoke]', JSON.stringify(summary))
  return summary
}

function expectNoSensitiveTelemetryText(value: unknown): void {
  const serialized = JSON.stringify(value)
  expect(serialized).not.toContain('secret prompt')
  expect(serialized).not.toContain('secret assistant')
  expect(serialized).not.toContain('assistant/file content')
  expect(serialized).not.toContain('cat .env')
  expect(serialized).not.toContain('secret command output')
  expect(serialized).not.toContain('/tmp/private-path')
  expect(serialized).not.toContain('secret-token')
  expect(serialized).not.toContain('secret stderr')
}

describe('telemetry v1 env-only DB smoke', () => {
  beforeEach(() => {
    resetTelemetryEnv()
    dbMock.rows.length = 0
    dbMock.insert.mockClear()
    dbMock.values.mockClear()
    smokeLogs.entries.length = 0
  })

  afterEach(() => {
    resetTelemetryEnv()
    vi.clearAllMocks()
  })

  it('captures representative events from core-composed env setup with redacted DB rows/logs', async () => {
    process.env.BORING_TELEMETRY_ENABLED = 'true'

    const app = await createCoreWorkspaceAgentServer({
      appRoot: await createBuiltFrontendRoot(),
      serveFrontend: true,
    })
    app.get('/__telemetry-smoke/server-failure/private-path', async () => {
      throw new Error('raw server failure with /tmp/private-path and secret-token')
    })

    try {
      const shell = await app.inject({ method: 'GET', url: '/workspace/private-path?token=secret-token' })
      const chat = await app.inject({ method: 'POST', url: '/__telemetry-smoke/agent-turn' })
      const failedTurn = await app.inject({ method: 'POST', url: '/__telemetry-smoke/agent-failed-turn' })
      const serverFailure = await app.inject({ method: 'GET', url: '/__telemetry-smoke/server-failure/private-path?token=secret-token' })
      await flushTelemetry()

      expect(shell.statusCode).toBe(200)
      expect(chat.statusCode).toBe(200)
      expect(failedTurn.statusCode).toBe(200)
      expect(serverFailure.statusCode).toBe(500)

      const rows = currentRows()
      const smokeLog = logSmoke('enabled-db-core-composed', rows)

      expect(rows.map((row) => row.eventName)).toEqual(expect.arrayContaining([
        'app.opened',
        'agent.chat.started',
        'agent.chat.message.submitted',
        'agent.tool.completed',
        'agent.chat.completed',
        'agent.chat.failed',
        'agent.tool.failed',
        'server.request.failed',
      ]))
      expect(rows.every((row) => row.appId === 'test-app')).toBe(true)
      expect(rows.find((row) => row.eventName === 'agent.chat.started')?.properties).toEqual({
        workspaceId: 'workspace_1',
        sessionId: 'session_1',
        requestId: 'request_1',
        modelProvider: 'anthropic',
      })
      expect(rows.find((row) => row.eventName === 'agent.tool.completed')?.properties).toEqual({
        workspaceId: 'workspace_1',
        sessionId: 'session_1',
        toolName: 'bash',
        status: 'ok',
        durationMs: 12,
      })
      expect(smokeLog).toMatchObject({
        env: {
          enabled: 'true',
          sink: 'db',
        },
        capturedCount: rows.length,
      })
      expectNoSensitiveTelemetryText(rows)
      expectNoSensitiveTelemetryText(smokeLogs.entries)
    } finally {
      await app.close()
    }
  })

  it.each([
    ['unset', undefined],
    ['false', 'false'],
  ])('captures zero events when telemetry is %s', async (_label, enabled) => {
    if (enabled) process.env.BORING_TELEMETRY_ENABLED = enabled

    const app = await createCoreWorkspaceAgentServer({
      appRoot: await createBuiltFrontendRoot(),
      serveFrontend: true,
    })

    try {
      await app.inject({ method: 'GET', url: '/' })
      await app.inject({ method: 'POST', url: '/__telemetry-smoke/agent-turn' })
      await flushTelemetry()

      const rows = currentRows()
      const smokeLog = logSmoke(`disabled-${enabled ?? 'unset'}`, rows)

      expect(rows).toHaveLength(0)
      expect(smokeLog).toMatchObject({
        env: {
          enabled: enabled ?? '<unset>',
          sink: 'noop',
        },
        capturedCount: 0,
        eventNames: [],
      })
      expectNoSensitiveTelemetryText(smokeLogs.entries)
    } finally {
      await app.close()
    }
  })
})
