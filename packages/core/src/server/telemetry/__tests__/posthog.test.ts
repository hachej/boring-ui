import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const posthogMock = vi.hoisted(() => {
  type MockPostHogClient = {
    apiKey: string
    options: Record<string, unknown> | undefined
    capture: ReturnType<typeof vi.fn>
    shutdown: ReturnType<typeof vi.fn>
  }

  const clients: MockPostHogClient[] = []
  const PostHog = vi.fn(function MockPostHog(
    this: MockPostHogClient,
    apiKey: string,
    options?: Record<string, unknown>,
  ) {
    const client: MockPostHogClient = {
      apiKey,
      options,
      capture: vi.fn(),
      shutdown: vi.fn(),
    }
    clients.push(client)
    return client
  })

  return { clients, PostHog }
})

vi.mock('posthog-node', () => ({
  PostHog: posthogMock.PostHog,
}))

import {
  createPostHogTelemetryFromEnv,
  parseTelemetryProject,
  sanitizeTelemetryDistinctId,
  sanitizeTelemetryProperties,
} from '../posthog'

function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { ...overrides }
}

describe('createPostHogTelemetryFromEnv', () => {
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    posthogMock.clients.length = 0
    posthogMock.PostHog.mockClear()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses noop telemetry when BORING_TELEMETRY_ENABLED is unset', () => {
    const telemetry = createPostHogTelemetryFromEnv(env({ POSTHOG_KEY: 'phc_secret' }))

    telemetry.capture({ name: 'app.opened' })

    expect(posthogMock.PostHog, 'POSTHOG_KEY alone must not construct PostHog').not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('uses noop telemetry when BORING_TELEMETRY_ENABLED is false', () => {
    const telemetry = createPostHogTelemetryFromEnv(
      env({ BORING_TELEMETRY_ENABLED: 'false', POSTHOG_KEY: 'phc_secret' }),
    )

    telemetry.capture({ name: 'app.opened' })

    expect(posthogMock.PostHog).not.toHaveBeenCalled()
  })

  it('uses noop telemetry and warns without secrets when enabled but POSTHOG_KEY is missing', () => {
    const telemetry = createPostHogTelemetryFromEnv(env({ BORING_TELEMETRY_ENABLED: 'true' }))

    telemetry.capture({ name: 'app.opened' })

    expect(posthogMock.PostHog).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0]?.[0])).toContain('POSTHOG_KEY is missing')
    expect(String(warn.mock.calls[0]?.[0])).not.toContain('phc_')
  })

  it('constructs PostHog with the default host when enabled', () => {
    const telemetry = createPostHogTelemetryFromEnv(
      env({ BORING_TELEMETRY_ENABLED: 'true', POSTHOG_KEY: 'phc_secret' }),
    )

    telemetry.capture({ name: 'app.opened' })

    expect(posthogMock.PostHog).toHaveBeenCalledWith('phc_secret', {
      host: 'https://us.i.posthog.com',
    })
    expect(posthogMock.clients[0]?.capture).toHaveBeenCalledWith({
      distinctId: 'anonymous',
      event: 'app.opened',
      properties: { eventName: 'app.opened' },
    })
  })

  it('passes POSTHOG_HOST overrides to PostHog', () => {
    createPostHogTelemetryFromEnv(
      env({
        BORING_TELEMETRY_ENABLED: 'true',
        POSTHOG_KEY: 'phc_secret',
        POSTHOG_HOST: 'https://eu.i.posthog.com',
      }),
    )

    expect(posthogMock.clients[0]?.options).toEqual({ host: 'https://eu.i.posthog.com' })
  })

  it('prefixes event names and adds project properties for safe BORING_TELEMETRY_PROJECT values', () => {
    const telemetry = createPostHogTelemetryFromEnv(
      env({
        BORING_TELEMETRY_ENABLED: 'true',
        POSTHOG_KEY: 'phc_secret',
        BORING_TELEMETRY_PROJECT: 'full-app',
      }),
    )

    telemetry.capture({
      name: 'agent.chat.started',
      distinctId: 'user_123',
      properties: { workspaceId: 'workspace_1', durationMs: 12, prompt: 'do not send' },
    })

    expect(posthogMock.clients[0]?.capture).toHaveBeenCalledWith({
      distinctId: 'user_123',
      event: 'full-app.agent.chat.started',
      properties: {
        workspaceId: 'workspace_1',
        durationMs: 12,
        boringProject: 'full-app',
        eventName: 'agent.chat.started',
      },
    })
  })

  it('disables invalid project prefixes and warns without secrets', () => {
    const telemetry = createPostHogTelemetryFromEnv(
      env({
        BORING_TELEMETRY_ENABLED: 'true',
        POSTHOG_KEY: 'phc_secret',
        BORING_TELEMETRY_PROJECT: '../bad project',
      }),
    )

    telemetry.capture({ name: 'workspace.opened' })

    expect(posthogMock.clients[0]?.capture).toHaveBeenCalledWith({
      distinctId: 'anonymous',
      event: 'workspace.opened',
      properties: { eventName: 'workspace.opened' },
    })
    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0]?.[0])).toContain('prefix disabled')
    expect(String(warn.mock.calls[0]?.[0])).not.toContain('phc_secret')
    expect(String(warn.mock.calls[0]?.[0])).not.toContain('../bad project')
  })

  it('falls back to anonymous for unsafe distinct ids', () => {
    const telemetry = createPostHogTelemetryFromEnv(
      env({ BORING_TELEMETRY_ENABLED: 'true', POSTHOG_KEY: 'phc_secret' }),
    )

    telemetry.capture({ name: 'app.opened', distinctId: 'user@example.com' })

    expect(posthogMock.clients[0]?.capture).toHaveBeenCalledWith({
      distinctId: 'anonymous',
      event: 'app.opened',
      properties: { eventName: 'app.opened' },
    })
  })

  it('drops unsafe event names without sending to PostHog', () => {
    const telemetry = createPostHogTelemetryFromEnv(
      env({ BORING_TELEMETRY_ENABLED: 'true', POSTHOG_KEY: 'phc_secret' }),
    )

    telemetry.capture({ name: 'secret.token./tmp/private' })

    expect(posthogMock.clients[0]?.capture).not.toHaveBeenCalled()
  })

  it('swallows PostHog capture failures', async () => {
    const telemetry = createPostHogTelemetryFromEnv(
      env({ BORING_TELEMETRY_ENABLED: 'true', POSTHOG_KEY: 'phc_secret' }),
    )
    posthogMock.clients[0]!.capture.mockImplementation(() => {
      throw new Error('network down')
    })

    expect(() => telemetry.capture({ name: 'server.request.failed' })).not.toThrow()

    posthogMock.clients[0]!.capture.mockRejectedValueOnce(new Error('network still down'))
    expect(() => telemetry.capture({ name: 'server.request.failed' })).not.toThrow()
    await Promise.resolve()
  })

  it('flushes via PostHog shutdown when requested', async () => {
    const telemetry = createPostHogTelemetryFromEnv(
      env({ BORING_TELEMETRY_ENABLED: 'true', POSTHOG_KEY: 'phc_secret' }),
    )

    await telemetry.flush?.()

    expect(posthogMock.clients[0]?.shutdown).toHaveBeenCalledOnce()
  })
})

