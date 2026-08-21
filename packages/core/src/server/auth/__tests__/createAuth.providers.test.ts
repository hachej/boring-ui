import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CoreConfig } from '../../../shared/types'

const { betterAuthMock, drizzleAdapterMock } = vi.hoisted(() => ({
  betterAuthMock: vi.fn((options: Record<string, unknown>) => ({
    handler: vi.fn(),
    options,
  })),
  drizzleAdapterMock: vi.fn(() => ({ mocked: true })),
}))

vi.mock('better-auth', () => ({
  betterAuth: betterAuthMock,
  APIError: { from: vi.fn() },
}))

vi.mock('better-auth/adapters/drizzle', () => ({
  drizzleAdapter: drizzleAdapterMock,
}))

import { createAuth, type CoreDynamicAuthBaseURL } from '../createAuth'

const indirectFallbackConfig = {
  allowedHosts: ['app.example.test'],
  protocol: 'https' as const,
  fallback: 'https://app.example.test',
}
// @ts-expect-error fallback is forbidden even when supplied through structural assignment.
const invalidFallbackConfig: CoreDynamicAuthBaseURL = indirectFallbackConfig
void invalidFallbackConfig

function makeConfig(overrides?: Partial<CoreConfig>): CoreConfig {
  return {
    appId: 'test-app',
    appName: 'Test App',
    appLogo: null,
    port: 0,
    host: '127.0.0.1',
    staticDir: null,
    databaseUrl: null,
    stores: 'local',
    cors: { origins: ['http://localhost:3000'], credentials: true },
    bodyLimit: 16 * 1024 * 1024,
    logLevel: 'silent' as CoreConfig['logLevel'],
    encryption: { workspaceSettingsKey: 'a'.repeat(64) },
    auth: {
      secret: 's'.repeat(64),
      url: 'http://localhost:3000',
      sessionTtlSeconds: 3600,
      sessionCookieSecure: false,
    },
    features: {
      githubOauth: false,
      googleOauth: false,
      invitesEnabled: true,
      sendWelcomeEmail: true,
      inviteTtlDays: 7,
    },
    ...overrides,
  }
}

function getBetterAuthOptions() {
  expect(betterAuthMock).toHaveBeenCalled()
  return betterAuthMock.mock.calls.at(-1)?.[0] as {
    advanced: Record<string, unknown>
    baseURL: unknown
    socialProviders: Record<string, unknown>
  }
}

function getSocialProviders() {
  return getBetterAuthOptions().socialProviders
}

describe('createAuth base URL', () => {
  beforeEach(() => {
    betterAuthMock.mockClear()
    drizzleAdapterMock.mockClear()
  })

  it('preserves the canonical static config when no dynamic option is provided', () => {
    createAuth(makeConfig(), {} as never)

    const options = getBetterAuthOptions()
    expect(options.baseURL).toBe('http://localhost:3000')
    expect(options.advanced).not.toHaveProperty('trustedProxyHeaders')
  })

  it('snapshots dynamic allowed hosts and disables forwarded-header trust', () => {
    const baseURL: CoreDynamicAuthBaseURL = {
      allowedHosts: ['app.example.test', 'agent.example.test'],
      protocol: 'https',
    }

    createAuth(makeConfig(), {} as never, { baseURL })

    const options = getBetterAuthOptions()
    expect(options.baseURL).toEqual(baseURL)
    expect(options.baseURL).not.toBe(baseURL)
    expect(Object.isFrozen(options.baseURL)).toBe(true)
    expect(Object.isFrozen((options.baseURL as CoreDynamicAuthBaseURL).allowedHosts)).toBe(true)
    expect(options.advanced.trustedProxyHeaders).toBe(false)

    baseURL.allowedHosts[0] = '*.attacker.test'
    baseURL.protocol = 'http'
    ;(baseURL as unknown as { fallback?: string }).fallback = 'https://attacker.test'
    expect(options.baseURL).toEqual({
      allowedHosts: ['app.example.test', 'agent.example.test'],
      protocol: 'https',
    })
  })

  it('rejects null instead of silently restoring the canonical static URL', () => {
    expect(() => createAuth(makeConfig(), {} as never, {
      baseURL: null as never,
    })).toThrow(/authBaseURL must be an object/)
    expect(betterAuthMock).not.toHaveBeenCalled()
  })

  it.each([
    ['an empty allowlist', { allowedHosts: [], protocol: 'https' }],
    ['a wildcard', { allowedHosts: ['*.example.test'], protocol: 'https' }],
    ['a scheme', { allowedHosts: ['https://app.example.test'], protocol: 'https' }],
    ['a path', { allowedHosts: ['app.example.test/auth'], protocol: 'https' }],
    ['userinfo', { allowedHosts: ['user@app.example.test'], protocol: 'https' }],
    ['an invalid port', { allowedHosts: ['app.example.test:65536'], protocol: 'https' }],
    ['an invalid protocol', { allowedHosts: ['app.example.test'], protocol: 'auto' }],
    ['a fallback', {
      allowedHosts: ['app.example.test'],
      protocol: 'https',
      fallback: 'https://app.example.test',
    }],
  ])('rejects dynamic base URL config with %s', (_label, baseURL) => {
    expect(() => createAuth(makeConfig(), {} as never, {
      baseURL: baseURL as never,
    })).toThrow(/authBaseURL/)
    expect(betterAuthMock).not.toHaveBeenCalled()
  })
})

describe('createAuth social providers', () => {
  beforeEach(() => {
    betterAuthMock.mockClear()
    drizzleAdapterMock.mockClear()
  })

  it('passes a Google provider block when Google config is present and the feature is enabled', () => {
    createAuth(
      makeConfig({
        auth: {
          ...makeConfig().auth,
          google: {
            clientId: 'google-client-id',
            clientSecret: 'google-client-secret',
          },
        },
        features: {
          ...makeConfig().features,
          googleOauth: true,
        },
      }),
      {} as never,
    )

    expect(getSocialProviders()).toEqual({
      google: {
        clientId: 'google-client-id',
        clientSecret: 'google-client-secret',
      },
    })
  })

  it('omits the Google provider block when Google config is absent', () => {
    createAuth(makeConfig(), {} as never)

    expect(getSocialProviders()).toEqual({})
  })

  it('omits the Google provider block when credentials exist but the feature is off', () => {
    createAuth(
      makeConfig({
        auth: {
          ...makeConfig().auth,
          google: {
            clientId: 'google-client-id',
            clientSecret: 'google-client-secret',
          },
        },
      }),
      {} as never,
    )

    expect(getSocialProviders()).toEqual({})
  })

  it('keeps existing GitHub handling intact when Google is also configured', () => {
    createAuth(
      makeConfig({
        auth: {
          ...makeConfig().auth,
          github: {
            clientId: 'github-client-id',
            clientSecret: 'github-client-secret',
          },
          google: {
            clientId: 'google-client-id',
            clientSecret: 'google-client-secret',
          },
        },
        features: {
          ...makeConfig().features,
          googleOauth: true,
        },
      }),
      {} as never,
    )

    expect(getSocialProviders()).toEqual({
      github: {
        clientId: 'github-client-id',
        clientSecret: 'github-client-secret',
      },
      google: {
        clientId: 'google-client-id',
        clientSecret: 'google-client-secret',
      },
    })
  })
})
