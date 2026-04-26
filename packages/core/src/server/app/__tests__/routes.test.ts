import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { drizzle } from 'drizzle-orm/postgres-js'
import { createAuth } from '../../auth/createAuth'
import { authHook } from '../../auth/authHook'
import { registerErrorHandler } from '../errorHandler'
import { registerCapabilities } from '../capabilities'
import { registerRoutes } from '../routes'
import { runMigrations } from '../../db/migrate'
import { PostgresUserStore } from '../../db/stores/PostgresUserStore'
import type { CoreConfig } from '../../../shared/types'
import postgres from 'postgres'

const TEST_DB_URL = 'postgres://ubuntu:test@localhost/boring_ui_test'
const MAIL_CAPTURE_PATH = `/tmp/routes-test-mail-${process.pid}.log`

function makeConfig(): CoreConfig {
  return {
    appId: 'test-app',
    appName: 'Test App',
    appLogo: null,
    port: 0,
    host: '127.0.0.1',
    staticDir: null,
    databaseUrl: TEST_DB_URL,
    stores: 'postgres',
    cors: { origins: ['http://localhost:3000'], credentials: true },
    bodyLimit: 16 * 1024 * 1024,
    logLevel: 'silent' as CoreConfig['logLevel'],
    encryption: { workspaceSettingsKey: 'a'.repeat(64) },
    auth: {
      secret: 's'.repeat(64),
      url: 'http://localhost:3000',
      sessionTtlSeconds: 3600,
      sessionCookieSecure: false,
      mail: {
        from: 'noreply@test.dev',
        transportUrl: `console-capture://${MAIL_CAPTURE_PATH}`,
      },
    },
    features: { githubOauth: false, invitesEnabled: true },
  }
}

let app: FastifyInstance
let rawSql: postgres.Sql
let sessionCookie: string

beforeAll(async () => {
  const config = makeConfig()
  await runMigrations(config)
  rawSql = postgres(TEST_DB_URL, { max: 5 })
  const db = drizzle(rawSql)

  const auth = createAuth(config, db)
  const userStore = new PostgresUserStore(db)

  app = Fastify({ logger: false })
  app.decorate('config', config)
  app.decorate('auth', auth)

  registerErrorHandler(app)
  registerCapabilities(app)
  await app.register(authHook)
  await app.register(registerRoutes, { sql: rawSql, userStore })

  app.all('/auth/*', async (request, reply) => {
    const url = `http://localhost:3000${request.url}`
    const webReq = new Request(url, {
      method: request.method,
      headers: request.headers as Record<string, string>,
      body: request.method !== 'GET' && request.method !== 'HEAD'
        ? JSON.stringify(request.body)
        : undefined,
    })
    const res = await auth.handler(webReq)
    const headers = Object.fromEntries(res.headers.entries())
    reply.status(res.status).headers(headers).send(await res.text())
  })

  await app.ready()

  const signupRes = await app.inject({
    method: 'POST',
    url: '/auth/sign-up/email',
    payload: {
      name: 'Routes Test User',
      email: 'routes-test@routes-test.dev',
      password: 'Zk8$mN!qR2xFgWpJ',
    },
  })

  const setCookie = signupRes.headers['set-cookie']
  if (setCookie) {
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie]
    sessionCookie = cookies.map((c) => c.split(';')[0]).join('; ')
  }
})

afterAll(async () => {
  await app.close()
  await rawSql`DELETE FROM user_settings WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@routes-test.dev')`
  await rawSql`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@routes-test.dev')`
  await rawSql`DELETE FROM accounts WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@routes-test.dev')`
  await rawSql`DELETE FROM verification_tokens WHERE 1=1`
  await rawSql`DELETE FROM users WHERE email LIKE '%@routes-test.dev'`
  await rawSql.end()
})

describe('GET /health', () => {
  it('returns 200 with ok:true when DB is reachable', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })
})

