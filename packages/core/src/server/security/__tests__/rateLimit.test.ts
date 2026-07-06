import { afterEach, describe, expect, it } from 'vitest'
import { createCoreApp } from '../../app/createCoreApp'
import type { CoreConfig } from '../../../shared/types'
import { withBeadId } from '../../__tests__/_setup'
import { registerOutreachRoutes } from '../../outreach/routes'
import { AUTH_PROXY_RATE_LIMITED_ROUTES, AUTH_RATE_LIMIT_RULES, DEFAULT_RATE_LIMIT_RULES } from '../rateLimit'

const BASE_CONFIG: CoreConfig = {
  appId: 'test-app',
  appName: 'Test App',
  appLogo: null,
  port: 0,
  host: '127.0.0.1',
  staticDir: null,
  databaseUrl: null,
  stores: 'local',
  cors: {
    origins: ['http://localhost:3000'],
    credentials: true,
  },
  bodyLimit: 16 * 1024 * 1024,
  logLevel: 'silent' as CoreConfig['logLevel'],
  encryption: { workspaceSettingsKey: 'a'.repeat(64) },
  auth: {
    secret: 's'.repeat(64),
    url: 'http://localhost:3000',
    sessionTtlSeconds: 3600,
    sessionCookieSecure: false,
  },
  features: { githubOauth: false, googleOauth: false, invitesEnabled: true, sendWelcomeEmail: true, inviteTtlDays: 7 },
}

let app: Awaited<ReturnType<typeof createCoreApp>> | null = null

afterEach(async () => {
  if (app) {
    await app.close()
    app = null
  }
})

function createConfig(
  overrides: Partial<CoreConfig> = {},
): CoreConfig {
  return {
    ...BASE_CONFIG,
    ...overrides,
    cors: { ...BASE_CONFIG.cors, ...(overrides.cors ?? {}) },
    encryption: {
      ...BASE_CONFIG.encryption,
      ...(overrides.encryption ?? {}),
    },
    auth: { ...BASE_CONFIG.auth, ...(overrides.auth ?? {}) },
    features: {
      ...BASE_CONFIG.features,
      ...(overrides.features ?? {}),
    },
    ...(overrides.rateLimit ? { rateLimit: overrides.rateLimit } : {}),
  }
}

async function injectMany(
  req: {
    method?: 'POST' | 'GET'
    url: string
    payload?: unknown
    headers?: Record<string, string>
  },
  count: number,
  ipProvider?: (index: number) => string,
) {
  const responses = []
  for (let index = 0; index < count; index += 1) {
    responses.push(
      await app!.inject({
        method: req.method ?? 'POST',
        url: req.url,
        payload: req.payload ?? {},
        headers: {
          'x-forwarded-for': ipProvider ? ipProvider(index) : '1.2.3.4',
          ...(req.headers ?? {}),
        },
      }),
    )
  }
  return responses
}

function assertRateLimitEnvelope(res: {
  statusCode: number
  body: string
  headers: Record<string, unknown>
}) {
  expect(res.statusCode).toBe(429)
  expect(res.headers['retry-after']).toBeDefined()
  const body = JSON.parse(res.body) as Record<string, unknown>
  expect(body).toMatchObject({
    error: 'rate_limited',
    code: 'rate_limited',
    message: expect.any(String),
    requestId: expect.any(String),
  })
}

async function registerRealOutreachRoutes() {
  const fakeDb = {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: async () => [],
          }),
        }),
        where: () => ({
          limit: async () => [],
        }),
      }),
    }),
  }
  await app!.register(registerOutreachRoutes, {
    db: fakeDb as never,
    workspaceStore: {} as never,
    creditGrantStore: { grantOnce: async () => ({ created: false }) },
  })
}

