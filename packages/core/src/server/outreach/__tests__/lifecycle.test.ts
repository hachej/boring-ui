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
import { createOutreachAuthIdentityAdapter } from '../identity.js'
import { ERROR_CODES, HttpError } from '../../../shared/errors.js'

const TEST_DB_URL = process.env.DATABASE_URL ?? 'postgres://ubuntu:test@localhost/boring_ui_test'
const APP_ID = `test-outreach-lifecycle-${process.pid}`
const ADMIN_EMAIL = `admin-${process.pid}@outreach-lifecycle.test`
const CLAIMED_EMAIL = `claimed-${process.pid}@outreach-lifecycle.test`
const TEST_EMAIL_PATTERN = `%${process.pid}%@outreach-lifecycle.test`
const TEST_PASSWORD = 'Zk8$mN!qR2xFgWpJ'

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

async function getAdminCookie(): Promise<string> {
  const signup = await app.inject({
    method: 'POST',
    url: '/auth/sign-up/email',
    payload: { name: 'Admin', email: ADMIN_EMAIL, password: TEST_PASSWORD },
  })
  if (signup.statusCode < 300) return cookieHeader(signup.headers['set-cookie'])

  const signin = await app.inject({
    method: 'POST',
    url: '/auth/sign-in/email',
    payload: { email: ADMIN_EMAIL, password: TEST_PASSWORD },
  })
  expect(signin.statusCode).toBeLessThan(300)
  return cookieHeader(signin.headers['set-cookie'])
}

async function createOutreachFixture(input: {
  maxLeads?: number | null
  ttlHours?: number
  initialCreditMicros?: number
} = {}): Promise<{
  adminCookie: string
  templateWorkspaceId: string
  outreachPath: string
  experienceId: string
  linkId: string
}> {
  const cookie = await getAdminCookie()
  const db = drizzle(sql)
  const workspaceStore = new PostgresWorkspaceStore(db, 'b'.repeat(64))
  const adminMe = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } })
  const adminUserId = (adminMe.json() as { user: { id: string } }).user.id
  const templateWorkspace = await workspaceStore.create(adminUserId, `Outreach Template ${Date.now()}`, APP_ID)

  const experienceRes = await app.inject({
    method: 'POST',
    url: '/api/v1/outreach/experiences',
    headers: { cookie },
    payload: {
      name: `Lifecycle demo ${Date.now()}`,
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
    headers: { cookie },
    payload: {
      experienceId,
      recipientHint: 'cold-lead',
      ttlHours: input.ttlHours ?? 24,
      ...(input.maxLeads !== undefined ? { maxLeads: input.maxLeads } : {}),
      ...(input.initialCreditMicros !== undefined ? { initialCreditMicros: input.initialCreditMicros } : {}),
    },
  })
  expect(linkRes.statusCode).toBe(201)
  const link = linkRes.json().link as { id: string; url: string }

  return {
    adminCookie: cookie,
    templateWorkspaceId: templateWorkspace.id,
    outreachPath: new URL(link.url).pathname,
    experienceId,
    linkId: link.id,
  }
}

function claimedEmail(suffix: string): string {
  return `claimed-${suffix}-${process.pid}-${Date.now()}@outreach-lifecycle.test`
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
    await sql`DELETE FROM boring_credit_grants WHERE user_id IN (SELECT id::text FROM users WHERE email LIKE ${TEST_EMAIL_PATTERN} OR email LIKE '%@anonymous.invalid')`
    await sql`DELETE FROM outreach_leads WHERE app_id = ${APP_ID}`
    await sql`DELETE FROM outreach_links WHERE app_id = ${APP_ID}`
    await sql`DELETE FROM outreach_experiences WHERE app_id = ${APP_ID}`
    await sql`DELETE FROM workspace_members WHERE workspace_id IN (SELECT id FROM workspaces WHERE app_id = ${APP_ID})`
    await sql`DELETE FROM workspace_runtimes WHERE workspace_id IN (SELECT id FROM workspaces WHERE app_id = ${APP_ID})`
    await sql`DELETE FROM user_settings WHERE app_id = ${APP_ID}`
    await sql`DELETE FROM workspaces WHERE app_id = ${APP_ID}`
    await sql`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE ${TEST_EMAIL_PATTERN} OR email LIKE '%@anonymous.invalid')`
    await sql`DELETE FROM accounts WHERE user_id IN (SELECT id FROM users WHERE email LIKE ${TEST_EMAIL_PATTERN} OR email LIKE '%@anonymous.invalid')`
    await sql`DELETE FROM users WHERE email LIKE ${TEST_EMAIL_PATTERN} OR email LIKE '%@anonymous.invalid'`
    await sql.end()
  }
})

