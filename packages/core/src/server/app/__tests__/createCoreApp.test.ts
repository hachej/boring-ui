import { describe, it, expect, afterEach } from 'vitest'
import { createCoreApp } from '../createCoreApp'
import type { CoreConfig } from '../../../shared/types'

const TEST_CONFIG: CoreConfig = {
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
  security: {
    csp: {
      enabled: true,
    },
  },
  encryption: { workspaceSettingsKey: 'a'.repeat(64) },
  auth: {
    secret: 's'.repeat(64),
    url: 'http://localhost:3000',
    sessionTtlSeconds: 3600,
    sessionCookieSecure: false,
  },
  features: { githubOauth: false, invitesEnabled: true, sendWelcomeEmail: true },
}

let app: Awaited<ReturnType<typeof createCoreApp>> | null = null

afterEach(async () => {
  if (app) {
    await app.close()
    app = null
  }
})

describe('createCoreApp', () => {
  it('returns a Fastify instance', async () => {
    app = await createCoreApp(TEST_CONFIG, { manageShutdown: false })
    expect(app).toBeDefined()
    expect(typeof app.listen).toBe('function')
  })

  it('decorates app.config with the passed config', async () => {
    app = await createCoreApp(TEST_CONFIG, { manageShutdown: false })
    expect(app.config).toBe(TEST_CONFIG)
    expect(app.config.appId).toBe('test-app')
  })

  it('echoes x-request-id from incoming request', async () => {
    app = await createCoreApp(TEST_CONFIG, { manageShutdown: false })
    app.get('/test', async () => ({ ok: true }))
    await app.ready()

    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-request-id': 'my-custom-id' },
    })

    expect(res.headers['x-request-id']).toBe('my-custom-id')
  })

  it('generates a UUID request-id when none provided', async () => {
    app = await createCoreApp(TEST_CONFIG, { manageShutdown: false })
    app.get('/test', async () => ({ ok: true }))
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/test' })
    const id = res.headers['x-request-id'] as string

    expect(id).toBeDefined()
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
  })

  it('respects trustProxy — reads X-Forwarded-For', async () => {
    app = await createCoreApp(TEST_CONFIG, { manageShutdown: false })
    app.get('/ip', async (req) => ({ ip: req.ip }))
    await app.ready()

    const res = await app.inject({
      method: 'GET',
      url: '/ip',
      headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' },
    })

    const body = JSON.parse(res.body)
    expect(body.ip).toBe('1.2.3.4')
  })

  it('applies CORS headers for allowed origins', async () => {
    app = await createCoreApp(TEST_CONFIG, { manageShutdown: false })
    app.get('/test', async () => ({ ok: true }))
    await app.ready()

    const res = await app.inject({
      method: 'OPTIONS',
      url: '/test',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'GET',
      },
    })

    expect(res.headers['access-control-allow-origin']).toBe(
      'http://localhost:3000',
    )
    expect(res.headers['access-control-allow-credentials']).toBe('true')
  })

  it('adds helmet security headers', async () => {
    app = await createCoreApp(TEST_CONFIG, { manageShutdown: false })
    app.get('/test', async () => ({ ok: true }))
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/test' })

    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBe('DENY')
    expect(res.headers['strict-transport-security']).toContain('max-age=31536000')
    expect(res.headers['strict-transport-security']).toContain('includeSubDomains')
    expect(res.headers['strict-transport-security']).toContain('preload')
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
  })

  it('applies body limit from config', async () => {
    const smallLimitConfig = { ...TEST_CONFIG, bodyLimit: 50 }
    app = await createCoreApp(smallLimitConfig, { manageShutdown: false })
    app.post('/test', async () => ({ received: true }))
    await app.ready()

    const largeBody = JSON.stringify({ data: 'x'.repeat(100) })
    const res = await app.inject({
      method: 'POST',
      url: '/test',
      payload: largeBody,
      headers: { 'content-type': 'application/json' },
    })

    expect(res.statusCode).toBe(413)
  })

  it('exposes addRedactionPaths method', async () => {
    app = await createCoreApp(TEST_CONFIG, { manageShutdown: false })
    expect(typeof app.addRedactionPaths).toBe('function')
    app.addRedactionPaths(['myCustomSecret'])
  })

  it('includes CSP nonce directives and blocks unsafe-inline defaults', async () => {
    app = await createCoreApp(TEST_CONFIG, { manageShutdown: false })
    app.get('/test', async () => ({ ok: true }))
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/test' })
    const csp = res.headers['content-security-policy'] as string

    expect(csp).toContain("default-src 'self'")
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+'/)
    expect(csp).toMatch(/style-src 'self' 'nonce-[^']+'/)
    expect(csp).toContain("connect-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).not.toContain("'unsafe-inline'")
  })

  it('allows disabling CSP via config security flag', async () => {
    app = await createCoreApp(
      {
        ...TEST_CONFIG,
        security: {
          csp: {
            enabled: false,
          },
        },
      },
      { manageShutdown: false },
    )
    app.get('/test', async () => ({ ok: true }))
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/test' })
    expect(res.headers['content-security-policy']).toBeUndefined()
  })
})
