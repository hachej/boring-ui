import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { ERROR_CODES } from '../../shared/errors'
import type { CoreConfig } from '../../shared/types'
import { createAuth } from '../auth/createAuth'
import { authHook } from '../auth/authHook'
import { registerCapabilities } from '../app/capabilities'
import { registerErrorHandler } from '../app/errorHandler'
import { registerRoutes } from '../app/routes'
import { runMigrations } from '../db/migrate'
import { PostgresUserStore } from '../db/stores/PostgresUserStore'
import { PostgresWorkspaceStore } from '../db/stores/PostgresWorkspaceStore'
import { registerInviteRoutes, registerMemberRoutes, registerWorkspaceRoutes } from '../routes'
import { runConcurrent } from './_concurrency'
import { withBeadId } from './_setup'

const BEAD_ID = 'boring-ui-v2-mo58'
const TEST_DB_URL = 'postgres://ubuntu:test@localhost/boring_ui_test'
const APP_ID = 'race-conditions-app'
const PASSWORD = 'Zk8$mN!qR2xFgWpJ'

const BASE_CONFIG: CoreConfig = {
  appId: APP_ID,
  appName: 'Race Conditions Test App',
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
  },
  features: { githubOauth: false, invitesEnabled: true, sendWelcomeEmail: true },
}

interface SessionUser {
  id: string
  email: string
  cookie: string
}

let app: FastifyInstance
let rawSql: postgres.Sql
let workspaceStore: PostgresWorkspaceStore

function extractCookie(setCookieHeader: string | string[] | undefined): string {
  if (!setCookieHeader) {
    throw new Error('missing set-cookie header')
  }
  const cookies = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : [setCookieHeader]
  return cookies.map((cookie) => cookie.split(';')[0]).join('; ')
}

async function signUpUser(tag: string): Promise<SessionUser> {
  const email = `${tag}-${randomUUID().slice(0, 8)}@race-test.dev`
  const res = await app.inject({
    method: 'POST',
    url: '/auth/sign-up/email',
    payload: {
      name: `User ${tag}`,
      email,
      password: PASSWORD,
    },
  })

  if (res.statusCode >= 400) {
    throw new Error(`signup failed (${res.statusCode}): ${res.body}`)
  }

  const body = res.json() as { user: { id: string; email: string } }
  return {
    id: body.user.id,
    email: body.user.email,
    cookie: extractCookie(res.headers['set-cookie']),
  }
}

async function createWorkspace(
  ownerCookie: string,
  name: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/workspaces',
    headers: { cookie: ownerCookie },
    payload: { name },
  })

  expect(res.statusCode).toBe(201)
  const body = res.json() as { workspace: { id: string } }
  return body.workspace.id
}

beforeAll(async () => {
  await runMigrations(BASE_CONFIG)

  rawSql = postgres(TEST_DB_URL, { max: 6 })
  const db = drizzle(rawSql)

  const auth = createAuth(BASE_CONFIG, db)
  const userStore = new PostgresUserStore(db)
  workspaceStore = new PostgresWorkspaceStore(db)

  app = Fastify({ logger: false })
  app.decorate('config', BASE_CONFIG)
  app.decorate('auth', auth)
  app.decorate('workspaceStore', workspaceStore)

  registerErrorHandler(app)
  registerCapabilities(app)
  await app.register(authHook)
  await app.register(registerRoutes, {
    sql: rawSql,
    db,
    userStore,
    workspaceStore,
  })
  await app.register(registerWorkspaceRoutes)
  await app.register(registerMemberRoutes)
  await app.register(registerInviteRoutes)

  app.all('/auth/*', async (request, reply) => {
    const url = `http://localhost:3000${request.url}`
    const webReq = new Request(url, {
      method: request.method,
      headers: request.headers as Record<string, string>,
      body:
        request.method !== 'GET' && request.method !== 'HEAD'
          ? JSON.stringify(request.body)
          : undefined,
    })
    const response = await auth.handler(webReq)
    const headers = Object.fromEntries(response.headers.entries())
    reply.status(response.status).headers(headers).send(await response.text())
  })

  await app.ready()
})

