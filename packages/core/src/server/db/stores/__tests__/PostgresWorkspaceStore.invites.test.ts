import { createHash } from 'node:crypto'

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { CoreConfig } from '../../../../shared/types'
import { ERROR_CODES, HttpError } from '../../../../shared/errors'
import { runMigrations } from '../../migrate'
import { PostgresWorkspaceStore } from '../PostgresWorkspaceStore'

const TEST_DB_URL = process.env.DATABASE_URL ?? 'postgres://ubuntu:test@localhost/boring_ui_test'

const BASE_CONFIG: CoreConfig = {
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
  },
  features: { githubOauth: false, googleOauth: false, invitesEnabled: true, sendWelcomeEmail: true, inviteTtlDays: 7 },
}

const OWNER_ID = '41000000-0000-0000-0000-000000000001'
const MEMBER_ID = '41000000-0000-0000-0000-000000000002'
const OTHER_ID = '41000000-0000-0000-0000-000000000003'
const WS_ID = '42000000-0000-0000-0000-000000000001'

let sqlClient: postgres.Sql
let store: PostgresWorkspaceStore

beforeAll(async () => {
  await runMigrations(BASE_CONFIG)
  sqlClient = postgres(TEST_DB_URL, { max: 5 })
  const db = drizzle(sqlClient)
  store = new PostgresWorkspaceStore(db)
})

afterAll(async () => {
  await sqlClient.end()
})

beforeEach(async () => {
  await sqlClient`DELETE FROM workspace_members WHERE workspace_id = ${WS_ID}`
  await sqlClient`DELETE FROM workspace_invites WHERE workspace_id = ${WS_ID}`
  await sqlClient`DELETE FROM workspaces WHERE id = ${WS_ID}`
  await sqlClient`
    DELETE FROM users WHERE id IN (${OWNER_ID}, ${MEMBER_ID}, ${OTHER_ID})
  `

  await sqlClient`
    INSERT INTO users (id, name, email, email_verified)
    VALUES
      (${OWNER_ID}, 'Owner', 'owner@pginvtest.com', true),
      (${MEMBER_ID}, 'Member', 'member@pginvtest.com', true),
      (${OTHER_ID}, 'Other', 'other@pginvtest.com', true)
  `

  await sqlClient`
    INSERT INTO workspaces (id, app_id, name, created_by)
    VALUES (${WS_ID}, 'test-app', 'Invites WS', ${OWNER_ID})
  `
})

describe('PostgresWorkspaceStore invites', () => {
  it('createInvite returns invite + rawToken hash pair', async () => {
    const { invite, rawToken } = await store.createInvite(
      WS_ID,
      'member@pginvtest.com',
      'editor',
      OWNER_ID,
    )

    expect(rawToken).toBeTruthy()
    expect(invite.workspaceId).toBe(WS_ID)
    expect(invite.role).toBe('editor')
    expect(invite.tokenHash).toBe(
      createHash('sha256').update(rawToken).digest('hex'),
    )
  })

  it('listInvites and getInvite return workspace-scoped invites', async () => {
    const a = await store.createInvite(
      WS_ID,
      'a@pginvtest.com',
      'viewer',
      OWNER_ID,
    )
    const b = await store.createInvite(
      WS_ID,
      'b@pginvtest.com',
      'editor',
      OWNER_ID,
    )

    const list = await store.listInvites(WS_ID)
    expect(list).toHaveLength(2)

    const one = await store.getInvite(WS_ID, a.invite.id)
    expect(one?.id).toBe(a.invite.id)

    const missing = await store.getInvite(
      '42000000-0000-0000-0000-000000000999',
      b.invite.id,
    )
    expect(missing).toBeNull()
  })

  it('getInviteByTokenHash resolves stored invite and misses unknown hashes', async () => {
    const { invite, rawToken } = await store.createInvite(
      WS_ID,
      'member@pginvtest.com',
      'viewer',
      OWNER_ID,
    )
    const hash = createHash('sha256').update(rawToken).digest('hex')

    const found = await store.getInviteByTokenHash(hash)
    expect(found?.id).toBe(invite.id)

    const missing = await store.getInviteByTokenHash('deadbeef')
    expect(missing).toBeNull()
  })

  it('revokeInvite deletes invite and returns false for missing', async () => {
    const { invite } = await store.createInvite(
      WS_ID,
      'member@pginvtest.com',
      'viewer',
      OWNER_ID,
    )

    expect(await store.revokeInvite(WS_ID, invite.id)).toBe(true)
    expect(await store.revokeInvite(WS_ID, invite.id)).toBe(false)
  })

  it('acceptInvite success returns invite+member populated', async () => {
    const { invite } = await store.createInvite(
      WS_ID,
      'member@pginvtest.com',
      'editor',
      OWNER_ID,
    )

    const accepted = await store.acceptInvite(WS_ID, invite.id, MEMBER_ID)
    expect(accepted.invite.acceptedAt).toBeTruthy()
    expect(accepted.member.workspaceId).toBe(WS_ID)
    expect(accepted.member.userId).toBe(MEMBER_ID)
    expect(accepted.member.role).toBe('editor')
  })

  it('acceptInvite throws INVITE_NOT_FOUND', async () => {
    await expect(
      store.acceptInvite(WS_ID, '43000000-0000-0000-0000-000000000001', MEMBER_ID),
    ).rejects.toMatchObject({
      status: 404,
      code: ERROR_CODES.INVITE_NOT_FOUND,
    } satisfies Pick<HttpError, 'status' | 'code'>)
  })

  it('acceptInvite throws INVITE_EXPIRED', async () => {
    const { invite } = await store.createInvite(
      WS_ID,
      'member@pginvtest.com',
      'viewer',
      OWNER_ID,
    )
    await sqlClient`
      UPDATE workspace_invites
      SET expires_at = NOW() - interval '1 minute'
      WHERE id = ${invite.id}
    `

    await expect(
      store.acceptInvite(WS_ID, invite.id, MEMBER_ID),
    ).rejects.toMatchObject({
      status: 410,
      code: ERROR_CODES.INVITE_EXPIRED,
    } satisfies Pick<HttpError, 'status' | 'code'>)
  })

  it('acceptInvite throws INVITE_ALREADY_ACCEPTED', async () => {
    const { invite } = await store.createInvite(
      WS_ID,
      'member@pginvtest.com',
      'viewer',
      OWNER_ID,
    )
    await store.acceptInvite(WS_ID, invite.id, MEMBER_ID)

    await expect(
      store.acceptInvite(WS_ID, invite.id, MEMBER_ID),
    ).rejects.toMatchObject({
      status: 410,
      code: ERROR_CODES.INVITE_ALREADY_ACCEPTED,
    } satisfies Pick<HttpError, 'status' | 'code'>)
  })

  it('acceptInvite throws INVITE_EMAIL_MISMATCH', async () => {
    const { invite } = await store.createInvite(
      WS_ID,
      'member@pginvtest.com',
      'viewer',
      OWNER_ID,
    )

    await expect(
      store.acceptInvite(WS_ID, invite.id, OTHER_ID),
    ).rejects.toMatchObject({
      status: 403,
      code: ERROR_CODES.INVITE_EMAIL_MISMATCH,
    } satisfies Pick<HttpError, 'status' | 'code'>)
  })
})
