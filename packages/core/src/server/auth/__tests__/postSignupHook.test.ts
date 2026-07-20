import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { createAuth } from '../createAuth'
import type { TelemetryEvent } from '../../../shared/telemetry'
import { authHook } from '../authHook'
import { registerErrorHandler } from '../../app/errorHandler'
import { runMigrations } from '../../db/migrate'
import { PostgresWorkspaceStore } from '../../db/stores/PostgresWorkspaceStore'
import { PostgresUserStore } from '../../db/stores/PostgresUserStore'
import type { CoreConfig } from '../../../shared/types'

const TEST_DB_URL = process.env.DATABASE_URL ?? 'postgres://ubuntu:test@localhost/boring_ui_test'
const MAIL_CAPTURE_PATH = `/tmp/post-signup-test-mail-${process.pid}.log`

function makeConfig(overrides?: Partial<CoreConfig>): CoreConfig {
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
    features: { githubOauth: false, googleOauth: false, invitesEnabled: true, sendWelcomeEmail: true, inviteTtlDays: 7 },
    ...overrides,
  }
}

let rawSql: postgres.Sql
let workspaceStore: PostgresWorkspaceStore

beforeAll(async () => {
  const config = makeConfig()
  await runMigrations(config)
  rawSql = postgres(TEST_DB_URL, { max: 5 })
  const db = drizzle(rawSql)
  workspaceStore = new PostgresWorkspaceStore(db, config.encryption.workspaceSettingsKey)
})

afterAll(async () => {
  await rawSql`DELETE FROM workspace_members WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@post-signup-test.dev')`
  await rawSql`DELETE FROM workspace_invites WHERE workspace_id IN (SELECT id FROM workspaces WHERE created_by IN (SELECT id FROM users WHERE email LIKE '%@post-signup-test.dev'))`
  await rawSql`DELETE FROM workspace_runtimes WHERE workspace_id IN (SELECT id FROM workspaces WHERE created_by IN (SELECT id FROM users WHERE email LIKE '%@post-signup-test.dev'))`
  await rawSql`DELETE FROM user_settings WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@post-signup-test.dev')`
  await rawSql`DELETE FROM workspaces WHERE created_by IN (SELECT id FROM users WHERE email LIKE '%@post-signup-test.dev')`
  await rawSql`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@post-signup-test.dev')`
  await rawSql`DELETE FROM accounts WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@post-signup-test.dev')`
  await rawSql`DELETE FROM verification_tokens WHERE 1=1`
  await rawSql`DELETE FROM users WHERE email LIKE '%@post-signup-test.dev'`
  await rawSql.end()
})

function buildApp(config: CoreConfig, telemetry?: { capture: (e: TelemetryEvent) => void }) {
  const db = drizzle(rawSql)
  const auth = createAuth(config, db, {
    workspaceStore,
    logger: { warn: () => {} },
    telemetry,
  })

  const app = Fastify({ logger: false })
  app.decorate('config', config)
  app.decorate('auth', auth)

  registerErrorHandler(app)

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

  return { app, auth }
}

describe('post-signup hook — default workspace', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    const config = makeConfig()
    const built = buildApp(config)
    app = built.app
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('creates a default workspace named "Default workspace" on signup', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/sign-up/email',
      payload: {
        name: 'Default WS User',
        email: 'default-ws@post-signup-test.dev',
        password: 'Zk8$mN!qR2xFgWpJ',
      },
    })

    expect(res.statusCode).toBe(200)

    const userId = JSON.parse(res.body)?.user?.id
    expect(userId).toBeDefined()

    const workspaces = await workspaceStore.list(userId, 'test-app')
    expect(workspaces).toHaveLength(1)
    expect(workspaces[0].name).toBe('Default workspace')
    expect(workspaces[0].isDefault).toBe(true)
    expect(workspaces[0].workspaceTypeId).toBe('default')
  })
})

