import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'

import { createCoreApp } from '../../app/createCoreApp.js'
import { registerRoutes } from '../../app/routes.js'
import { authHook } from '../../auth/authHook.js'
import { createAuth } from '../../auth/createAuth.js'
import { runMigrations } from '../../db/migrate.js'
import { PostgresMeteringStore } from '../../db/stores/PostgresMeteringStore.js'
import { PostgresUserStore } from '../../db/stores/PostgresUserStore.js'
import { PostgresWorkspaceStore } from '../../db/stores/PostgresWorkspaceStore.js'
import { outreachLeads } from '../../db/schema.js'
import { registerOutreachRoutes } from '../routes.js'
import { isAnonymousOutreachUser } from '../policy.js'
import type { CoreConfig } from '../../../shared/types.js'

const TEST_DB_URL = process.env.DATABASE_URL ?? 'postgres://ubuntu:test@localhost/boring_ui_test'
const APP_ID = `test-outreach-lifecycle-${process.pid}`
const ADMIN_EMAIL = `admin-${process.pid}@outreach-lifecycle.test`
const CLAIMED_EMAIL = `claimed-${process.pid}@outreach-lifecycle.test`

function makeConfig(): CoreConfig {
  return {
    appId: APP_ID,
    appName: 'Outreach Lifecycle Test',
    appLogo: null,
    port: 0,
    host: '127.0.0.1',
    staticDir: null,
    databaseUrl: TEST_DB_URL,
    stores: 'postgres',
    cors: { origins: ['http://localhost:3000'], credentials: true },
    bodyLimit: 16 * 1024 * 1024,
    logLevel: 'error',
    encryption: { workspaceSettingsKey: 'b'.repeat(64) },
    auth: {
      secret: 'o'.repeat(64),
      url: 'http://localhost:3000',
      sessionTtlSeconds: 3600,
      sessionCookieSecure: false,
    },
    features: {
      githubOauth: false,
      googleOauth: false,
      invitesEnabled: true,
      sendWelcomeEmail: false,
      inviteTtlDays: 7,
    },
  }
}

function cookieHeader(setCookie: string | string[] | undefined): string {
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []
  return values.map((cookie) => cookie.split(';')[0]).join('; ')
}

let sql: postgres.Sql
let app: Awaited<ReturnType<typeof createCoreApp>>
let restoreAdminEnv: string | undefined

beforeAll(async () => {
  const config = makeConfig()
  await runMigrations(config)
  sql = postgres(TEST_DB_URL, { max: 5 })
  const db = drizzle(sql)
  const userStore = new PostgresUserStore(db)
  const workspaceStore = new PostgresWorkspaceStore(db, config.encryption.workspaceSettingsKey)
  const meteringStore = new PostgresMeteringStore(db)
  const auth = createAuth(config, db, { workspaceStore, logger: { warn: () => {} } })

  restoreAdminEnv = process.env.BORING_OUTREACH_ADMIN_EMAILS
  process.env.BORING_OUTREACH_ADMIN_EMAILS = ADMIN_EMAIL

  app = await createCoreApp(config)
  app.decorate('db', db)
  app.decorate('auth', auth)
  app.decorate('userStore', userStore)
  app.decorate('workspaceStore', workspaceStore)
  app.decorate('isAnonymousOutreachUser', (appId: string, userId: string) => isAnonymousOutreachUser(db, appId, userId))

  app.all('/auth/*', async (request, reply) => {
    const webReq = new Request(`http://localhost:3000${request.url}`, {
      method: request.method,
      headers: request.headers as Record<string, string>,
      body: request.method !== 'GET' && request.method !== 'HEAD'
        ? JSON.stringify(request.body)
        : undefined,
    })
    const response = await auth.handler(webReq)
    const headers = response.headers as Headers & { getSetCookie?: () => string[] }
    const setCookies = typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : headers.get('set-cookie')
        ? [headers.get('set-cookie') as string]
        : []
    for (const [key, value] of response.headers.entries()) {
      if (key.toLowerCase() !== 'set-cookie') reply.header(key, value)
    }
    if (setCookies.length > 0) reply.header('set-cookie', setCookies)
    reply.status(response.status).send(await response.text())
  })

  await app.register(authHook)
  await app.register(registerRoutes, { sql, db, userStore, workspaceStore })
  await app.register(registerOutreachRoutes, { db, workspaceStore, creditGrantStore: meteringStore })
})

