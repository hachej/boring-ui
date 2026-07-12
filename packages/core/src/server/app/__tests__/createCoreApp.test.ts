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
  features: { githubOauth: false, googleOauth: false, invitesEnabled: true, sendWelcomeEmail: true, inviteTtlDays: 7 },
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

  it('leaves request scope unset when the optional resolver declines', async () => {
    app = await createCoreApp(TEST_CONFIG, { manageShutdown: false, requestScopeResolver: async () => undefined })
    app.get('/scope', async (request) => ({ hasScope: request.requestScope !== undefined }))
    await app.ready()
    expect((await app.inject({ method: 'GET', url: '/scope' })).body).toBe('{"hasScope":false}')
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

  it('ignores spoofed proxy headers when policy is undefined', async () => {
    app = await createCoreApp(TEST_CONFIG, { manageShutdown: false })
    app.get('/ip', async (req) => ({ ip: req.ip }))
    await app.ready()

    const res = await app.inject({
      method: 'GET',
      url: '/ip',
      headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' },
      remoteAddress: '192.168.255.250',
    })

    expect(JSON.parse(res.body).ip).toBe('192.168.255.250')
  })

  it('ignores spoofed proxy headers when policy is explicitly null', async () => {
    const config: CoreConfig = { ...TEST_CONFIG, security: { ...TEST_CONFIG.security!, trustedProxy: null } }
    app = await createCoreApp(config, { manageShutdown: false })
    app.get('/ip', async (req) => ({ ip: req.ip }))
    await app.ready()
    const response = await app.inject({ method: 'GET', url: '/ip', remoteAddress: '192.168.255.250', headers: { 'x-forwarded-for': '1.2.3.4' } })
    expect(JSON.parse(response.body).ip).toBe('192.168.255.250')
  })

  it('preserves forwarded IP only through the explicit legacy-unsafe sentinel', async () => {
    const config: CoreConfig = { ...TEST_CONFIG, security: { ...TEST_CONFIG.security!, trustedProxy: 'legacy-unsafe' } }
    app = await createCoreApp(config, { manageShutdown: false })
    app.get('/ip', async (req) => ({ ip: req.ip }))
    await app.ready()
    const response = await app.inject({ method: 'GET', url: '/ip', remoteAddress: '192.168.255.250', headers: { 'x-forwarded-for': '1.2.3.4' } })
    expect(JSON.parse(response.body).ip).toBe('1.2.3.4')
  })

  it('trusts only configured ingress CIDRs within the exact hop budget', async () => {
    const config: CoreConfig = {
      ...TEST_CONFIG,
      security: { ...TEST_CONFIG.security!, trustedProxy: { cidrs: ['192.168.255.250/32'], hops: 1 } },
    }
    app = await createCoreApp(config, { manageShutdown: false })
    app.get('/ip', async (req) => ({ ip: req.ip }))
    await app.ready()

    const cases = [
      { remoteAddress: '192.168.255.250', forwarded: '198.51.100.7', expected: '198.51.100.7' },
      { remoteAddress: '192.168.255.251', forwarded: '198.51.100.7', expected: '192.168.255.251' },
      { remoteAddress: '192.168.255.250', forwarded: '192.0.2.200, 198.51.100.7', expected: '198.51.100.7' },
    ]
    for (const testCase of cases) {
      const response = await app.inject({ method: 'GET', url: '/ip', remoteAddress: testCase.remoteAddress, headers: { 'x-forwarded-for': testCase.forwarded } })
      expect(JSON.parse(response.body).ip).toBe(testCase.expected)
    }
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

  it('includes CSP nonce directives and allows layout style attributes only', async () => {
    app = await createCoreApp(TEST_CONFIG, { manageShutdown: false })
    app.get('/test', async () => ({ ok: true }))
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/test' })
    const csp = res.headers['content-security-policy'] as string

    expect(csp).toContain("default-src 'self'")
    expect(csp).toMatch(/script-src 'self' .*'nonce-[^']+'/)
    expect(csp).toMatch(/style-src 'self' https:\/\/fonts\.googleapis\.com 'nonce-[^']+'/)
    expect(csp).toContain("style-src-attr 'unsafe-inline'")
    expect(csp).toContain("connect-src 'self'")
    expect(csp).toContain("font-src 'self' https://fonts.gstatic.com data:")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).not.toContain('upgrade-insecure-requests')
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'")
    expect(csp).not.toContain("'unsafe-eval'")
  })

  it('emits CSP upgrade-insecure-requests only when enabled', async () => {
    app = await createCoreApp(
      {
        ...TEST_CONFIG,
        security: {
          csp: {
            enabled: true,
            upgradeInsecureRequests: true,
          },
        },
      },
      { manageShutdown: false },
    )
    app.get('/test', async () => ({ ok: true }))
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/test' })
    const csp = res.headers['content-security-policy'] as string

    expect(csp).toContain('upgrade-insecure-requests')
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