describe('post-signup hook — invite acceptance', () => {
  let app: FastifyInstance
  let inviterUserId: string

  beforeAll(async () => {
    const config = makeConfig()
    const built = buildApp(config)
    app = built.app
    await app.ready()

    const inviterRes = await app.inject({
      method: 'POST',
      url: '/auth/sign-up/email',
      payload: {
        name: 'Inviter',
        email: 'inviter@post-signup-test.dev',
        password: 'Zk8$mN!qR2xFgWpJ',
      },
    })
    inviterUserId = JSON.parse(inviterRes.body)?.user?.id
  })

  afterAll(async () => {
    await app.close()
  })

  it('accepts a valid invite and skips default workspace creation', async () => {
    const inviterWorkspaces = await workspaceStore.list(inviterUserId, 'test-app')
    const wsId = inviterWorkspaces[0].id

    const { rawToken } = await workspaceStore.createInvite(
      wsId,
      'invitee@post-signup-test.dev',
      'editor',
      inviterUserId,
    )

    const res = await app.inject({
      method: 'POST',
      url: '/auth/sign-up/email',
      headers: { 'x-invite-token': rawToken },
      payload: {
        name: 'Invitee',
        email: 'invitee@post-signup-test.dev',
        password: 'Zk8$mN!qR2xFgWpJ',
      },
    })

    expect(res.statusCode).toBe(200)
    const inviteeId = JSON.parse(res.body)?.user?.id

    const inviteeWorkspaces = await workspaceStore.list(inviteeId, 'test-app')
    expect(inviteeWorkspaces).toHaveLength(1)
    expect(inviteeWorkspaces[0].id).toBe(wsId)

    const role = await workspaceStore.getMemberRole(wsId, inviteeId)
    expect(role).toBe('editor')
  })

  it('sets boring_invite_failed cookie on expired invite', async () => {
    const inviterWorkspaces = await workspaceStore.list(inviterUserId, 'test-app')
    const wsId = inviterWorkspaces[0].id

    const { rawToken } = await workspaceStore.createInvite(
      wsId,
      'expired-invitee@post-signup-test.dev',
      'viewer',
      inviterUserId,
    )

    await rawSql`
      UPDATE workspace_invites
      SET expires_at = NOW() - INTERVAL '1 day'
      WHERE token_hash = encode(digest(${rawToken}, 'sha256'), 'hex')
    `

    const res = await app.inject({
      method: 'POST',
      url: '/auth/sign-up/email',
      headers: { 'x-invite-token': rawToken },
      payload: {
        name: 'Expired Invitee',
        email: 'expired-invitee@post-signup-test.dev',
        password: 'Zk8$mN!qR2xFgWpJ',
      },
    })

    expect(res.statusCode).toBe(200)

    const setCookie = res.headers['set-cookie']
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie ?? '']
    const failedCookie = cookies.find((c) => c.includes('boring_invite_failed'))
    expect(failedCookie).toBeDefined()
    expect(failedCookie).toContain('invite_expired')
    expect(failedCookie).toContain('Max-Age=60')

    const inviteeId = JSON.parse(res.body)?.user?.id
    const inviteeWorkspaces = await workspaceStore.list(inviteeId, 'test-app')
    expect(inviteeWorkspaces).toHaveLength(1)
    expect(inviteeWorkspaces[0].name).toBe('Default workspace')
  })

  it('sets boring_invite_failed cookie on email mismatch', async () => {
    const inviterWorkspaces = await workspaceStore.list(inviterUserId, 'test-app')
    const wsId = inviterWorkspaces[0].id

    const { rawToken } = await workspaceStore.createInvite(
      wsId,
      'someone-else@post-signup-test.dev',
      'editor',
      inviterUserId,
    )

    const res = await app.inject({
      method: 'POST',
      url: '/auth/sign-up/email',
      headers: { 'x-invite-token': rawToken },
      payload: {
        name: 'Wrong Email',
        email: 'wrong-email@post-signup-test.dev',
        password: 'Zk8$mN!qR2xFgWpJ',
      },
    })

    expect(res.statusCode).toBe(200)

    const setCookie = res.headers['set-cookie']
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie ?? '']
    const failedCookie = cookies.find((c) => c.includes('boring_invite_failed'))
    expect(failedCookie).toBeDefined()
    expect(failedCookie).toContain('invite_email_mismatch')
  })

  it('sets boring_invite_failed cookie when token not found', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/sign-up/email',
      headers: { 'x-invite-token': 'nonexistent-token-12345' },
      payload: {
        name: 'Bad Token User',
        email: 'bad-token@post-signup-test.dev',
        password: 'Zk8$mN!qR2xFgWpJ',
      },
    })

    expect(res.statusCode).toBe(200)

    const setCookie = res.headers['set-cookie']
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie ?? '']
    const failedCookie = cookies.find((c) => c.includes('boring_invite_failed'))
    expect(failedCookie).toBeDefined()
    expect(failedCookie).toContain('invite_not_found')

    const inviteeId = JSON.parse(res.body)?.user?.id
    const inviteeWorkspaces = await workspaceStore.list(inviteeId, 'test-app')
    expect(inviteeWorkspaces).toHaveLength(1)
    expect(inviteeWorkspaces[0].name).toBe('Default workspace')
  })

  it('sets boring_invite_failed cookie on already-accepted invite', async () => {
    const inviterWorkspaces = await workspaceStore.list(inviterUserId, 'test-app')
    const wsId = inviterWorkspaces[0].id

    const { rawToken } = await workspaceStore.createInvite(
      wsId,
      'already-accepted@post-signup-test.dev',
      'editor',
      inviterUserId,
    )

    await rawSql`
      UPDATE workspace_invites
      SET accepted_at = NOW()
      WHERE token_hash = encode(digest(${rawToken}, 'sha256'), 'hex')
    `

    const res = await app.inject({
      method: 'POST',
      url: '/auth/sign-up/email',
      headers: { 'x-invite-token': rawToken },
      payload: {
        name: 'Already Accepted',
        email: 'already-accepted@post-signup-test.dev',
        password: 'Zk8$mN!qR2xFgWpJ',
      },
    })

    expect(res.statusCode).toBe(200)

    const setCookie = res.headers['set-cookie']
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie ?? '']
    const failedCookie = cookies.find((c) => c.includes('boring_invite_failed'))
    expect(failedCookie).toBeDefined()
    expect(failedCookie).toContain('invite_already_accepted')
  })
})

describe('auth telemetry', () => {
  let app: FastifyInstance
  const events: TelemetryEvent[] = []

  beforeAll(async () => {
    const built = buildApp(makeConfig(), { capture: (e) => { events.push(e) } })
    app = built.app
    await app.ready()
  })
  afterAll(async () => { await app.close() })

  it('emits auth.signed_up (and auth.session_started) on signup — user id only, no PII', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/sign-up/email',
      payload: { name: 'Telemetry User', email: 'telemetry@post-signup-test.dev', password: 'Zk8$mN!qR2xFgWpJ' },
    })
    expect(res.statusCode).toBe(200)
    const userId = JSON.parse(res.body)?.user?.id

    const signup = events.find((e) => e.name === 'auth.signed_up')
    expect(signup?.distinctId).toBe(userId)
    // The sign-up also mints a session.
    expect(events.some((e) => e.name === 'auth.session_started' && e.distinctId === userId)).toBe(true)
    // No raw email anywhere in the telemetry.
    expect(JSON.stringify(events)).not.toContain('telemetry@')
    expect(signup?.properties).toBeUndefined()
  })
})
