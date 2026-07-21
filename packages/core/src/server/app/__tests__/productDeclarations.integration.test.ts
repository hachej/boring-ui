import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CoreConfig } from '../../../shared/types'
import { ERROR_CODES } from '../../../shared/errors'
import { createCoreApp } from '../createCoreApp'
import type { CoreProductRoutingConfig } from '../../productDeclarations'

const TEST_CONFIG: CoreConfig = {
  appId: 'test-app', appName: 'Test App', appLogo: null, port: 0, host: '127.0.0.1',
  staticDir: null, databaseUrl: null, stores: 'local',
  cors: { origins: ['https://legal.products.example', 'https://research.products.example'], credentials: true },
  bodyLimit: 16 * 1024 * 1024, logLevel: 'silent' as CoreConfig['logLevel'],
  security: { csp: { enabled: false } },
  encryption: { workspaceSettingsKey: 'a'.repeat(64) },
  auth: {
    secret: 's'.repeat(64), url: 'https://legal.products.example',
    sessionTtlSeconds: 3600, sessionCookieSecure: true,
  },
  features: {
    githubOauth: false, googleOauth: false, invitesEnabled: true,
    sendWelcomeEmail: true, inviteTtlDays: 7,
  },
}

const PRODUCT_ROUTING: CoreProductRoutingConfig = {
  domains: [
    { hostname: 'legal.products.example', workspaceTypeId: 'contract-review' },
    { hostname: 'research.products.example', workspaceTypeId: 'research' },
  ],
  workspaceProducts: [
    { workspaceTypeId: 'contract-review', label: 'Legal', allowWorkspaceCreation: true },
    { workspaceTypeId: 'research', label: 'Research', allowWorkspaceCreation: false },
  ],
}

let app: Awaited<ReturnType<typeof createCoreApp>> | null = null

afterEach(async () => {
  if (app) await app.close()
  app = null
})