describe('GET /health (db unreachable)', () => {
  it('returns 503 when DB ping fails', async () => {
    const config = makeConfig()
    const badSql = postgres('postgres://ubuntu:test@localhost:59999/nonexistent', {
      connect_timeout: 1,
    })

    const badApp = Fastify({ logger: false })
    badApp.decorate('config', config)
    registerErrorHandler(badApp)

    const { LocalUserStore } = await import('../../db/stores/LocalUserStore')
    await badApp.register(registerRoutes, { sql: badSql, userStore: new LocalUserStore() })
    await badApp.ready()

    const res = await badApp.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(503)
    const body = res.json()
    expect(body.error).toBe('db_unavailable')
    expect(body.code).toBe('db_unavailable')
    expect(typeof body.message).toBe('string')
    expect(body.message.length).toBeGreaterThan(0)
    expect(typeof body.requestId).toBe('string')

    await badApp.close()
    await badSql.end()
  })

  it('returns 503 within ~3s when DB ping times out', async () => {
    const config = makeConfig()

    const slowSql = (async (
      _strings: TemplateStringsArray,
      ..._params: unknown[]
    ) => {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 10_000)
        timer.unref?.()
      })
      return []
    }) as unknown as postgres.Sql

    const timeoutApp = Fastify({ logger: false })
    timeoutApp.decorate('config', config)
    registerErrorHandler(timeoutApp)

    const { LocalUserStore } = await import('../../db/stores/LocalUserStore')
    await timeoutApp.register(registerRoutes, { sql: slowSql, userStore: new LocalUserStore() })
    await timeoutApp.ready()

    const startedAt = Date.now()
    const res = await timeoutApp.inject({ method: 'GET', url: '/health' })
    const elapsedMs = Date.now() - startedAt

    expect(res.statusCode).toBe(503)
    const body = res.json()
    expect(body.code).toBe('db_unavailable')
    expect(body.message).toContain('timed out')
    expect(typeof body.requestId).toBe('string')
    expect(elapsedMs).toBeLessThan(3_100)

    await timeoutApp.close()
  })
})

describe('GET /api/v1/config', () => {
  it('returns runtime config without secrets', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/config' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toEqual({
      appId: 'test-app',
      appName: 'Test App',
      appLogo: null,
      apiBase: 'http://localhost:3000',
      features: { githubOauth: false, invitesEnabled: true },
    })
    expect(body.auth).toBeUndefined()
    expect(body.databaseUrl).toBeUndefined()
    expect(body.encryption).toBeUndefined()
  })
})

describe('GET /api/v1/me', () => {
  it('returns 401 without session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/me' })
    expect(res.statusCode).toBe(401)
    expect(res.json().code).toBe('unauthorized')
  })

  it('returns user and settings with valid session', async () => {
    expect(sessionCookie).toBeDefined()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: sessionCookie },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.user).toBeDefined()
    expect(body.user.email).toBe('routes-test@routes-test.dev')
    expect(body.user.id).toBeDefined()
    expect(body.settings).toBeDefined()
    expect(body.settings).toHaveProperty('displayName')
    expect(body.settings).toHaveProperty('email')
    expect(body.settings).toHaveProperty('settings')
  })
})

describe('PUT /api/v1/me/settings', () => {
  it('returns 401 without session', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/me/settings',
      payload: { displayName: 'New Name' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('updates displayName', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/me/settings',
      headers: { cookie: sessionCookie },
      payload: { displayName: 'Updated Name' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.displayName).toBe('Updated Name')
  })

  it('updates arbitrary settings', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/me/settings',
      headers: { cookie: sessionCookie },
      payload: { settings: { theme: 'dark', locale: 'en-US' } },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().settings).toEqual({ theme: 'dark', locale: 'en-US' })
  })

  it('rejects email field (strict schema)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/me/settings',
      headers: { cookie: sessionCookie },
      payload: { email: 'hacker@evil.com', displayName: 'Sneaky' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('validation_failed')
  })

  it('rejects unknown fields', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/me/settings',
      headers: { cookie: sessionCookie },
      payload: { role: 'admin' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('validation_failed')
  })

  it('persists settings across reads', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/v1/me/settings',
      headers: { cookie: sessionCookie },
      payload: { displayName: 'Persisted', settings: { color: 'blue' } },
    })

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: sessionCookie },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.settings.displayName).toBe('Persisted')
    expect(body.settings.settings).toEqual({ color: 'blue' })
  })
})

describe('GET /api/v1/capabilities', () => {
  it('returns capabilities with core contributor', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/capabilities',
      headers: { cookie: sessionCookie },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.core).toBeDefined()
    expect(body.core.version).toBeDefined()
    expect(body.core.features).toBeDefined()
    expect(body.core.auth).toBeDefined()
    expect(body.core.auth.emailPassword).toBe(true)
    expect(body.core.features.emailFlows).toBe(true)
  })

  it('returns 401 without session', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/capabilities',
    })
    expect(res.statusCode).toBe(401)
  })
})
