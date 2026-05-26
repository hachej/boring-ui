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

import { createAuth } from '../createAuth'

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

function getSocialProviders() {
  expect(betterAuthMock).toHaveBeenCalled()
  const options = betterAuthMock.mock.calls.at(-1)?.[0] as {
    socialProviders: Record<string, unknown>
  }
  return options.socialProviders
}

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
