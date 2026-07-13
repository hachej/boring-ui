import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'

import type { CoreConfig } from '../../../shared/types'
import { ERROR_CODES } from '../../../shared/errors'
import { runMigrations } from '../../db/migrate'
import { PostgresUserStore } from '../../db/stores/PostgresUserStore'
import { PostgresWorkspaceStore } from '../../db/stores/PostgresWorkspaceStore'
import { deleteUserCompletely } from '../deleteUserCompletely'

const TEST_DB_URL = process.env.DATABASE_URL ?? 'postgres://ubuntu:test@localhost/boring_ui_test'
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
  features: { githubOauth: false, googleOauth: false, invitesEnabled: true, sendWelcomeEmail: true, inviteTtlDays: 7 },
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

async function waitForLockWaiter(blockerPid: number): Promise<number> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const [row] = await sqlClient`
      SELECT pid FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND ${blockerPid} = ANY(pg_blocking_pids(pid))
      ORDER BY pid LIMIT 1
    `
    if (row) return Number(row.pid)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for account-deletion waiter behind PID ${blockerPid}`)
}

async function runQueuedAccountOperations(
  lock: 'user' | 'membership',
  workspaceId: string,
  userId: string,
  first: () => Promise<unknown>,
  second: () => Promise<unknown>,
): Promise<[PromiseSettledResult<unknown>, PromiseSettledResult<unknown>]> {
  let locked!: (pid: number) => void
  let release!: () => void
  const lockedPromise = new Promise<number>((resolve) => { locked = resolve })
  const releasePromise = new Promise<void>((resolve) => { release = resolve })
  const blocker = sqlClient.begin(async (tx) => {
    if (lock === 'user') await tx`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`
    else await tx`SELECT user_id FROM workspace_members WHERE workspace_id = ${workspaceId} AND user_id = ${userId} FOR UPDATE`
    const [connection] = await tx`SELECT pg_backend_pid()::int AS pid`
    locked(Number(connection.pid))
    await releasePromise
  })
  try {
    const blockerPid = await Promise.race([
      lockedPromise,
      blocker.then(() => { throw new Error('Account-deletion lock blocker exited early') }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Account-deletion lock blocker timed out')), 6_000)),
    ])
    const firstResult = first()
    const firstWaiterPid = await waitForLockWaiter(blockerPid)
    const secondResult = second()
    await waitForLockWaiter(firstWaiterPid)
    release()
    return await Promise.allSettled([firstResult, secondResult]) as [PromiseSettledResult<unknown>, PromiseSettledResult<unknown>]
  } finally {
    release()
    await blocker
  }
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
  for (const table of ['boring_usage_reservations', 'boring_usage_ledger', 'boring_credit_grants', 'boring_credit_purchases']) {
    await sqlClient`
      DELETE FROM ${sqlClient(table)}
      WHERE user_id IN (SELECT id::text FROM users WHERE email LIKE ${emailPattern})
    `
  }
  await sqlClient`
    DELETE FROM users
    WHERE email LIKE ${emailPattern}
  `
})

describe('deleteUserCompletely', () => {
  it('blocks a protected co-owner before account or membership mutation', async () => {
    const owner = await seedUser('protected-owner')
    const peer = await seedUser('protected-peer')
    const workspaceId = await seedWorkspace(owner.id, 'Protected Workspace')
    await workspaceStore.upsertMember(workspaceId, peer.id, 'owner')
    await sqlClient`INSERT INTO boring_credit_grants (user_id, reason, amount_micros) VALUES (${owner.id}, 'signup_grant', 1000000)`

    await expect(deleteUserCompletely(owner.id, {
      db: drizzle(sqlClient), protectedWorkspaceId: workspaceId,
    })).rejects.toMatchObject({
      status: 403,
      code: ERROR_CODES.D1_MANAGED_WORKSPACE_MUTATION_FORBIDDEN,
    })

    expect(await userStore.getById(owner.id)).not.toBeNull()
    expect(await workspaceStore.getMemberRole(workspaceId, owner.id)).toBe('owner')
    expect(await workspaceStore.getMemberRole(workspaceId, peer.id)).toBe('owner')
    expect((await sqlClient`SELECT created_by FROM workspaces WHERE id = ${workspaceId}`)[0].created_by).toBe(owner.id)
    expect((await sqlClient`SELECT COUNT(*)::int AS count FROM boring_credit_grants WHERE user_id = ${owner.id}`)[0].count).toBe(1)
  })

  it.each([
    ['first owner insertion', 'user', false],
    ['existing editor promotion', 'membership', true],
  ] as const)('serializes %s against protected account deletion in both orders', async (_case, lock, seedEditor) => {
    for (const promotionFirst of [true, false]) {
      const workspaceOwner = await seedUser(`race-owner-${lock}-${promotionFirst}`)
      const target = await seedUser(`race-target-${lock}-${promotionFirst}`)
      const workspaceId = await seedWorkspace(workspaceOwner.id, `Race ${lock}`)
      if (seedEditor) await workspaceStore.upsertMember(workspaceId, target.id, 'editor')
      const promote = () => workspaceStore.upsertMember(workspaceId, target.id, 'owner')
      const deleteAccount = () => deleteUserCompletely(target.id, {
        db: drizzle(sqlClient), protectedWorkspaceId: workspaceId,
      })

      const [first, second] = await runQueuedAccountOperations(
        lock, workspaceId, target.id,
        promotionFirst ? promote : deleteAccount,
        promotionFirst ? deleteAccount : promote,
      )
      const promotion = promotionFirst ? first : second
      const deletion = promotionFirst ? second : first
      if (promotionFirst) {
        expect(promotion.status).toBe('fulfilled')
        expect(deletion).toMatchObject({
          status: 'rejected',
          reason: { status: 403, code: ERROR_CODES.D1_MANAGED_WORKSPACE_MUTATION_FORBIDDEN },
        })
        expect(await userStore.getById(target.id)).not.toBeNull()
        expect(await workspaceStore.getMemberRole(workspaceId, target.id)).toBe('owner')
      } else {
        expect(deletion.status).toBe('fulfilled')
        expect(promotion.status).toBe('rejected')
        expect(await userStore.getById(target.id)).toBeNull()
        expect(await workspaceStore.getMemberRole(workspaceId, target.id)).toBeNull()
      }
    }
  })

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

  it('deletes the user credit/metering rows (grants, usage, reservations, purchases) with the account', async () => {
    const user = await seedUser('with-credits')
    await sqlClient`INSERT INTO boring_credit_grants (user_id, reason, amount_micros) VALUES (${user.id}, 'signup_grant', 2000000)`
    await sqlClient`INSERT INTO boring_usage_ledger (id, user_id, source, billed_cost_micros) VALUES (${`u-${randomUUID()}`}, ${user.id}, 'pi-chat', 100000)`
    await sqlClient`INSERT INTO boring_usage_reservations (user_id, run_id, amount_micros, expires_at) VALUES (${user.id}, ${`r-${randomUUID()}`}, 250000, NOW() + interval '1 hour')`
    await sqlClient`INSERT INTO boring_credit_purchases (order_id, user_id, amount_micros, status) VALUES (${`ls:default:test:ord-${randomUUID()}`}, ${user.id}, 10000000, 'granted')`

    await deleteUserCompletely(user.id, { db: drizzle(sqlClient) })

    expect(await userStore.getById(user.id)).toBeNull()
    for (const table of ['boring_credit_grants', 'boring_usage_ledger', 'boring_usage_reservations', 'boring_credit_purchases']) {
      const [row] = await sqlClient`SELECT COUNT(*)::int AS count FROM ${sqlClient(table)} WHERE user_id = ${user.id}`
      expect(row.count).toBe(0)
    }
  })

  it('promotes oldest editor for sole-owner workspaces and deletes workspaces with no editors', async () => {
    const owner = await seedUser('sole-owner')
    const oldestEditor = await seedUser('oldest-editor')
    const newerEditor = await seedUser('newer-editor')
    const viewerOnly = await seedUser('viewer-only')

    const promotedWorkspaceId = await seedWorkspace(owner.id, 'Promoted WS')
    await sqlClient`
      INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
      VALUES
        (${promotedWorkspaceId}, ${oldestEditor.id}, 'editor', NOW() - interval '2 minutes'),
        (${promotedWorkspaceId}, ${newerEditor.id}, 'editor', NOW() - interval '1 minute')
    `

    const deletedWorkspaceId = await seedWorkspace(owner.id, 'Deleted WS')
    await sqlClient`
      INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
      VALUES (${deletedWorkspaceId}, ${viewerOnly.id}, 'viewer', NOW() - interval '1 minute')
    `

    await deleteUserCompletely(owner.id, {
      db: drizzle(sqlClient),
    })

    expect(await userStore.getById(owner.id)).toBeNull()

    const [createdByRow] = await sqlClient`
      SELECT created_by
      FROM workspaces
      WHERE id = ${promotedWorkspaceId}
    `
    expect(createdByRow.created_by).toBe(oldestEditor.id)

    const promotedRole = await workspaceStore.getMemberRole(
      promotedWorkspaceId,
      oldestEditor.id,
    )
    expect(promotedRole).toBe('owner')
    expect(
      await workspaceStore.getMemberRole(promotedWorkspaceId, owner.id),
    ).toBeNull()

    const [newerRoleRow] = await sqlClient`
      SELECT role
      FROM workspace_members
      WHERE workspace_id = ${promotedWorkspaceId}
        AND user_id = ${newerEditor.id}
    `
    expect(newerRoleRow.role).toBe('editor')

    const [deletedWorkspaceCount] = await sqlClient`
      SELECT COUNT(*)::int AS count
      FROM workspaces
      WHERE id = ${deletedWorkspaceId}
    `
    expect(deletedWorkspaceCount.count).toBe(0)

    const [deletedMembersCount] = await sqlClient`
      SELECT COUNT(*)::int AS count
      FROM workspace_members
      WHERE workspace_id = ${deletedWorkspaceId}
    `
    expect(deletedMembersCount.count).toBe(0)
    expect(
      await workspaceStore.getMemberRole(deletedWorkspaceId, viewerOnly.id),
    ).toBeNull()
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
