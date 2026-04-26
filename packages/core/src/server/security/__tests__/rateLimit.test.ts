import { afterEach, describe, expect, it } from 'vitest'
import { createCoreApp } from '../../app/createCoreApp'
import type { CoreConfig } from '../../../shared/types'
import { withBeadId } from '../../__tests__/_setup'
import { DEFAULT_RATE_LIMIT_RULES } from '../rateLimit'

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
  features: { githubOauth: false, invitesEnabled: true, sendWelcomeEmail: true },
}

const RATE_LIMITED_ENDPOINTS = DEFAULT_RATE_LIMIT_RULES.map((rule) => ({
  url: rule.url,
  method: rule.method,
  limit: rule.max,
})) as ReadonlyArray<{
  url: string
  method: 'POST' | 'GET'
  limit: number
}>

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

describe('rate limiting hardening (xzhz)', () => {
  for (const endpoint of RATE_LIMITED_ENDPOINTS) {
    const runtimeUrl =
      endpoint.url === '/api/v1/workspaces/:id/invites'
        ? '/api/v1/workspaces/ws-1/invites'
        : endpoint.url

    it(
      `${endpoint.url} — ${endpoint.limit + 1}th request returns 429 with envelope`,
      withBeadId('boring-ui-v2-xzhz', async ({ logEvent, assertionPassed }) => {
        app = await createCoreApp(createConfig(), { manageShutdown: false })
        app.post(endpoint.url, async () => ({ ok: true }))
        await app.ready()

        logEvent('assertion.passed', {
          stage: 'hammer.start',
          endpoint: endpoint.url,
          limit: endpoint.limit,
        })

        const responses = await injectMany(
          { method: endpoint.method, url: runtimeUrl },
          endpoint.limit + 1,
        )

        for (let index = 0; index < endpoint.limit; index += 1) {
          // First N can succeed or fail for non-rate reasons; only assert "not 429".
          expect(responses[index].statusCode).not.toBe(429)
        }

        assertRateLimitEnvelope(responses[endpoint.limit])
        assertionPassed('per-endpoint-hammer', { endpoint: endpoint.url })
      }),
    )
  }

  it(
    'workspace-scoped invite limit uses workspace key (not per-IP)',
    withBeadId('boring-ui-v2-xzhz', async ({ assertionPassed }) => {
      app = await createCoreApp(createConfig(), { manageShutdown: false })
      app.post('/api/v1/workspaces/:id/invites', async () => ({ ok: true }))
      await app.ready()

      const responses = await injectMany(
        {
          method: 'POST',
          url: '/api/v1/workspaces/ws-same/invites',
        },
        21,
        (index) => `10.0.0.${index + 1}`,
      )

      for (let index = 0; index < 20; index += 1) {
        expect(responses[index].statusCode).not.toBe(429)
      }
      assertRateLimitEnvelope(responses[20])
      assertionPassed('workspace-scoped-key')
    }),
  )

  it(
    'different workspaces are isolated for invite limits',
    withBeadId('boring-ui-v2-xzhz', async ({ assertionPassed }) => {
      app = await createCoreApp(createConfig(), { manageShutdown: false })
      app.post('/api/v1/workspaces/:id/invites', async () => ({ ok: true }))
      await app.ready()

      const onWorkspaceA = await injectMany(
        { method: 'POST', url: '/api/v1/workspaces/ws-a/invites' },
        20,
      )
      const onWorkspaceB = await app.inject({
        method: 'POST',
        url: '/api/v1/workspaces/ws-b/invites',
        headers: { 'x-forwarded-for': '1.2.3.4' },
        payload: {},
      })

      expect(onWorkspaceA[19].statusCode).not.toBe(429)
      expect(onWorkspaceB.statusCode).not.toBe(429)
      assertionPassed('workspace-isolation')
    }),
  )

  it(
    'window expiry allows requests again after configured window',
    withBeadId('boring-ui-v2-xzhz', async ({ assertionPassed }) => {
      app = await createCoreApp(
        createConfig({
          rateLimit: {
            '/auth/sign-in/email': { max: 2, window: '1 second' },
          },
        }),
        { manageShutdown: false },
      )
      app.post('/auth/sign-in/email', async () => ({ ok: true }))
      await app.ready()

      const firstBurst = await injectMany(
        { method: 'POST', url: '/auth/sign-in/email' },
        3,
      )
      expect(firstBurst[0].statusCode).not.toBe(429)
      expect(firstBurst[1].statusCode).not.toBe(429)
      assertRateLimitEnvelope(firstBurst[2])

      await new Promise((resolve) => setTimeout(resolve, 1_500))

      const afterWindow = await app.inject({
        method: 'POST',
        url: '/auth/sign-in/email',
        headers: { 'x-forwarded-for': '1.2.3.4' },
        payload: {},
      })
      expect(afterWindow.statusCode).not.toBe(429)
      assertionPassed('window-expiry')
    }),
  )

  it(
    '/auth/sign-out pass-through remains unrestricted',
    withBeadId('boring-ui-v2-xzhz', async ({ assertionPassed }) => {
      app = await createCoreApp(createConfig(), { manageShutdown: false })
      app.post('/auth/sign-out', async () => ({ ok: true }))
      await app.ready()

      const responses = await injectMany(
        { method: 'POST', url: '/auth/sign-out' },
        6,
      )
      for (const response of responses) {
        expect(response.statusCode).toBe(200)
      }
      assertionPassed('signout-pass-through')
    }),
  )
})