describe('typed-domain request resolution', () => {
  it('is disabled by default and preserves localhost and preview host behavior', async () => {
    const compatibilityConfig: CoreConfig = {
      ...TEST_CONFIG,
      cors: { origins: [], credentials: true },
      auth: { ...TEST_CONFIG.auth, url: 'http://localhost:3000', sessionCookieSecure: false },
    }
    app = await createCoreApp(compatibilityConfig, { manageShutdown: false })
    app.get('/ok', async (request) => ({ hostname: request.hostname, productScope: request.productScope }))
    await app.ready()

    for (const host of ['localhost:3000', 'pr-391.preview.example']) {
      const response = await app.inject({
        method: 'GET', url: '/ok',
        headers: { host, 'x-forwarded-host': 'spoofed.example' },
        remoteAddress: '192.168.255.251',
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ hostname: host.split(':')[0] })
    }
    expect(app.coreProductRouting).toBeNull()
    expect(app.sharedAuthCookieDomain).toBeNull()
    expect(app.sharedAuthTrustedOrigins).toBeNull()
  })

  it.each([
    ['LEGAL.PRODUCTS.EXAMPLE.:443', { workspaceTypeId: 'contract-review', allowWorkspaceCreation: true, normalizedHostname: 'legal.products.example' }],
    ['research.products.example', { workspaceTypeId: 'research', allowWorkspaceCreation: false, normalizedHostname: 'research.products.example' }],
  ])('assigns only the frozen product scope for %s', async (host, expected) => {
    app = await createCoreApp(TEST_CONFIG, {
      manageShutdown: false,
      coreProductRouting: PRODUCT_ROUTING,
      sharedAuthCookieDomain: 'products.example',
    })
    app.get('/scope', async (request) => ({
      scope: request.productScope,
      frozen: Object.isFrozen(request.productScope),
      keys: Object.keys(request.productScope ?? {}).sort(),
    }))
    await app.ready()

    const response = await app.inject({ method: 'GET', url: '/scope', headers: { host } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      scope: expected,
      frozen: true,
      keys: ['allowWorkspaceCreation', 'normalizedHostname', 'workspaceTypeId'],
    })
  })

  it('keeps typed product APIs dark until the C2 authorization guard is installed', async () => {
    const workspaceEffect = vi.fn()
    app = await createCoreApp(TEST_CONFIG, {
      manageShutdown: false,
      coreProductRouting: PRODUCT_ROUTING,
      sharedAuthCookieDomain: 'products.example',
    })
    app.get('/api/v1/config', async () => ({ ok: true }))
    app.get('/api/v1/workspaces/:id', async () => {
      workspaceEffect()
      return { ok: true }
    })
    app.delete('/api/v1/me', async () => {
      workspaceEffect()
      return { ok: true }
    })
    await app.ready()

    const publicResponse = await app.inject({
      method: 'GET', url: '/api/v1/config', headers: { host: 'legal.products.example' },
    })
    expect(publicResponse.statusCode).toBe(200)

    for (const request of [
      { method: 'GET', url: '/api/v1/workspaces/other-product' },
      { method: 'DELETE', url: '/api/v1/me' },
    ] as const) {
      const response = await app.inject({ ...request, headers: { host: 'legal.products.example' } })
      expect(response.statusCode).toBe(503)
      expect(response.json().code).toBe(ERROR_CODES.TYPED_WORKSPACE_AUTHORIZATION_NOT_AVAILABLE)
    }
    expect(workspaceEffect).not.toHaveBeenCalled()
  })

  it('fails unknown and malformed hosts closed', async () => {
    app = await createCoreApp(TEST_CONFIG, {
      manageShutdown: false, coreProductRouting: PRODUCT_ROUTING,
      sharedAuthCookieDomain: 'products.example',
    })
    app.get('/ok', async () => ({ ok: true }))
    await app.ready()

    for (const host of ['unknown.products.example', 'legal.products.example,hostile.example']) {
      const response = await app.inject({ method: 'GET', url: '/ok', headers: { host } })
      expect(response.statusCode).toBe(421)
      expect(response.json().code).toMatch(/unknown_product_hostname|invalid_product_hostname/)
    }
  })

  it('ignores forwarding spoofing outside the bounded trustedProxy policy', async () => {
    const config: CoreConfig = {
      ...TEST_CONFIG,
      security: { csp: { enabled: false }, trustedProxy: { cidrs: ['192.168.255.250/32'], hops: 1 } },
    }
    app = await createCoreApp(config, {
      manageShutdown: false, coreProductRouting: PRODUCT_ROUTING,
      sharedAuthCookieDomain: 'products.example',
    })
    app.get('/ok', async (request) => ({ hostname: request.hostname }))
    await app.ready()

    const spoofed = await app.inject({
      method: 'GET', url: '/ok',
      headers: { host: 'unknown.example', 'x-forwarded-host': 'legal.products.example' },
      remoteAddress: '192.168.255.251',
    })
    expect(spoofed.statusCode).toBe(421)

    const trusted = await app.inject({
      method: 'GET', url: '/ok',
      headers: { host: 'unknown.example', 'x-forwarded-host': 'legal.products.example' },
      remoteAddress: '192.168.255.250',
    })
    expect(trusted.statusCode).toBe(200)
    expect(trusted.json().hostname).toBe('legal.products.example')

    const multiValue = await app.inject({
      method: 'GET', url: '/ok',
      headers: { host: 'unknown.example', 'x-forwarded-host': 'legal.products.example, hostile.example' },
      remoteAddress: '192.168.255.250',
    })
    expect(multiValue.statusCode).toBe(421)
    expect(multiValue.json().code).toMatch(/unknown_product_hostname|invalid_product_hostname/)
  })

  it('rejects legacy-unsafe proxy trust in typed mode', async () => {
    const config: CoreConfig = {
      ...TEST_CONFIG,
      security: { csp: { enabled: false }, trustedProxy: 'legacy-unsafe' },
    }
    await expect(createCoreApp(config, {
      manageShutdown: false,
      coreProductRouting: PRODUCT_ROUTING,
      sharedAuthCookieDomain: 'products.example',
    })).rejects.toMatchObject({ code: ERROR_CODES.TYPED_DOMAIN_UNSAFE_PROXY })
  })

  it('fails unknown-host CORS preflights before CORS short-circuiting', async () => {
    app = await createCoreApp(TEST_CONFIG, {
      manageShutdown: false, coreProductRouting: PRODUCT_ROUTING,
      sharedAuthCookieDomain: 'products.example',
    })
    await app.ready()
    const response = await app.inject({
      method: 'OPTIONS', url: '/not-registered',
      headers: {
        host: 'unknown.example', origin: 'https://unknown.example',
        'access-control-request-method': 'GET',
      },
    })
    expect(response.statusCode).toBe(421)
    expect(response.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('rejects typed mode plus legacy scope before calling the resolver', async () => {
    const requestScopeResolver = vi.fn()
    await expect(createCoreApp(TEST_CONFIG, {
      manageShutdown: false, requestScopeResolver,
      coreProductRouting: PRODUCT_ROUTING, sharedAuthCookieDomain: 'products.example',
    })).rejects.toMatchObject({ code: ERROR_CODES.TYPED_DOMAIN_LEGACY_SCOPE_CONFLICT })
    expect(requestScopeResolver).not.toHaveBeenCalled()
  })

  it('rejects malformed or incomplete typed options instead of disabling them', async () => {
    await expect(createCoreApp(TEST_CONFIG, {
      manageShutdown: false,
      coreProductRouting: null as unknown as CoreProductRoutingConfig,
      sharedAuthCookieDomain: 'products.example',
    })).rejects.toMatchObject({ code: ERROR_CODES.INVALID_PRODUCT_ROUTING_CONFIG })

    await expect(createCoreApp(TEST_CONFIG, {
      manageShutdown: false, coreProductRouting: PRODUCT_ROUTING,
    })).rejects.toMatchObject({ code: ERROR_CODES.INVALID_SHARED_AUTH_COOKIE_DOMAIN })

    await expect(createCoreApp(TEST_CONFIG, {
      manageShutdown: false,
      sharedAuthCookieDomain: 'products.example',
    })).rejects.toMatchObject({ code: ERROR_CODES.INVALID_PRODUCT_ROUTING_CONFIG })
  })
})
