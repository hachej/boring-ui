import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CoreConfig } from '../../../shared/types'
import { ERROR_CODES } from '../../../shared/errors'
import { createCoreApp } from '../createCoreApp'
import type { StaticProductDeclarationsInput } from '../../productDeclarations'

const TEST_CONFIG: CoreConfig = {
  appId: 'test-app',
  appName: 'Test App',
  appLogo: null,
  port: 0,
  host: '127.0.0.1',
  staticDir: null,
  databaseUrl: null,
  stores: 'local',
  cors: { origins: [], credentials: true },
  bodyLimit: 16 * 1024 * 1024,
  logLevel: 'silent' as CoreConfig['logLevel'],
  security: { csp: { enabled: false } },
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
}

const PRODUCT_DECLARATIONS: StaticProductDeclarationsInput = {
  domains: [{ hostname: 'legal.example', workspaceTypeId: 'contract-review' }],
  workspaceTypes: [{ workspaceTypeId: 'contract-review', agentTypeId: 'legal-reviewer' }],
  agentTypes: [{ agentTypeId: 'legal-reviewer', behavior: { instructions: 'Review.' } }],
}

let app: Awaited<ReturnType<typeof createCoreApp>> | null = null

afterEach(async () => {
  if (app) await app.close()
  app = null
})

function registerResolutionRoute(): void {
  app!.get('/resolution', async (request) => {
    return app!.staticProductDeclarations!.resolveDomain(request)
  })
}

describe('typed-domain request resolution', () => {
  it('is disabled by default and preserves localhost and preview host behavior', async () => {
    app = await createCoreApp(TEST_CONFIG, { manageShutdown: false })
    app.get('/ok', async (request) => ({ hostname: request.hostname }))
    await app.ready()

    for (const host of ['localhost:3000', 'pr-391.preview.example']) {
      const response = await app.inject({
        method: 'GET',
        url: '/ok',
        headers: {
          host,
          'x-forwarded-host': 'spoofed.example',
        },
        remoteAddress: '192.168.255.251',
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ hostname: host.split(':')[0] })
    }
    expect(app.staticProductDeclarations).toBeNull()
  })

  it('resolves only Fastify-derived exact hostnames when enabled', async () => {
    app = await createCoreApp(TEST_CONFIG, {
      manageShutdown: false,
      staticProductDeclarations: PRODUCT_DECLARATIONS,
    })
    registerResolutionRoute()
    await app.ready()

    const response = await app.inject({
      method: 'GET',
      url: '/resolution',
      headers: { host: 'LEGAL.EXAMPLE.:443' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      hostname: 'legal.example',
      workspaceTypeId: 'contract-review',
    })
  })

  it('fails an unknown host closed without falling back to a declared binding', async () => {
    app = await createCoreApp(TEST_CONFIG, {
      manageShutdown: false,
      staticProductDeclarations: PRODUCT_DECLARATIONS,
    })
    app.get('/ok', async () => ({ ok: true }))
    await app.ready()

    const response = await app.inject({
      method: 'GET',
      url: '/ok',
      headers: { host: 'unknown.example' },
    })

    expect(response.statusCode).toBe(421)
    expect(response.json()).toMatchObject({
      code: ERROR_CODES.UNKNOWN_PRODUCT_HOSTNAME,
      message: 'Unknown product hostname',
    })
  })

  it('ignores forwarded-host spoofing outside the explicit trustedProxy policy', async () => {
    const config: CoreConfig = {
      ...TEST_CONFIG,
      security: {
        csp: { enabled: false },
        trustedProxy: { cidrs: ['192.168.255.250/32'], hops: 1 },
      },
    }
    app = await createCoreApp(config, {
      manageShutdown: false,
      staticProductDeclarations: PRODUCT_DECLARATIONS,
    })
    app.get('/ok', async (request) => ({ hostname: request.hostname }))
    await app.ready()

    const spoofed = await app.inject({
      method: 'GET',
      url: '/ok',
      headers: {
        host: 'unknown.example',
        'x-forwarded-host': 'legal.example',
      },
      remoteAddress: '192.168.255.251',
    })
    expect(spoofed.statusCode).toBe(421)
    expect(spoofed.json().code).toBe(ERROR_CODES.UNKNOWN_PRODUCT_HOSTNAME)

    const trusted = await app.inject({
      method: 'GET',
      url: '/ok',
      headers: {
        host: 'unknown.example',
        'x-forwarded-host': 'legal.example',
      },
      remoteAddress: '192.168.255.250',
    })
    expect(trusted.statusCode).toBe(200)
    expect(trusted.json().hostname).toBe('legal.example')
  })

  it('fails unknown-host CORS preflights before plugin short-circuiting', async () => {
    app = await createCoreApp(TEST_CONFIG, {
      manageShutdown: false,
      staticProductDeclarations: PRODUCT_DECLARATIONS,
    })
    await app.ready()

    const response = await app.inject({
      method: 'OPTIONS',
      url: '/not-registered',
      headers: {
        host: 'unknown.example',
        origin: 'https://unknown.example',
        'access-control-request-method': 'GET',
      },
    })

    expect(response.statusCode).toBe(421)
    expect(response.json().code).toBe(ERROR_CODES.UNKNOWN_PRODUCT_HOSTNAME)
    expect(response.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('rejects typed mode plus the legacy resolver at startup with a stable code', async () => {
    const requestScopeResolver = vi.fn()

    await expect(createCoreApp(TEST_CONFIG, {
      manageShutdown: false,
      requestScopeResolver,
      staticProductDeclarations: PRODUCT_DECLARATIONS,
    })).rejects.toMatchObject({
      code: ERROR_CODES.TYPED_DOMAIN_LEGACY_SCOPE_CONFLICT,
    })
    expect(requestScopeResolver).not.toHaveBeenCalled()
  })

  it('rejects a present malformed typed-mode option instead of silently disabling it', async () => {
    await expect(createCoreApp(TEST_CONFIG, {
      manageShutdown: false,
      staticProductDeclarations: null as unknown as StaticProductDeclarationsInput,
    })).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_PRODUCT_DECLARATIONS,
    })
  })
})
