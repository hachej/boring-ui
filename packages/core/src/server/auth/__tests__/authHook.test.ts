import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { authHook } from '../authHook'
import { createAuth } from '../createAuth'
import { runMigrations } from '../../db/migrate'
import { createDatabase } from '../../db/connection'
import type { CoreConfig } from '../../../shared/types'
import type { Database } from '../../db/connection'
import { registerErrorHandler } from '../../app/errorHandler'
import postgres from 'postgres'

const TEST_DB_URL = 'postgres://ubuntu:test@localhost/boring_ui_test'
const MAIL_CAPTURE_PATH = `/tmp/auth-hook-test-mail-${process.pid}.log`

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
    features: { githubOauth: false, invitesEnabled: true, sendWelcomeEmail: true, inviteTtlDays: 7 },
  }
}

let app: FastifyInstance
let rawSql: postgres.Sql
let sessionCookie: string

beforeAll(async () => {
  const config = makeConfig()
  await runMigrations(config)
  const conn = createDatabase(config)
  const db = conn.db
  rawSql = conn.sql

  const auth = createAuth(config, db)

  app = Fastify({ logger: false })
  app.decorate('config', config)
  app.decorate('auth', auth)

  registerErrorHandler(app)
  await app.register(authHook)

  app.get('/health', async () => ({ status: 'ok' }))
  app.get('/api/v1/config', async () => ({ appId: 'test-app' }))
  app.get('/api/v1/me', async (request) => ({
    user: request.user,
  }))

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
      name: 'Hook Test User',
      email: 'hook-test@auth-test.dev',
      password: 'Zk8$mN!qR2xFgWpJ',
    },
  })

  const setCookie = signupRes.headers['set-cookie']
  if (setCookie) {
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie]
    sessionCookie = cookies
      .map((c) => c.split(';')[0])
      .join('; ')
  }
})

afterAll(async () => {
  await app.close()
  await rawSql`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@auth-test.dev')`
  await rawSql`DELETE FROM accounts WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@auth-test.dev')`
  await rawSql`DELETE FROM verification_tokens WHERE 1=1`
  await rawSql`DELETE FROM users WHERE email LIKE '%@auth-test.dev'`
  await rawSql.end()
})

describe('authHook', () => {
  it('public path /health returns 200 without session', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })

  it('public path /api/v1/config returns 200 without session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/config' })
    expect(res.statusCode).toBe(200)
  })

  it('private path /api/v1/me returns 401 without session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/me' })
    expect(res.statusCode).toBe(401)
    const body = res.json()
    expect(body.code).toBe('unauthorized')
  })

  it('private path with valid session returns user', async () => {
    expect(sessionCookie).toBeDefined()

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: sessionCookie },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.user).toBeDefined()
    expect(body.user.email).toBe('hook-test@auth-test.dev')
    expect(body.user.id).toBeDefined()
  })

  it('auth paths are public (bypass hook)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth/get-session',
    })
    expect(res.statusCode).not.toBe(401)
  })
})

describe('authHook with custom public patterns', () => {
  let customApp: FastifyInstance

  beforeAll(async () => {
    const config = makeConfig()
    const conn = createDatabase(config)
    const auth = createAuth(config, conn.db)

    customApp = Fastify({ logger: false })
    customApp.decorate('config', config)
    customApp.decorate('auth', auth)

    registerErrorHandler(customApp)
    await customApp.register(authHook, {
      public: [/^\/auth\//, /^\/health$/, /^\/api\/v1\/config$/, /^\/api\/v1\/public/],
    })

    customApp.get('/api/v1/public/data', async () => ({ data: 'open' }))
    customApp.get('/api/v1/secret', async (request) => ({ user: request.user }))

    await customApp.ready()
  })

  afterAll(async () => {
    await customApp.close()
  })

  it('custom public pattern is honored', async () => {
    const res = await customApp.inject({ method: 'GET', url: '/api/v1/public/data' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: 'open' })
  })

  it('non-public path still requires auth', async () => {
    const res = await customApp.inject({ method: 'GET', url: '/api/v1/secret' })
    expect(res.statusCode).toBe(401)
  })
})