beforeEach(async () => {
  const emailPattern = '%@race-test.dev'

  await rawSql`
    DELETE FROM workspace_invites
    WHERE workspace_id IN (SELECT id FROM workspaces WHERE app_id = ${APP_ID})
       OR created_by IN (SELECT id FROM users WHERE email LIKE ${emailPattern})
  `
  await rawSql`
    DELETE FROM workspace_members
    WHERE workspace_id IN (SELECT id FROM workspaces WHERE app_id = ${APP_ID})
       OR user_id IN (SELECT id FROM users WHERE email LIKE ${emailPattern})
  `
  await rawSql`
    DELETE FROM workspace_runtimes
    WHERE workspace_id IN (SELECT id FROM workspaces WHERE app_id = ${APP_ID})
  `
  await rawSql`
    DELETE FROM workspace_settings
    WHERE workspace_id IN (SELECT id FROM workspaces WHERE app_id = ${APP_ID})
  `
  await rawSql`DELETE FROM workspaces WHERE app_id = ${APP_ID}`
  await rawSql`
    DELETE FROM user_settings
    WHERE app_id = ${APP_ID}
       OR user_id IN (SELECT id FROM users WHERE email LIKE ${emailPattern})
  `
  await rawSql`
    DELETE FROM sessions
    WHERE user_id IN (SELECT id FROM users WHERE email LIKE ${emailPattern})
  `
  await rawSql`
    DELETE FROM accounts
    WHERE user_id IN (SELECT id FROM users WHERE email LIKE ${emailPattern})
  `
  await rawSql`
    DELETE FROM verification_tokens
    WHERE identifier LIKE ${emailPattern}
  `
  await rawSql`DELETE FROM users WHERE email LIKE ${emailPattern}`
})

afterAll(async () => {
  await app.close()
  await rawSql.end()
})

/**
 * CORE.md §M1 §Race conditions:
 * Validate fixed semantics under concurrent execution against a real Postgres DB.
 */
