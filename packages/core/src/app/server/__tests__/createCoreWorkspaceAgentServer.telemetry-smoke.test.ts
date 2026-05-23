import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CoreConfig } from '../../../shared/types.js'

type CapturePayload = {
  distinctId: string
  event: string
  properties?: Record<string, unknown>
}

const posthogMock = vi.hoisted(() => {
  type MockPostHogClient = {
    captures: CapturePayload[]
    capture: ReturnType<typeof vi.fn>
    shutdown: ReturnType<typeof vi.fn>
  }

  const clients: MockPostHogClient[] = []
  const PostHog = vi.fn((_apiKey: string, _options?: Record<string, unknown>) => {
    const client: MockPostHogClient = {
      captures: [],
      capture: vi.fn((payload: CapturePayload) => {
        client.captures.push(payload)
      }),
      shutdown: vi.fn(),
    }
    clients.push(client)
    return client
  })

  return { clients, PostHog }
})

const smokeLogs = vi.hoisted(() => ({
  entries: [] as Array<Record<string, unknown>>,
}))

vi.mock('posthog-node', () => ({
  PostHog: posthogMock.PostHog,
}))

vi.mock('@hachej/boring-agent/server', () => ({
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

async function createBuiltFrontendRoot(): Promise<string> {
  const appRoot = await mkdtemp(join(tmpdir(), 'boring-core-telemetry-smoke-'))
  const frontDir = join(appRoot, 'dist', 'front')
  await mkdir(frontDir, { recursive: true })
  await writeFile(join(frontDir, 'index.html'), '<!doctype html><html><body>telemetry smoke</body></html>')
  return appRoot
}

function currentCaptures(): CapturePayload[] {
  return posthogMock.clients.flatMap((client) => client.captures)
}

function logSmoke(label: string, captures: CapturePayload[]): Record<string, unknown> {
  const summary = {
    label,
    env: {
      enabled: process.env.BORING_TELEMETRY_ENABLED ?? '<unset>',
      hasPostHogKey: Boolean(process.env.POSTHOG_KEY),
      host: process.env.POSTHOG_HOST ?? '<default>',
      project: process.env.BORING_TELEMETRY_PROJECT ?? '<unset>',
    },
    capturedCount: captures.length,
    eventNames: captures.map((capture) => capture.event),
    distinctIdKinds: captures.map((capture) => (capture.distinctId === 'anonymous' ? 'anonymous' : typeof capture.distinctId)),
    sanitizedPropertyKeys: captures.map((capture) => Object.keys(capture.properties ?? {}).sort()),
  }
  smokeLogs.entries.push(summary)
  console.info('[telemetry-smoke]', JSON.stringify(summary))
  return summary
}

function expectNoSensitiveTelemetryText(value: unknown): void {
  const serialized = JSON.stringify(value)
  expect(serialized).not.toContain('phc_never_log_secret')
  expect(serialized).not.toContain('secret prompt')
  expect(serialized).not.toContain('secret assistant')
  expect(serialized).not.toContain('assistant/file content')
  expect(serialized).not.toContain('cat .env')
  expect(serialized).not.toContain('secret command output')
  expect(serialized).not.toContain('/tmp/private-path')
  expect(serialized).not.toContain('secret-token')
  expect(serialized).not.toContain('secret stderr')
  expect(serialized).not.toContain('POSTHOG_KEY')
}

describe('telemetry v1 env-only e2e smoke', () => {
  beforeEach(() => {
    resetTelemetryEnv()
    posthogMock.clients.length = 0
    posthogMock.PostHog.mockClear()
    smokeLogs.entries.length = 0
  })

  afterEach(() => {
    resetTelemetryEnv()
    vi.clearAllMocks()
  })

  it('captures prefixed representative events from core-composed env setup with redacted logs', async () => {
    process.env.BORING_TELEMETRY_ENABLED = 'true'
    process.env.POSTHOG_KEY = 'phc_never_log_secret'
    process.env.POSTHOG_HOST = 'https://eu.i.posthog.com'
    process.env.BORING_TELEMETRY_PROJECT = 'full-app'

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

      expect(shell.statusCode).toBe(200)
      expect(chat.statusCode).toBe(200)
      expect(failedTurn.statusCode).toBe(200)
      expect(serverFailure.statusCode).toBe(500)

      const captures = currentCaptures()
      const smokeLog = logSmoke('enabled-prefixed-core-composed', captures)

      expect(posthogMock.PostHog).toHaveBeenCalledWith('phc_never_log_secret', {
        host: 'https://eu.i.posthog.com',
      })
      expect(captures.map((capture) => capture.event)).toEqual(expect.arrayContaining([
        'full-app.app.opened',
        'full-app.agent.chat.started',
        'full-app.agent.chat.message.submitted',
        'full-app.agent.tool.completed',
        'full-app.agent.chat.completed',
        'full-app.agent.chat.failed',
        'full-app.agent.tool.failed',
        'full-app.server.request.failed',
      ]))
      expect(captures.every((capture) => capture.event.startsWith('full-app.'))).toBe(true)
      expect(captures.every((capture) => capture.properties?.boringProject === 'full-app')).toBe(true)
      expect(captures.map((capture) => capture.properties?.eventName)).toEqual(expect.arrayContaining([
        'app.opened',
        'agent.chat.started',
        'agent.chat.message.submitted',
        'agent.tool.completed',
        'agent.chat.completed',
        'agent.chat.failed',
        'agent.tool.failed',
        'server.request.failed',
      ]))
      expect(captures.find((capture) => capture.event === 'full-app.agent.chat.started')?.properties).toEqual({
        workspaceId: 'workspace_1',
        sessionId: 'session_1',
        requestId: 'request_1',
        modelProvider: 'anthropic',
        boringProject: 'full-app',
        eventName: 'agent.chat.started',
      })
      expect(captures.find((capture) => capture.event === 'full-app.agent.tool.completed')?.properties).toEqual({
        workspaceId: 'workspace_1',
        sessionId: 'session_1',
        toolName: 'bash',
        status: 'ok',
        durationMs: 12,
        boringProject: 'full-app',
        eventName: 'agent.tool.completed',
      })
      expect(smokeLog).toMatchObject({
        env: {
          enabled: 'true',
          hasPostHogKey: true,
          host: 'https://eu.i.posthog.com',
          project: 'full-app',
        },
        capturedCount: captures.length,
      })
      expectNoSensitiveTelemetryText(captures)
      expectNoSensitiveTelemetryText(smokeLogs.entries)
    } finally {
      await app.close()
    }
  })

  it.each([
    ['unset', undefined],
    ['false', 'false'],
  ])('captures zero events when telemetry is %s even if POSTHOG_KEY is present', async (_label, enabled) => {
    if (enabled) process.env.BORING_TELEMETRY_ENABLED = enabled
    process.env.POSTHOG_KEY = 'phc_never_log_secret'
    process.env.BORING_TELEMETRY_PROJECT = 'full-app'

    const app = await createCoreWorkspaceAgentServer({
      appRoot: await createBuiltFrontendRoot(),
      serveFrontend: true,
    })

    try {
      await app.inject({ method: 'GET', url: '/' })
      await app.inject({ method: 'POST', url: '/__telemetry-smoke/agent-turn' })

      const captures = currentCaptures()
      const smokeLog = logSmoke(`disabled-${enabled ?? 'unset'}`, captures)

      expect(posthogMock.PostHog).not.toHaveBeenCalled()
      expect(captures).toHaveLength(0)
      expect(smokeLog).toMatchObject({
        env: {
          enabled: enabled ?? '<unset>',
          hasPostHogKey: true,
          project: 'full-app',
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
