import { describe, it, expect, afterEach } from 'vitest'
import { createCoreApp } from '../createCoreApp'
import { HttpError } from '../../../shared/errors'
import type { CoreConfig } from '../../../shared/types'
import { z } from 'zod'

const TEST_CONFIG: CoreConfig = {
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
  features: { githubOauth: false, invitesEnabled: true },
}

let app: Awaited<ReturnType<typeof createCoreApp>> | null = null

afterEach(async () => {
  if (app) {
    await app.close()
    app = null
  }
})

describe('error handler', () => {
  it('maps HttpError to correct status + envelope', async () => {
    app = await createCoreApp(TEST_CONFIG, { manageShutdown: false })
    app.get('/test', async () => {
      throw new HttpError({
        status: 403,
        code: 'forbidden',
        message: 'Access denied',
      })
    })
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/test' })
    expect(res.statusCode).toBe(403)

    const body = JSON.parse(res.body)
    expect(body.code).toBe('forbidden')
    expect(body.message).toBe('Access denied')
    expect(body.requestId).toBeDefined()
  })

  it('maps unknown Error to 500 internal_error', async () => {
    app = await createCoreApp(TEST_CONFIG, { manageShutdown: false })
    app.get('/test', async () => {
      throw new Error('something unexpected')
    })
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/test' })
    expect(res.statusCode).toBe(500)

    const body = JSON.parse(res.body)
    expect(body.code).toBe('internal_error')
    expect(body.message).toBe('Internal server error')
    expect(body.requestId).toBeDefined()
  })

  it('maps Fastify validation error to 400 validation_failed', async () => {
    app = await createCoreApp(TEST_CONFIG, { manageShutdown: false })

    const bodySchema = z.object({ name: z.string().min(1) })

    app.post('/test', {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string', minLength: 1 } },
        },
      },
    }, async (req) => {
      return { ok: true }
    })
    await app.ready()

    const res = await app.inject({
      method: 'POST',
      url: '/test',
      payload: {},
      headers: { 'content-type': 'application/json' },
    })

    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.code).toBe('validation_failed')
    expect(body.requestId).toBeDefined()
  })

  it('includes requestId from incoming header in error response', async () => {
    app = await createCoreApp(TEST_CONFIG, { manageShutdown: false })
    app.get('/test', async () => {
      throw new HttpError({
        status: 404,
        code: 'not_found',
        message: 'Not found',
      })
    })
    await app.ready()

    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-request-id': 'my-req-123' },
    })

    const body = JSON.parse(res.body)
    expect(body.requestId).toBe('my-req-123')
  })

  it('maps rate-limit error to 429 with Retry-After header', async () => {
    app = await createCoreApp(TEST_CONFIG, { manageShutdown: false })
    app.get('/test', async () => {
      const err = new Error('Rate limit exceeded') as Error & {
        statusCode: number
        code: string
        retryAfter: number
      }
      err.statusCode = 429
      err.code = 'FST_ERR_RATE_LIMIT'
      err.retryAfter = 30
      throw err
    })
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/test' })
    expect(res.statusCode).toBe(429)

    const body = JSON.parse(res.body)
    expect(body.code).toBe('rate_limited')
    expect(body.message).toContain('Retry after 30 seconds')
    expect(res.headers['retry-after']).toBe('30')
    expect(body.requestId).toBeDefined()
  })

  it('passes through Fastify built-in 4xx with envelope shape', async () => {
    const smallLimitConfig = { ...TEST_CONFIG, bodyLimit: 50 }
    app = await createCoreApp(smallLimitConfig, { manageShutdown: false })
    app.post('/test', async () => ({ ok: true }))
    await app.ready()

    const res = await app.inject({
      method: 'POST',
      url: '/test',
      payload: JSON.stringify({ data: 'x'.repeat(100) }),
      headers: { 'content-type': 'application/json' },
    })

    expect(res.statusCode).toBe(413)
    const body = JSON.parse(res.body)
    expect(body.code).not.toBe('internal_error')
    expect(body.message).toBeDefined()
    expect(body.requestId).toBeDefined()
  })

  it('returns envelope-shaped 404 for unknown routes', async () => {
    app = await createCoreApp(TEST_CONFIG, { manageShutdown: false })
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/nonexistent' })
    expect(res.statusCode).toBe(404)

    const body = JSON.parse(res.body)
    expect(body.code).toBe('not_found')
    expect(body.message).toContain('/nonexistent')
    expect(body.requestId).toBeDefined()
  })

  it('does not leak internal error details to the client', async () => {
    app = await createCoreApp(TEST_CONFIG, { manageShutdown: false })
    app.get('/test', async () => {
      throw new Error('database connection string: postgres://secret@host/db')
    })
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/test' })
    const body = JSON.parse(res.body)

    expect(body.message).toBe('Internal server error')
    expect(body.message).not.toContain('postgres://')
    expect(JSON.stringify(body)).not.toContain('secret@host')
  })
})