describe('Race conditions integration (Postgres)', () => {
  it(
    'TOCTOU invite accept: exactly one concurrent accept succeeds',
    withBeadId(BEAD_ID, async ({ logEvent, assertionPassed }) => {
      logEvent('setup.start', {
        race: 'invite_accept_toctou',
        phase: 'race.test.start',
        beadId: BEAD_ID,
      })

      const owner = await signUpUser('owner')
      const invitee = await signUpUser('invitee')
      const workspaceId = await createWorkspace(owner.cookie, 'TOCTOU WS')

      const { invite, rawToken } = await workspaceStore.createInvite(
        workspaceId,
        invitee.email,
        'viewer',
        owner.id,
      )

      logEvent('setup.complete', {
        race: 'invite_accept_toctou',
        workspaceId,
        inviteId: invite.id,
        phase: 'race.barrier.released',
        participants: 2,
      })

      const outcomes = await runConcurrent(
        [
          () =>
            app.inject({
              method: 'POST',
              url: `/api/v1/workspaces/${workspaceId}/invites/${invite.id}/accept?invite_token=${rawToken}`,
              headers: { cookie: invitee.cookie },
            }),
          () =>
            app.inject({
              method: 'POST',
              url: `/api/v1/workspaces/${workspaceId}/invites/${invite.id}/accept?invite_token=${rawToken}`,
              headers: { cookie: invitee.cookie },
            }),
        ],
        { barrier: 2 },
      )

      const responses = outcomes.map((outcome) => {
        if (outcome.status === 'rejected') {
          throw outcome.reason
        }
        return outcome.value
      })

      const successCount = responses.filter((res) => res.statusCode === 200).length
      const alreadyAcceptedCount = responses.filter((res) => {
        if (res.statusCode !== 409) return false
        const body = res.json() as { code?: string }
        return body.code === ERROR_CODES.INVITE_ALREADY_ACCEPTED
      }).length

      expect(successCount).toBe(1)
      expect(alreadyAcceptedCount).toBe(1)

      const [memberCount] = await rawSql`
        SELECT COUNT(*)::int AS count
        FROM workspace_members
        WHERE workspace_id = ${workspaceId}
          AND user_id = ${invitee.id}
      `
      expect(memberCount.count).toBe(1)

      logEvent('setup.complete', {
        race: 'invite_accept_toctou',
        phase: 'race.test.outcome',
        observed: `success=${successCount},alreadyAccepted=${alreadyAcceptedCount}`,
      })
      assertionPassed('invite-accept-one-winner')
    }),
  )

  it(
    'last-owner deletion race: two concurrent owner removals produce exactly one winner',
    withBeadId(BEAD_ID, async ({ logEvent, assertionPassed }) => {
      logEvent('setup.start', {
        race: 'last_owner_delete_race',
        phase: 'race.test.start',
        beadId: BEAD_ID,
      })

      const ownerA = await signUpUser('owner-a')
      const ownerB = await signUpUser('owner-b')
      const workspaceId = await createWorkspace(ownerA.cookie, 'Owner Race WS')

      await rawSql`
        INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
        VALUES (${workspaceId}, ${ownerB.id}, 'owner', NOW() - interval '1 minute')
      `

      const outcomes = await runConcurrent(
        [
          () =>
            app.inject({
              method: 'DELETE',
              url: `/api/v1/workspaces/${workspaceId}/members/${ownerB.id}`,
              headers: { cookie: ownerA.cookie },
            }),
          () =>
            app.inject({
              method: 'DELETE',
              url: `/api/v1/workspaces/${workspaceId}/members/${ownerA.id}`,
              headers: { cookie: ownerB.cookie },
            }),
        ],
        { barrier: 2 },
      )

      const responses = outcomes.map((outcome) => {
        if (outcome.status === 'rejected') {
          throw outcome.reason
        }
        return outcome.value
      })

      const successCount = responses.filter((res) => res.statusCode === 200).length
      const rejectedCount = responses.filter((res) => {
        if (res.statusCode !== 409 && res.statusCode !== 403) return false
        const body = res.json() as { code?: string }
        return body.code === ERROR_CODES.LAST_OWNER || body.code === ERROR_CODES.NOT_MEMBER || body.code === ERROR_CODES.FORBIDDEN
      }).length
      expect(successCount).toBe(1)
      expect(rejectedCount).toBe(1)

      const [ownerMembershipCount] = await rawSql`
        SELECT COUNT(*)::int AS count
        FROM workspace_members
        WHERE workspace_id = ${workspaceId}
          AND role = 'owner'
      `
      expect(ownerMembershipCount.count).toBe(1)

      logEvent('setup.complete', {
        race: 'last_owner_delete_race',
        phase: 'race.test.outcome',
        observed: `success=${successCount},rejected=${rejectedCount}`,
      })
      assertionPassed('last-owner-race-one-winner')
    }),
  )

  it(
    'default-promotion: sole-owner account deletion promotes oldest editor; no-editor workspace is deleted',
    withBeadId(BEAD_ID, async ({ logEvent, assertionPassed }) => {
      logEvent('setup.start', {
        race: 'default_promotion',
        phase: 'race.test.start',
        beadId: BEAD_ID,
      })

      const owner = await signUpUser('promote-owner')
      const oldestEditor = await signUpUser('promote-editor-old')
      const newerEditor = await signUpUser('promote-editor-new')
      const viewerOnly = await signUpUser('promote-viewer')

      const promotedWorkspaceId = await createWorkspace(owner.cookie, 'Promoted Workspace')
      const deletedWorkspaceId = await createWorkspace(owner.cookie, 'Delete Workspace')

      await rawSql`
        INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
        VALUES
          (${promotedWorkspaceId}, ${oldestEditor.id}, 'editor', NOW() - interval '2 minutes'),
          (${promotedWorkspaceId}, ${newerEditor.id}, 'editor', NOW() - interval '1 minute'),
          (${deletedWorkspaceId}, ${viewerOnly.id}, 'viewer', NOW() - interval '1 minute')
      `

      const deleteRes = await app.inject({
        method: 'DELETE',
        url: '/api/v1/me',
        headers: { cookie: owner.cookie },
        payload: { confirm: owner.email },
      })
      expect(deleteRes.statusCode).toBe(200)
      expect((deleteRes.json() as { deleted: boolean }).deleted).toBe(true)

      const [promotedWorkspace] = await rawSql`
        SELECT created_by
        FROM workspaces
        WHERE id = ${promotedWorkspaceId}
      `
      expect(promotedWorkspace.created_by).toBe(oldestEditor.id)

      const [promotedRole] = await rawSql`
        SELECT role
        FROM workspace_members
        WHERE workspace_id = ${promotedWorkspaceId}
          AND user_id = ${oldestEditor.id}
      `
      expect(promotedRole.role).toBe('owner')

      const [newerRole] = await rawSql`
        SELECT role
        FROM workspace_members
        WHERE workspace_id = ${promotedWorkspaceId}
          AND user_id = ${newerEditor.id}
      `
      expect(newerRole.role).toBe('editor')

      const [deletedWorkspaceCount] = await rawSql`
        SELECT COUNT(*)::int AS count
        FROM workspaces
        WHERE id = ${deletedWorkspaceId}
      `
      expect(deletedWorkspaceCount.count).toBe(0)

      logEvent('setup.complete', {
        race: 'default_promotion',
        phase: 'race.test.outcome',
        observed: 'promoted_oldest_editor_and_deleted_no_editor_workspace',
      })
      assertionPassed('default-promotion-and-no-editor-deletion')
    }),
  )
})