describe('parseTelemetryProject', () => {
  it('accepts lowercase slugs and trims whitespace', () => {
    expect(parseTelemetryProject(' full-app ')).toBe('full-app')
    expect(parseTelemetryProject('customer-portal')).toBe('customer-portal')
  })

  it('rejects empty or unsafe values', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(parseTelemetryProject(undefined)).toBeUndefined()
    expect(parseTelemetryProject('')).toBeUndefined()
    expect(parseTelemetryProject('Full App')).toBeUndefined()
    expect(parseTelemetryProject('../escape')).toBeUndefined()

    expect(warn).toHaveBeenCalledTimes(2)
  })
})

describe('sanitizeTelemetryDistinctId', () => {
  it('keeps safe ids and falls back for emails, tokens, and paths', () => {
    expect(sanitizeTelemetryDistinctId('user_123')).toBe('user_123')
    expect(sanitizeTelemetryDistinctId('user@example.com')).toBe('anonymous')
    expect(sanitizeTelemetryDistinctId('Bearer secret-token')).toBe('anonymous')
    expect(sanitizeTelemetryDistinctId('/tmp/private-path')).toBe('anonymous')
    expect(sanitizeTelemetryDistinctId(undefined)).toBe('anonymous')
  })
})

describe('sanitizeTelemetryProperties', () => {
  it('keeps only allowlisted primitive telemetry properties', () => {
    expect(
      sanitizeTelemetryProperties({
        workspaceId: 'workspace_1',
        sessionId: 'session_1',
        requestId: 'request_1',
        runtimeMode: 'local',
        modelProvider: 'anthropic',
        toolName: 'bash',
        panelId: 'files',
        commandId: 'open',
        status: 'ok',
        durationMs: 42,
        errorCode: 'WORKSPACE_NOT_READY',
        packageName: '@hachej/boring-core',
        packageVersion: '0.1.0',
        invalidDuration: Number.NaN,
        prompt: 'secret prompt',
        assistantOutput: 'secret answer',
        command: 'cat .env',
        stdout: 'secret output',
        path: '/tmp/private',
        stack: 'stack trace',
        headers: { authorization: 'Bearer secret' },
        nestedAllowedKey: { workspaceId: 'nested' },
        env: 'SECRET=value',
        objectValueOnAllowedKey: { unsafe: true },
        durationMsUnsafe: Number.POSITIVE_INFINITY,
      }),
    ).toEqual({
      workspaceId: 'workspace_1',
      sessionId: 'session_1',
      requestId: 'request_1',
      runtimeMode: 'local',
      modelProvider: 'anthropic',
      toolName: 'bash',
      panelId: 'files',
      commandId: 'open',
      status: 'ok',
      durationMs: 42,
      errorCode: 'WORKSPACE_NOT_READY',
      packageName: '@hachej/boring-core',
      packageVersion: '0.1.0',
    })
  })

  it('drops suspicious strings even on allowlisted keys', () => {
    expect(
      sanitizeTelemetryProperties({
        requestId: '/tmp/private-path',
        sessionId: 'Bearer secret-token',
        workspaceId: 'sk_live_abc123',
        toolName: 'ghp_abc123',
        modelProvider: 'anthropic',
        errorCode: 'SECRET_TOKEN',
        packageName: '@hachej/boring-core',
      }),
    ).toEqual({
      modelProvider: 'anthropic',
      packageName: '@hachej/boring-core',
    })
  })

  it('keeps lower-case stable core error codes', () => {
    expect(sanitizeTelemetryProperties({ errorCode: 'internal_error' })).toEqual({
      errorCode: 'internal_error',
    })
  })

  it('drops non-finite numbers even on allowlisted keys', () => {
    expect(
      sanitizeTelemetryProperties({
        durationMs: Number.POSITIVE_INFINITY,
        requestId: 'request_1',
      }),
    ).toEqual({ requestId: 'request_1' })
  })
})