afterAll(async () => {
  process.env.BORING_OUTREACH_ADMIN_EMAILS = restoreAdminEnv
  await app?.close()
  if (sql) {
    await sql`DELETE FROM boring_credit_grants WHERE user_id IN (SELECT id::text FROM users WHERE email IN (${ADMIN_EMAIL}, ${CLAIMED_EMAIL}) OR email LIKE '%@anonymous.invalid')`
    await sql`DELETE FROM outreach_leads WHERE app_id = ${APP_ID}`
    await sql`DELETE FROM outreach_links WHERE app_id = ${APP_ID}`
    await sql`DELETE FROM outreach_experiences WHERE app_id = ${APP_ID}`
    await sql`DELETE FROM workspace_members WHERE workspace_id IN (SELECT id FROM workspaces WHERE app_id = ${APP_ID})`
    await sql`DELETE FROM workspace_runtimes WHERE workspace_id IN (SELECT id FROM workspaces WHERE app_id = ${APP_ID})`
    await sql`DELETE FROM user_settings WHERE app_id = ${APP_ID}`
    await sql`DELETE FROM workspaces WHERE app_id = ${APP_ID}`
    await sql`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email IN (${ADMIN_EMAIL}, ${CLAIMED_EMAIL}) OR email LIKE '%@anonymous.invalid')`
    await sql`DELETE FROM accounts WHERE user_id IN (SELECT id FROM users WHERE email IN (${ADMIN_EMAIL}, ${CLAIMED_EMAIL}) OR email LIKE '%@anonymous.invalid')`
    await sql`DELETE FROM users WHERE email IN (${ADMIN_EMAIL}, ${CLAIMED_EMAIL}) OR email LIKE '%@anonymous.invalid'`
    await sql.end()
  }
})

describe('outreach lifecycle', () => {
  it('creates an outreach URL, opens it as an anonymous lead, then claims it through signup', async () => {
    const adminSignup = await app.inject({
      method: 'POST',
      url: '/auth/sign-up/email',
      payload: { name: 'Admin', email: ADMIN_EMAIL, password: 'Zk8$mN!qR2xFgWpJ' },
    })
    expect(adminSignup.statusCode).toBeLessThan(300)
    const adminCookie = cookieHeader(adminSignup.headers['set-cookie'])
    expect(adminCookie).toContain(APP_ID)

    const db = drizzle(sql)
    const workspaceStore = new PostgresWorkspaceStore(db, 'b'.repeat(64))
    const adminMe = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: adminCookie } })
    const adminUserId = (adminMe.json() as { user: { id: string } }).user.id
    const templateWorkspace = await workspaceStore.create(adminUserId, 'Outreach Template', APP_ID)

    const unsupportedExperienceRes = await app.inject({
      method: 'POST',
      url: '/api/v1/outreach/experiences',
      headers: { cookie: adminCookie },
      payload: {
        name: 'Unsupported clone demo',
        provisioningMode: 'clone_per_lead',
        templateWorkspaceId: templateWorkspace.id,
        defaultTargetPath: '/workspace/:workspaceId',
      },
    })
    expect(unsupportedExperienceRes.statusCode).toBe(400)

    const experienceRes = await app.inject({
      method: 'POST',
      url: '/api/v1/outreach/experiences',
      headers: { cookie: adminCookie },
      payload: {
        name: 'Lifecycle demo',
        provisioningMode: 'shared_readonly',
        templateWorkspaceId: templateWorkspace.id,
        defaultTargetPath: '/workspace/:workspaceId',
      },
    })
    expect(experienceRes.statusCode).toBe(201)
    const experienceId = experienceRes.json().experience.id as string

    const linkRes = await app.inject({
      method: 'POST',
      url: '/api/v1/outreach-links',
      headers: { cookie: adminCookie },
      payload: { experienceId, recipientHint: 'cold-lead', ttlHours: 24 },
    })
    expect(linkRes.statusCode).toBe(201)
    const outreachUrl = linkRes.json().link.url as string
    const outreachPath = new URL(outreachUrl).pathname
    expect(outreachPath).toMatch(/^\/o\//)

    const openRes = await app.inject({ method: 'GET', url: outreachPath })
    expect(openRes.statusCode).toBe(302)
    expect(openRes.headers.location).toBe(`/workspace/${templateWorkspace.id}`)
    const anonymousCookie = cookieHeader(openRes.headers['set-cookie'])
    expect(anonymousCookie).toContain(APP_ID)

    const anonymousMe = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: anonymousCookie } })
    expect(anonymousMe.statusCode).toBe(200)
    expect(anonymousMe.json().user).toMatchObject({ email: null, name: 'Anonymous lead', isAnonymousLead: true })
    const anonymousUserId = anonymousMe.json().user.id as string

    const [anonymousLead] = await db
      .select()
      .from(outreachLeads)
      .where(eq(outreachLeads.userId, anonymousUserId))
      .limit(1)
    expect(anonymousLead).toMatchObject({ status: 'anonymous', provisioningStatus: 'provisioned' })

    const claimRes = await app.inject({
      method: 'POST',
      url: '/auth/sign-up/email',
      headers: { cookie: anonymousCookie },
      payload: { name: 'Claimed Lead', email: CLAIMED_EMAIL, password: 'Zk8$mN!qR2xFgWpJ' },
    })
    expect(claimRes.statusCode).toBeLessThan(300)

    const [claimedLead] = await db
      .select()
      .from(outreachLeads)
      .where(eq(outreachLeads.id, anonymousLead.id))
      .limit(1)
    expect(claimedLead.status).toBe('claimed')
    expect(claimedLead.userId).not.toBe(anonymousUserId)
    expect(claimedLead.claimedEmail).toBe(CLAIMED_EMAIL)

    const memberRows = await sql<{ user_id: string; role: string }[]>`
      SELECT user_id, role FROM workspace_members WHERE workspace_id = ${templateWorkspace.id}
    `
    expect(memberRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ user_id: claimedLead.userId, role: 'viewer' }),
    ]))
    expect(memberRows.some((row) => row.user_id === anonymousUserId)).toBe(false)
  })
})