describe('rate limiting hardening (xzhz)', () => {
  it('does not register a phantom outreach claim route limit', () => {
    expect(DEFAULT_RATE_LIMIT_RULES.map((rule) => rule.url)).not.toContain('/api/v1/outreach/claim')
    expect(DEFAULT_RATE_LIMIT_RULES.map((rule) => rule.url)).toContain('/auth/sign-up/email')
  })

  it('derives auth proxy rate-limited routes from the canonical auth rules', () => {
    expect(AUTH_PROXY_RATE_LIMITED_ROUTES).toEqual(
      AUTH_RATE_LIMIT_RULES.map((rule) => ({ method: rule.method, url: rule.url })),
    )
  })

  it(
    'limits real outreach token consumption route',
    withBeadId('boring-ui-v2-xzhz', async ({ assertionPassed }) => {
      app = await createCoreApp(
        createConfig({
          rateLimit: {
            '/o/:token': { max: 2, window: '1 minute' },
          },
        }),
        { manageShutdown: false },
      )
      await registerRealOutreachRoutes()
      await app.ready()

      const responses = await injectMany(
        { method: 'GET', url: '/o/token-1' },
        3,
      )

      expect(responses[0].statusCode).not.toBe(429)
      expect(responses[1].statusCode).not.toBe(429)
      assertRateLimitEnvelope(responses[2])
      assertionPassed('real-outreach-token-route')
    }),
  )

  it(
    'limits real outreach experience creation route',
    withBeadId('boring-ui-v2-xzhz', async ({ assertionPassed }) => {
      app = await createCoreApp(
        createConfig({
          rateLimit: {
            '/api/v1/outreach/experiences': { max: 2, window: '1 minute' },
          },
        }),
        { manageShutdown: false },
      )
      await registerRealOutreachRoutes()
      await app.ready()

      const responses = await injectMany(
        {
          method: 'POST',
          url: '/api/v1/outreach/experiences',
          payload: { name: 'demo', provisioningMode: 'shared_readonly' },
        },
        3,
      )

      expect(responses[0].statusCode).not.toBe(429)
      expect(responses[1].statusCode).not.toBe(429)
      assertRateLimitEnvelope(responses[2])
      assertionPassed('real-outreach-experience-create-route')
    }),
  )

  it(
    'limits real outreach link creation route',
    withBeadId('boring-ui-v2-xzhz', async ({ assertionPassed }) => {
      app = await createCoreApp(
        createConfig({
          rateLimit: {
            '/api/v1/outreach-links': { max: 2, window: '1 minute' },
          },
        }),
        { manageShutdown: false },
      )
      await registerRealOutreachRoutes()
      await app.ready()

      const responses = await injectMany(
        {
          method: 'POST',
          url: '/api/v1/outreach-links',
          payload: { experienceId: '00000000-0000-0000-0000-000000000001' },
        },
        3,
      )

      expect(responses[0].statusCode).not.toBe(429)
      expect(responses[1].statusCode).not.toBe(429)
      assertRateLimitEnvelope(responses[2])
      assertionPassed('real-outreach-link-create-route')
    }),
  )

  it(
    'outreach admin creation limits are keyed by user when authenticated',
    withBeadId('boring-ui-v2-xzhz', async ({ assertionPassed }) => {
      app = await createCoreApp(
        createConfig({
          rateLimit: {
            '/api/v1/outreach-links': { max: 2, window: '1 minute' },
          },
        }),
        { manageShutdown: false },
      )
      app.addHook('onRequest', async (request) => {
        const userId = request.headers['x-test-user-id']
        if (typeof userId === 'string' && userId.length > 0) {
          request.user = {
            id: userId,
            email: `${userId}@example.test`,
            name: userId,
            emailVerified: true,
          }
        }
      })
      await registerRealOutreachRoutes()
      await app.ready()

      const userA = []
      for (let index = 0; index < 3; index += 1) {
        userA.push(await app.inject({
          method: 'POST',
          url: '/api/v1/outreach-links',
          headers: {
            'x-forwarded-for': '1.2.3.4',
            'x-test-user-id': 'user-a',
          },
          payload: { experienceId: '00000000-0000-0000-0000-000000000001' },
        }))
      }
      assertRateLimitEnvelope(userA[2])

      const userB = await app.inject({
        method: 'POST',
        url: '/api/v1/outreach-links',
        headers: {
          'x-forwarded-for': '1.2.3.4',
          'x-test-user-id': 'user-b',
        },
        payload: { experienceId: '00000000-0000-0000-0000-000000000001' },
      })
      expect(userB.statusCode).not.toBe(429)
      assertionPassed('outreach-admin-user-key')
    }),
  )

  it(
    'window expiry allows requests again after configured window',
    withBeadId('boring-ui-v2-xzhz', async ({ assertionPassed }) => {
      app = await createCoreApp(
        createConfig({
          rateLimit: {
            '/o/:token': { max: 2, window: '1 second' },
          },
        }),
        { manageShutdown: false },
      )
      await registerRealOutreachRoutes()
      await app.ready()

      const firstBurst = await injectMany(
        { method: 'GET', url: '/o/token-1' },
        3,
      )
      expect(firstBurst[0].statusCode).not.toBe(429)
      expect(firstBurst[1].statusCode).not.toBe(429)
      assertRateLimitEnvelope(firstBurst[2])

      await new Promise((resolve) => setTimeout(resolve, 1_500))

      const afterWindow = await app.inject({
        method: 'GET',
        url: '/o/token-1',
        headers: { 'x-forwarded-for': '1.2.3.4' },
      })
      expect(afterWindow.statusCode).not.toBe(429)
      assertionPassed('window-expiry')
    }),
  )
})
