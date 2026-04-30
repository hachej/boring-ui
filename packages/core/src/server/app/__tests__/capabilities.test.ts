import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { createCoreApp } from '../createCoreApp'
import type { CoreConfig, CapabilitiesResponse } from '../../../shared/types'

const CORE_PACKAGE_VERSION = JSON.parse(
  readFileSync(new URL('../../../../package.json', import.meta.url), 'utf-8'),
) as { version: string }

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
  encryption: { workspaceSettingsKey: 'a'.repeat(64) },
  auth: {
    secret: 's'.repeat(64),
    url: 'http://localhost:3000',
    sessionTtlSeconds: 3600,
    sessionCookieSecure: false,
    mail: { from: 'noreply@test.dev', transportUrl: 'console://' },
  },
  features: { githubOauth: false, invitesEnabled: true, sendWelcomeEmail: true, inviteTtlDays: 7 },
}

let app: Awaited<ReturnType<typeof createCoreApp>> | null = null

afterEach(async () => {
  if (app) {
    await app.close()
    app = null
  }
})

describe('capabilities contributor API', () => {
  it('serves core capabilities at GET /api/v1/capabilities', async () => {
    app = await createCoreApp(TEST_CONFIG, { manageShutdown: false })
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/api/v1/capabilities' })
    const body = JSON.parse(res.body)

    expect(res.statusCode).toBe(200)
    expect(body.core).toBeDefined()
    expect(body.core.version).toBe(CORE_PACKAGE_VERSION.version)
    expect(body.core.features.invitesEnabled).toBe(true)
    expect(body.core.features.githubOauth).toBe(false)
    expect(body.core.features.emailFlows).toBe(true)
  })

  it('core.auth.github is false in v1', async () => {
    app = await createCoreApp(TEST_CONFIG, { manageShutdown: false })
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/api/v1/capabilities' })
    const body = JSON.parse(res.body)

    expect(body.core.auth.github).toBe(false)
    expect(body.core.auth.emailPassword).toBe(true)
    expect(body.core.auth.emailVerification).toBe(true)
    expect(body.core.auth.passwordReset).toBe(true)
    expect(body.core.auth.magicLink).toBe(true)
  })

  it('emailFlows and auth booleans are false when mail not configured', async () => {
    const noMailConfig: CoreConfig = {
      ...TEST_CONFIG,
      auth: { ...TEST_CONFIG.auth, mail: undefined },
    }
    app = await createCoreApp(noMailConfig, { manageShutdown: false })
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/api/v1/capabilities' })
    const body = JSON.parse(res.body)

    expect(body.core.features.emailFlows).toBe(false)
    expect(body.core.auth.emailVerification).toBe(false)
    expect(body.core.auth.passwordReset).toBe(false)
    expect(body.core.auth.magicLink).toBe(false)
    expect(body.core.auth.emailPassword).toBe(true)
  })

  it('registers additional contributors keyed by name', async () => {
    app = await createCoreApp(TEST_CONFIG, { manageShutdown: false })

    app.registerCapabilitiesContributor('agent', () => ({
      agent: {
        runtimeMode: 'local' as const,
        tools: ['shell', 'browser'],
        modelProviders: ['anthropic'],
      },
    }))

    app.registerCapabilitiesContributor('workspace', () => ({
      workspace: { panels: ['chat', 'data'] },
    }))

    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/api/v1/capabilities' })
    const body = JSON.parse(res.body)

    expect(body.core).toBeDefined()
    expect(body.agent.runtimeMode).toBe('local')
    expect(body.agent.tools).toEqual(['shell', 'browser'])
    expect(body.workspace.panels).toEqual(['chat', 'data'])
  })

  it('omits contributor key when not registered', async () => {
    app = await createCoreApp(TEST_CONFIG, { manageShutdown: false })
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/api/v1/capabilities' })
    const body = JSON.parse(res.body)

    expect(body.core).toBeDefined()
    expect(body.agent).toBeUndefined()
    expect(body.workspace).toBeUndefined()
  })

  it('memoizes — contributor fn called once across multiple requests', async () => {
    app = await createCoreApp(TEST_CONFIG, { manageShutdown: false })

    let callCount = 0
    app.registerCapabilitiesContributor('counter', () => {
      callCount++
      return { counter: callCount } as Partial<CapabilitiesResponse>
    })

    await app.ready()

    await app.inject({ method: 'GET', url: '/api/v1/capabilities' })
    await app.inject({ method: 'GET', url: '/api/v1/capabilities' })
    await app.inject({ method: 'GET', url: '/api/v1/capabilities' })

    expect(callCount).toBe(1)

    const res = await app.inject({ method: 'GET', url: '/api/v1/capabilities' })
    const body = JSON.parse(res.body)
    expect(body.counter).toBe(1)
  })

  it('populates capabilitiesCache on app.ready()', async () => {
    app = await createCoreApp(TEST_CONFIG, { manageShutdown: false })
    expect(app.capabilitiesCache).toBeNull()

    await app.ready()

    expect(app.capabilitiesCache).not.toBeNull()
    expect(app.capabilitiesCache!.core).toBeDefined()
  })
})
