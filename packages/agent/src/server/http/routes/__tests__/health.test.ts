import Fastify from 'fastify'
import { describe, test, expect } from 'vitest'
import { healthRoutes, type ReadinessState } from '../health'
import { createAuthMiddleware } from '../../middleware'

function buildApp(
  readiness: ReadinessState = { sandboxReady: true, harnessReady: true },
  opts: { authToken?: string } = {},
) {
  const app = Fastify({ logger: false })
  if (opts.authToken) {
    app.addHook(
      'onRequest',
      createAuthMiddleware({
        authToken: opts.authToken,
        publicPaths: ['/health', '/ready'],
      }),
    )
  }
  app.register(healthRoutes, {
    version: '0.1.0-test',
    getReadiness: () => readiness,
  })
  return app.ready().then(() => app)
}

describe('GET /health', () => {
  test('returns 200 with version and uptime', async () => {
    const app = await buildApp()

    const res = await app.inject({ method: 'GET', url: '/health' })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.status).toBe('ok')
    expect(body.version).toBe('0.1.0-test')
    expect(typeof body.uptime).toBe('number')
    expect(body.uptime).toBeGreaterThanOrEqual(0)

    await app.close()
  })

  test('does not require auth even when auth is enabled', async () => {
    const app = await buildApp(
      { sandboxReady: true, harnessReady: true },
      { authToken: 'secret-token' },
    )

    const res = await app.inject({ method: 'GET', url: '/health' })

    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('ok')
    await app.close()
  })
})

describe('GET /ready', () => {
  test('returns 200 when fully ready', async () => {
    const app = await buildApp({ sandboxReady: true, harnessReady: true })

    const res = await app.inject({ method: 'GET', url: '/ready' })

    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('ready')

    await app.close()
  })

  test('returns 503 provisioning during cold start', async () => {
    const app = await buildApp({ sandboxReady: false, harnessReady: false })

    const res = await app.inject({ method: 'GET', url: '/ready' })

    expect(res.statusCode).toBe(503)
    const body = res.json()
    expect(body.status).toBe('provisioning')
    expect(body.retryAfter).toBe(2)

    await app.close()
  })

  test('returns 503 when sandbox not ready but harness is', async () => {
    const app = await buildApp({ sandboxReady: false, harnessReady: true })

    const res = await app.inject({ method: 'GET', url: '/ready' })

    expect(res.statusCode).toBe(503)
    expect(res.json().status).toBe('provisioning')

    await app.close()
  })

  test('returns 503 degraded with reason when circuit open', async () => {
    const app = await buildApp({
      sandboxReady: true,
      harnessReady: true,
      degradedReason: 'sandbox_timeout',
    })

    const res = await app.inject({ method: 'GET', url: '/ready' })

    expect(res.statusCode).toBe(503)
    const body = res.json()
    expect(body.status).toBe('degraded')
    expect(body.reason).toBe('sandbox_timeout')

    await app.close()
  })

  test('does not require auth even when auth is enabled', async () => {
    const app = await buildApp(
      { sandboxReady: true, harnessReady: true },
      { authToken: 'secret-token' },
    )

    const res = await app.inject({ method: 'GET', url: '/ready' })

    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('ready')
    await app.close()
  })
})