describe('outreach lifecycle', () => {
  it('creates an outreach URL, opens it as an anonymous lead, then claims it through signup', async () => {
    const adminCookie = await getAdminCookie()
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
    expect(unsupportedExperienceRes.json()).toMatchObject({ code: 'validation_failed' })

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
      payload: { name: 'Claimed Lead', email: CLAIMED_EMAIL, password: TEST_PASSWORD },
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

  it('lets the same anonymous lead resume after maxLeads capacity is reached', async () => {
    const { outreachPath, templateWorkspaceId } = await createOutreachFixture({ maxLeads: 1 })

    const firstOpen = await app.inject({ method: 'GET', url: outreachPath })
    expect(firstOpen.statusCode).toBe(302)
    expect(firstOpen.headers.location).toBe(`/workspace/${templateWorkspaceId}`)
    const anonymousCookie = cookieHeader(firstOpen.headers['set-cookie'])
    expect(anonymousCookie).toContain(APP_ID)

    const resumeOpen = await app.inject({
      method: 'GET',
      url: outreachPath,
      headers: { cookie: anonymousCookie },
    })
    expect(resumeOpen.statusCode).toBe(302)
    expect(resumeOpen.headers.location).toBe(`/workspace/${templateWorkspaceId}`)

    const newVisitor = await app.inject({ method: 'GET', url: outreachPath })
    expect(newVisitor.statusCode).toBe(404)
    expect(newVisitor.json()).toMatchObject({ code: 'not_found' })
  })

  it('rejects expired and revoked outreach links at consume time', async () => {
    const expired = await createOutreachFixture()
    await sql`
      UPDATE outreach_links
      SET expires_at = now() - interval '1 minute'
      WHERE id = ${expired.linkId}
    `
    const expiredRes = await app.inject({ method: 'GET', url: expired.outreachPath })
    expect(expiredRes.statusCode).toBe(404)
    expect(expiredRes.json()).toMatchObject({ code: 'not_found' })

    const revoked = await createOutreachFixture()
    await sql`
      UPDATE outreach_links
      SET revoked_at = now()
      WHERE id = ${revoked.linkId}
    `
    const revokedRes = await app.inject({ method: 'GET', url: revoked.outreachPath })
    expect(revokedRes.statusCode).toBe(404)
    expect(revokedRes.json()).toMatchObject({ code: 'not_found' })
  })

  it('reserves only one lead when two new visitors open a maxLeads=1 link concurrently', async () => {
    const { outreachPath, linkId } = await createOutreachFixture({ maxLeads: 1 })

    const results = await Promise.all([
      app.inject({ method: 'GET', url: outreachPath }),
      app.inject({ method: 'GET', url: outreachPath }),
    ])
    const statuses = results.map((result) => result.statusCode).sort((a, b) => a - b)
    expect(statuses).toEqual([302, 404])

    const rows = await sql<{ lead_count: number }[]>`
      SELECT lead_count
      FROM outreach_links
      WHERE id = ${linkId}
    `
    expect(rows[0]?.lead_count).toBe(1)

    const db = drizzle(sql)
    const leads = await db
      .select()
      .from(outreachLeads)
      .where(eq(outreachLeads.outreachLinkId, linkId))
    expect(leads).toHaveLength(1)
  })

  it('moves outreach initial credits from the anonymous lead to the claimed account', async () => {
    const initialCreditMicros = 3_000_000
    const { outreachPath, linkId } = await createOutreachFixture({ initialCreditMicros })

    const openRes = await app.inject({ method: 'GET', url: outreachPath })
    expect(openRes.statusCode).toBe(302)
    const anonymousCookie = cookieHeader(openRes.headers['set-cookie'])

    const anonymousMe = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: anonymousCookie } })
    const anonymousUserId = anonymousMe.json().user.id as string
    const grantReason = `outreach:${linkId}:initial_credit`
    const anonymousGrantBefore = await sql<{ total: string }[]>`
      SELECT COALESCE(SUM(amount_micros), 0)::text AS total
      FROM boring_credit_grants
      WHERE user_id = ${anonymousUserId}
        AND reason = ${grantReason}
    `
    expect(Number(anonymousGrantBefore[0]?.total ?? 0)).toBe(initialCreditMicros)

    const email = claimedEmail('credit')
    const claimRes = await app.inject({
      method: 'POST',
      url: '/auth/sign-up/email',
      headers: { cookie: anonymousCookie },
      payload: { name: 'Claimed Credits', email, password: TEST_PASSWORD },
    })
    expect(claimRes.statusCode).toBeLessThan(300)

    const claimedLeadRows = await sql<{ user_id: string }[]>`
      SELECT user_id
      FROM outreach_leads
      WHERE app_id = ${APP_ID}
        AND outreach_link_id = ${linkId}
    `
    const claimedUserId = claimedLeadRows[0]?.user_id
    expect(claimedUserId).toBeTruthy()
    if (!claimedUserId) throw new Error('claimed outreach lead was not found')
    expect(claimedUserId).not.toBe(anonymousUserId)

    const grantRows = await sql<{ user_id: string; amount_micros: string; reason: string }[]>`
      SELECT user_id, amount_micros::text, reason
      FROM boring_credit_grants
      WHERE reason = ${grantReason}
        AND user_id IN (${anonymousUserId}, ${claimedUserId})
    `
    expect(grantRows).toEqual([
      expect.objectContaining({
        user_id: claimedUserId,
        amount_micros: String(initialCreditMicros),
        reason: grantReason,
      }),
    ])
  })

  it('allows only one concurrent anonymous claim transfer to win', async () => {
    const { outreachPath, linkId } = await createOutreachFixture()

    const openRes = await app.inject({ method: 'GET', url: outreachPath })
    expect(openRes.statusCode).toBe(302)
    const anonymousCookie = cookieHeader(openRes.headers['set-cookie'])

    const anonymousMe = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: anonymousCookie } })
    const anonymousUserId = anonymousMe.json().user.id as string
    const email = claimedEmail('race')
    const [claimedUser] = await sql<{ id: string }[]>`
      INSERT INTO users (name, email, email_verified)
      VALUES ('Claim Race', ${email}, true)
      RETURNING id
    `
    expect(claimedUser?.id).toBeTruthy()

    const adapter = createOutreachAuthIdentityAdapter(drizzle(sql), APP_ID)
    const results = await Promise.allSettled([
      adapter.transferAnonymousOwnership({
        anonymousUserId,
        claimedUserId: claimedUser.id,
        claimedEmail: email,
      }),
      adapter.transferAnonymousOwnership({
        anonymousUserId,
        claimedUserId: claimedUser.id,
        claimedEmail: email,
      }),
    ])

    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason).toBeInstanceOf(HttpError)
    expect(rejected[0].reason).toMatchObject({
      status: 409,
      code: ERROR_CODES.OUTREACH_CLAIM_CONFLICT,
    })

    const leads = await sql<{ user_id: string; status: string; claimed_email: string | null }[]>`
      SELECT user_id, status, claimed_email
      FROM outreach_leads
      WHERE app_id = ${APP_ID}
        AND outreach_link_id = ${linkId}
    `
    expect(leads).toEqual([
      expect.objectContaining({
        user_id: claimedUser.id,
        status: 'claimed',
        claimed_email: email,
      }),
    ])
    expect(leads.some((lead) => lead.user_id === anonymousUserId)).toBe(false)
  })

  it('returns a coded conflict when two anonymous leads race into one new claimed account', async () => {
    const first = await createOutreachFixture()
    const second = await createOutreachFixture()

    const firstOpen = await app.inject({ method: 'GET', url: first.outreachPath })
    expect(firstOpen.statusCode).toBe(302)
    const secondOpen = await app.inject({ method: 'GET', url: second.outreachPath })
    expect(secondOpen.statusCode).toBe(302)

    const firstCookie = cookieHeader(firstOpen.headers['set-cookie'])
    const secondCookie = cookieHeader(secondOpen.headers['set-cookie'])
    const firstMe = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: firstCookie } })
    const secondMe = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: secondCookie } })
    const firstAnonymousUserId = firstMe.json().user.id as string
    const secondAnonymousUserId = secondMe.json().user.id as string

    const email = claimedEmail('fresh-race')
    const [claimedUser] = await sql<{ id: string }[]>`
      INSERT INTO users (name, email, email_verified)
      VALUES ('Fresh Claim Race', ${email}, true)
      RETURNING id
    `
    expect(claimedUser?.id).toBeTruthy()

    const adapter = createOutreachAuthIdentityAdapter(drizzle(sql), APP_ID)
    const results = await Promise.allSettled([
      adapter.transferAnonymousOwnership({
        anonymousUserId: firstAnonymousUserId,
        claimedUserId: claimedUser.id,
        claimedEmail: email,
      }),
      adapter.transferAnonymousOwnership({
        anonymousUserId: secondAnonymousUserId,
        claimedUserId: claimedUser.id,
        claimedEmail: email,
      }),
    ])

    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason).toBeInstanceOf(HttpError)
    expect(rejected[0].reason).toMatchObject({
      status: 409,
      code: ERROR_CODES.OUTREACH_CLAIM_CONFLICT,
    })
    expect((rejected[0].reason as { code?: unknown }).code).not.toBe('23505')

    const leads = await sql<{ outreach_link_id: string; user_id: string; status: string }[]>`
      SELECT outreach_link_id, user_id, status
      FROM outreach_leads
      WHERE app_id = ${APP_ID}
        AND outreach_link_id IN (${first.linkId}, ${second.linkId})
      ORDER BY outreach_link_id
    `
    expect(leads.filter((lead) => lead.user_id === claimedUser.id && lead.status === 'claimed')).toHaveLength(1)
    expect(leads.filter((lead) => [firstAnonymousUserId, secondAnonymousUserId].includes(lead.user_id))).toHaveLength(1)
  })
})
