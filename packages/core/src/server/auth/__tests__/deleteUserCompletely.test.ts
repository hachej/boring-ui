import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'

import type { CoreConfig } from '../../../shared/types'
import { ERROR_CODES, HttpError } from '../../../shared/errors'
import { runMigrations } from '../../db/migrate'
import { PostgresUserStore } from '../../db/stores/PostgresUserStore'
import { PostgresWorkspaceStore } from '../../db/stores/PostgresWorkspaceStore'
import { deleteUserCompletely } from '../deleteUserCompletely'

const TEST_DB_URL = 'postgres://ubuntu:test@localhost/boring_ui_test'
const APP_ID = 'delete-user-orchestrator-app'

const BASE_CONFIG: CoreConfig = {
  appId: APP_ID,
  appName: 'Delete User Test App',
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

let sqlClient: postgres.Sql
let userStore: PostgresUserStore
let workspaceStore: PostgresWorkspaceStore

async function seedUser(tag: string): Promise<{ id: string; email: string }> {
  const suffix = randomUUID().slice(0, 8)
  const email = `${tag}-${suffix}@delete-user.test`
  const [row] = await sqlClient`
    INSERT INTO users (name, email, email_verified)
    VALUES (${`User ${tag}`}, ${email}, true)
    RETURNING id, email
  `

  return {
    id: row.id as string,
    email: row.email as string,
  }
}

async function seedWorkspace(ownerId: string, name: string): Promise<string> {
  const workspaceId = randomUUID()

  await sqlClient`
    INSERT INTO workspaces (id, app_id, name, created_by, is_default)
    VALUES (${workspaceId}, ${APP_ID}, ${name}, ${ownerId}, false)
  `

  await sqlClient`
    INSERT INTO workspace_members (workspace_id, user_id, role)
    VALUES (${workspaceId}, ${ownerId}, 'owner')
  `

  return workspaceId
}

beforeAll(async () => {
  await runMigrations(BASE_CONFIG)
  sqlClient = postgres(TEST_DB_URL, { max: 4 })
  const db = drizzle(sqlClient)
  userStore = new PostgresUserStore(db)
  workspaceStore = new PostgresWorkspaceStore(db)
})

afterAll(async () => {
  await sqlClient.end()
})

beforeEach(async () => {
  const emailPattern = '%@delete-user.test'

  await sqlClient`
    DELETE FROM workspace_invites
    WHERE workspace_id IN (
      SELECT id FROM workspaces WHERE app_id = ${APP_ID}
    )
    OR created_by IN (
      SELECT id FROM users WHERE email LIKE ${emailPattern}
    )
  `
  await sqlClient`
    DELETE FROM workspace_members
    WHERE workspace_id IN (
      SELECT id FROM workspaces WHERE app_id = ${APP_ID}
    )
    OR user_id IN (
      SELECT id FROM users WHERE email LIKE ${emailPattern}
    )
  `
  await sqlClient`
    DELETE FROM workspace_runtimes
    WHERE workspace_id IN (
      SELECT id FROM workspaces WHERE app_id = ${APP_ID}
    )
  `
  await sqlClient`
    DELETE FROM workspace_settings
    WHERE workspace_id IN (
      SELECT id FROM workspaces WHERE app_id = ${APP_ID}
    )
  `
  await sqlClient`DELETE FROM workspaces WHERE app_id = ${APP_ID}`
  await sqlClient`
    DELETE FROM user_settings
    WHERE app_id = ${APP_ID}
    OR user_id IN (
      SELECT id FROM users WHERE email LIKE ${emailPattern}
    )
  `
  await sqlClient`
    DELETE FROM sessions
    WHERE user_id IN (
      SELECT id FROM users WHERE email LIKE ${emailPattern}
    )
  `
  await sqlClient`
    DELETE FROM accounts
    WHERE user_id IN (
      SELECT id FROM users WHERE email LIKE ${emailPattern}
    )
  `
  await sqlClient`
    DELETE FROM verification_tokens
    WHERE identifier LIKE ${emailPattern}
  `
  await sqlClient`
    DELETE FROM users
    WHERE email LIKE ${emailPattern}
  `
})

describe('deleteUserCompletely', () => {
  it('completes for a user with no memberships and deletes auth-owned records', async () => {
    const user = await seedUser('no-memberships')

    await sqlClient`
      INSERT INTO user_settings (user_id, app_id, display_name, email, settings)
      VALUES (${user.id}, ${APP_ID}, 'No Memberships', ${user.email}, '{}'::jsonb)
    `
    await sqlClient`
      INSERT INTO sessions (token, user_id, expires_at)
      VALUES (${`session-${randomUUID()}`}, ${user.id}, NOW() + interval '1 day')
    `
    await sqlClient`
      INSERT INTO accounts (account_id, provider_id, user_id)
      VALUES (${`account-${randomUUID()}`}, 'email', ${user.id})
    `
    await sqlClient`
      INSERT INTO verification_tokens (identifier, value, expires_at)
      VALUES (${user.email}, ${`verify-${randomUUID()}`}, NOW() + interval '1 day')
    `

    await deleteUserCompletely(user.id, {
      db: drizzle(sqlClient),
      userStore,
      workspaceStore,
    })

    expect(await userStore.getById(user.id)).toBeNull()

    const [settingsCount] = await sqlClient`
      SELECT COUNT(*)::int AS count
      FROM user_settings
      WHERE user_id = ${user.id}
    `
    expect(settingsCount.count).toBe(0)

    const [sessionsCount] = await sqlClient`
      SELECT COUNT(*)::int AS count
      FROM sessions
      WHERE user_id = ${user.id}
    `
    expect(sessionsCount.count).toBe(0)

    const [accountsCount] = await sqlClient`
      SELECT COUNT(*)::int AS count
      FROM accounts
      WHERE user_id = ${user.id}
    `
    expect(accountsCount.count).toBe(0)

    const [tokensCount] = await sqlClient`
      SELECT COUNT(*)::int AS count
      FROM verification_tokens
      WHERE identifier = ${user.email}
    `
    expect(tokensCount.count).toBe(0)
  })

  it('throws last_owner when the user is sole owner of at least one workspace', async () => {
    const user = await seedUser('sole-owner')
    const workspaceId = await seedWorkspace(user.id, 'Sole Owner WS')

    await expect(
      deleteUserCompletely(user.id, {
        db: drizzle(sqlClient),
        userStore,
        workspaceStore,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: ERROR_CODES.LAST_OWNER,
      message:
        'Transfer ownership of 1 workspace(s) before deleting your account.',
    } satisfies Pick<HttpError, 'status' | 'code' | 'message'>)

    expect(await userStore.getById(user.id)).not.toBeNull()

    const [membershipCount] = await sqlClient`
      SELECT COUNT(*)::int AS count
      FROM workspace_members
      WHERE workspace_id = ${workspaceId}
      AND user_id = ${user.id}
    `
    expect(membershipCount.count).toBe(1)
  })

  it('deletes co-owner memberships, revokes pending invites, and keeps co-owners', async () => {
    const departingOwner = await seedUser('co-owned-a')
    const remainingOwner = await seedUser('co-owned-b')
    const invitedEmail = `invitee-${randomUUID().slice(0, 6)}@delete-user.test`
    const acceptedInviteEmail = `accepted-${randomUUID().slice(0, 6)}@delete-user.test`

    const sharedWorkspaceId = await seedWorkspace(
      departingOwner.id,
      'Shared Workspace',
    )
    await sqlClient`
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES (${sharedWorkspaceId}, ${remainingOwner.id}, 'owner')
    `

    const secondaryWorkspaceId = await seedWorkspace(
      remainingOwner.id,
      'Secondary Workspace',
    )
    await sqlClient`
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES (${secondaryWorkspaceId}, ${departingOwner.id}, 'editor')
    `

    await sqlClient`
      INSERT INTO workspace_invites (
        workspace_id,
        email,
        token_hash,
        role,
        expires_at,
        created_by
      )
      VALUES (
        ${sharedWorkspaceId},
        ${invitedEmail},
        ${`token-${randomUUID()}`},
        'viewer',
        NOW() + interval '7 days',
        ${departingOwner.id}
      )
    `
    await sqlClient`
      INSERT INTO workspace_invites (
        workspace_id,
        email,
        token_hash,
        role,
        expires_at,
        accepted_at,
        created_by
      )
      VALUES (
        ${sharedWorkspaceId},
        ${acceptedInviteEmail},
        ${`token-${randomUUID()}`},
        'viewer',
        NOW() + interval '7 days',
        NOW() - interval '1 minute',
        ${departingOwner.id}
      )
    `

    await sqlClient`
      INSERT INTO user_settings (user_id, app_id, display_name, email, settings)
      VALUES (
        ${departingOwner.id},
        ${APP_ID},
        'Departing Owner',
        ${departingOwner.email},
        '{"theme":"dark"}'::jsonb
      )
    `

    await deleteUserCompletely(departingOwner.id, {
      db: drizzle(sqlClient),
      userStore,
      workspaceStore,
    })

    expect(await userStore.getById(departingOwner.id)).toBeNull()

    const [departingMemberships] = await sqlClient`
      SELECT COUNT(*)::int AS count
      FROM workspace_members
      WHERE user_id = ${departingOwner.id}
    `
    expect(departingMemberships.count).toBe(0)

    expect(
      await workspaceStore.getMemberRole(sharedWorkspaceId, remainingOwner.id),
    ).toBe('owner')

    const [pendingInvites] = await sqlClient`
      SELECT COUNT(*)::int AS count
      FROM workspace_invites
      WHERE created_by = ${departingOwner.id}
      AND accepted_at IS NULL
    `
    expect(pendingInvites.count).toBe(0)

    const [acceptedInvitesWithCreator] = await sqlClient`
      SELECT COUNT(*)::int AS count
      FROM workspace_invites
      WHERE email = ${acceptedInviteEmail}
      AND created_by IS NOT NULL
    `
    expect(acceptedInvitesWithCreator.count).toBe(0)

    const [remainingSettings] = await sqlClient`
      SELECT COUNT(*)::int AS count
      FROM user_settings
      WHERE user_id = ${departingOwner.id}
    `
    expect(remainingSettings.count).toBe(0)
  })
})
