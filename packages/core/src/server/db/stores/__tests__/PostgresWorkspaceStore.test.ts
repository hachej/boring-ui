import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'

import { runMigrations } from '../../migrate'
import { PostgresWorkspaceStore } from '../PostgresWorkspaceStore'
import { PostgresUserStore } from '../PostgresUserStore'
import { ERROR_CODES } from '../../../../shared/errors'
import type { CoreConfig } from '../../../../shared/types'
import { describeWorkspaceStoreConformance } from '../../__tests__/storeConformance'

const TEST_DB_URL = process.env.DATABASE_URL ?? 'postgres://ubuntu:test@localhost/boring_ui_test'
const ENCRYPTION_KEY_A = 'a'.repeat(64)
const ENCRYPTION_KEY_B = 'b'.repeat(64)

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
  encryption: { workspaceSettingsKey: ENCRYPTION_KEY_A },
  auth: {
    secret: 's'.repeat(64),
    url: 'http://localhost:3000',
    sessionTtlSeconds: 3600,
    sessionCookieSecure: false,
  },
  features: { githubOauth: false, googleOauth: false, invitesEnabled: true, sendWelcomeEmail: true, inviteTtlDays: 7 },
}

let sqlClient: postgres.Sql
let store: PostgresWorkspaceStore
let wrongKeyStore: PostgresWorkspaceStore
let userStore: PostgresUserStore

async function seedWorkspace(appId = 'orm1-app') {
  const emailTag = randomUUID().slice(0, 8)
  const [owner] = await sqlClient`
    INSERT INTO users (name, email, email_verified)
    VALUES ('ORM1 Owner', ${`orm1-${emailTag}@orm1-test.dev`}, true)
    RETURNING id
  `

  const [workspace] = await sqlClient`
    INSERT INTO workspaces (app_id, name, created_by, is_default)
    VALUES (${appId}, 'ORM1 Workspace', ${owner.id}, false)
    RETURNING id, app_id
  `

  return {
    ownerId: owner.id as string,
    workspaceId: workspace.id as string,
    appId: workspace.app_id as string,
  }
}

async function waitForMemberLockWaiter(blockerPid: number): Promise<number> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const [row] = await sqlClient`
      SELECT pid FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND query ILIKE '%workspace_members%'
        AND ${blockerPid} = ANY(pg_blocking_pids(pid))
      ORDER BY pid LIMIT 1
    `
    if (row) return Number(row.pid)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for membership waiter behind PID ${blockerPid}`)
}

async function runQueuedMemberOperations(
  workspaceId: string,
  userId: string,
  first: () => Promise<unknown>,
  second: () => Promise<unknown>,
): Promise<[unknown, unknown]> {
  let locked!: (pid: number) => void
  let release!: () => void
  const lockedPromise = new Promise<number>((resolve) => { locked = resolve })
  const releasePromise = new Promise<void>((resolve) => { release = resolve })
  const blocker = sqlClient.begin(async (tx) => {
    await tx`SELECT user_id FROM workspace_members WHERE workspace_id = ${workspaceId} AND user_id = ${userId} FOR UPDATE`
    const [connection] = await tx`SELECT pg_backend_pid()::int AS pid`
    locked(Number(connection.pid))
    await releasePromise
  })
  try {
    const blockerPid = await Promise.race([
      lockedPromise,
      blocker.then(() => { throw new Error('Membership lock blocker exited early') }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Membership lock blocker timed out')), 6_000)),
    ])
    const firstResult = first()
    const firstWaiterPid = await waitForMemberLockWaiter(blockerPid)
    const secondResult = second()
    await waitForMemberLockWaiter(firstWaiterPid)
    release()
    return await Promise.all([firstResult, secondResult])
  } finally {
    release()
    await blocker
  }
}

beforeAll(async () => {
  await runMigrations(BASE_CONFIG)
  sqlClient = postgres(TEST_DB_URL, { max: 4 })
  const db = drizzle(sqlClient)
  store = new PostgresWorkspaceStore(db, ENCRYPTION_KEY_A)
  wrongKeyStore = new PostgresWorkspaceStore(db, ENCRYPTION_KEY_B)
  userStore = new PostgresUserStore(db)
})

afterAll(async () => {
  await sqlClient.end()
})

beforeEach(async () => {
  await sqlClient`
    DELETE FROM workspace_invites
    WHERE workspace_id IN (
      SELECT id FROM workspaces WHERE app_id IN ('orm1-app', 'orm1-app-2', 'ui-app')
    )
  `
  await sqlClient`
    DELETE FROM workspace_members
    WHERE workspace_id IN (
      SELECT id FROM workspaces WHERE app_id IN ('orm1-app', 'orm1-app-2', 'ui-app')
    )
  `
  await sqlClient`
    DELETE FROM workspace_runtimes
    WHERE workspace_id IN (
      SELECT id FROM workspaces WHERE app_id IN ('orm1-app', 'orm1-app-2', 'ui-app')
    )
  `
  await sqlClient`
    DELETE FROM workspace_settings
    WHERE workspace_id IN (
      SELECT id FROM workspaces WHERE app_id IN ('orm1-app', 'orm1-app-2', 'ui-app')
    )
  `
  await sqlClient`DELETE FROM user_settings WHERE app_id IN ('orm1-app', 'orm1-app-2', 'ui-app')`
  await sqlClient`DELETE FROM workspaces WHERE app_id IN ('orm1-app', 'orm1-app-2', 'ui-app')`
  await sqlClient`DELETE FROM users WHERE email LIKE '%@orm1-test.dev'`
})

describe('PostgresWorkspaceStore Sub-PR3', () => {
  it.each(['update', 'remove'] as const)('serializes managed %s against owner promotion in both orders', async (operation) => {
    const { workspaceId } = await seedWorkspace()
    const [target] = await sqlClient`
      INSERT INTO users (name, email, email_verified)
      VALUES ('Race Target', ${`race-${randomUUID()}@orm1-test.dev`}, true) RETURNING id
    `
    const userId = target.id as string
    const protect = () => operation === 'update'
      ? store.updateMemberRole(workspaceId, userId, 'viewer', { forbidExistingOwnerMutation: true })
      : store.removeMember(workspaceId, userId, { forbidExistingOwnerMutation: true })
    const promote = () => store.upsertMember(workspaceId, userId, 'owner')

    await store.upsertMember(workspaceId, userId, 'editor')
    const [, protectedAfterPromotion] = await runQueuedMemberOperations(workspaceId, userId, promote, protect)
    expect(protectedAfterPromotion).toMatchObject({ code: ERROR_CODES.AGENT_HOST_MANAGED_WORKSPACE_MUTATION_FORBIDDEN })
    expect(await store.getMemberRole(workspaceId, userId)).toBe('owner')

    await store.upsertMember(workspaceId, userId, 'editor')
    const [protectedBeforePromotion] = await runQueuedMemberOperations(workspaceId, userId, protect, promote)
    expect(protectedBeforePromotion).toMatchObject(operation === 'update'
      ? { member: { role: 'viewer' } }
      : { removed: true })
    expect(await store.getMemberRole(workspaceId, userId)).toBe('owner')
  })

  describe('workspace settings', () => {
    it('putWorkspaceSettings stores encrypted values and getWorkspaceSettings returns metadata only', async () => {
      const { workspaceId } = await seedWorkspace()

      const metadata = await store.putWorkspaceSettings(workspaceId, {
        github_token: 'secret-token',
        github_installation: '12345',
      })

      expect(metadata).toHaveLength(2)
      expect(metadata.map((row) => row.key)).toEqual([
        'github_installation',
        'github_token',
      ])
      expect(metadata.every((row) => row.configured === true)).toBe(true)
      expect(metadata.every((row) => typeof row.updated_at === 'string')).toBe(true)
      expect((metadata[0] as Record<string, unknown>).value).toBeUndefined()

      const decrypted = await store.decryptSetting(workspaceId, 'github_token')
      expect(decrypted).toBe('secret-token')
    })

    it('key mismatch returns configured=false and decryptSetting returns null', async () => {
      const { workspaceId } = await seedWorkspace()
      await store.putWorkspaceSettings(workspaceId, { api_key: 'abc123' })

      const decrypted = await wrongKeyStore.decryptSetting(workspaceId, 'api_key')
      expect(decrypted).toBeNull()

      const metadata = await wrongKeyStore.getWorkspaceSettings(workspaceId)
      expect(metadata).toEqual([
        expect.objectContaining({ key: 'api_key', configured: false }),
      ])
    })
  })

  describe('workspace runtime', () => {
    it('getWorkspaceRuntime auto-creates ready runtime for existing workspace', async () => {
      const { workspaceId } = await seedWorkspace()

      const runtime = await store.getWorkspaceRuntime(workspaceId)
      expect(runtime).not.toBeNull()
      expect(runtime?.state).toBe('ready')
      expect(runtime?.workspaceId).toBe(workspaceId)

      const runtimeAgain = await store.getWorkspaceRuntime(workspaceId)
      expect(runtimeAgain?.state).toBe('ready')

      const [countRow] = await sqlClient`
        SELECT COUNT(*)::int AS count
        FROM workspace_runtimes
        WHERE workspace_id = ${workspaceId}
      `
      expect(countRow.count).toBe(1)
    })

    it('getWorkspaceRuntime returns null for missing workspace', async () => {
      const result = await store.getWorkspaceRuntime('00000000-0000-0000-0000-000000000000')
      expect(result).toBeNull()
    })

    it('putWorkspaceRuntime updates runtime fields including v7 columns', async () => {
      const { workspaceId } = await seedWorkspace()

      const updated = await store.putWorkspaceRuntime(workspaceId, {
        state: 'error',
        spriteUrl: 'https://cdn.example.com/sprite.png',
        spriteName: 'my-sprite',
        lastError: 'boot timeout',
        lastErrorOp: 'provision',
        volumePath: '/data/ws-123',
      })

      expect(updated.state).toBe('error')
      expect(updated.spriteUrl).toBe('https://cdn.example.com/sprite.png')
      expect(updated.spriteName).toBe('my-sprite')
      expect(updated.lastError).toBe('boot timeout')
      expect(updated.lastErrorOp).toBe('provision')
      expect(updated.volumePath).toBe('/data/ws-123')

      const persisted = await store.getWorkspaceRuntime(workspaceId)
      expect(persisted?.state).toBe('error')
      expect(persisted?.lastErrorOp).toBe('provision')
      expect(persisted?.volumePath).toBe('/data/ws-123')
    })

    it('retryWorkspaceRuntime transitions error -> pending and clears lastError', async () => {
      const { workspaceId } = await seedWorkspace()
      await store.putWorkspaceRuntime(workspaceId, {
        state: 'error',
        lastError: 'machine boot failed',
      })

      const retried = await store.retryWorkspaceRuntime(workspaceId)
      expect(retried).not.toBeNull()
      expect(retried?.state).toBe('pending')
      expect(retried?.lastError).toBeNull()

      const secondRetry = await store.retryWorkspaceRuntime(workspaceId)
      expect(secondRetry).toBeNull()
    })

    it('stores provider-agnostic runtime resources', async () => {
      const { workspaceId } = await seedWorkspace()

      const created = await store.putWorkspaceRuntimeResource(workspaceId, {
        kind: 'sandbox',
        purpose: 'main',
        provider: 'vercel',
        handleKind: 'named',
        stableKey: `boring-dev-${workspaceId}`,
        providerResourceId: 'sbx_current',
        state: 'ready',
        persistenceMode: 'persistent',
        providerMeta: { runtime: 'node24' },
        lastUsedAt: '2026-04-29T00:00:00.000Z',
      })

      expect(created.generation).toBe(0)
      expect(created.stableKey).toBe(`boring-dev-${workspaceId}`)

      const updated = await store.putWorkspaceRuntimeResource(workspaceId, {
        kind: 'sandbox',
        purpose: 'main',
        provider: 'vercel',
        handleKind: 'named',
        stableKey: `boring-dev-${workspaceId}`,
        providerResourceId: 'sbx_next',
        state: 'running',
        persistenceMode: 'persistent',
        providerMeta: { runtime: 'node24', region: 'iad1' },
      })

      expect(updated.id).toBe(created.id)
      expect(updated.generation).toBe(1)
      expect(updated.providerResourceId).toBe('sbx_next')

      const fetched = await store.getWorkspaceRuntimeResource(workspaceId, {
        kind: 'sandbox',
        purpose: 'main',
        provider: 'vercel',
      })
      expect(fetched?.providerMeta).toEqual({ runtime: 'node24', region: 'iad1' })

      await store.deleteWorkspaceRuntimeResource(workspaceId, {
        kind: 'sandbox',
        purpose: 'main',
        provider: 'vercel',
      })
      expect(await store.getWorkspaceRuntimeResource(workspaceId, {
        kind: 'sandbox',
        purpose: 'main',
        provider: 'vercel',
      })).toBeNull()
    })
  })

  describe('ui state', () => {
    it('getUiState returns null when missing and putUiState upserts state', async () => {
      const { ownerId, workspaceId, appId } = await seedWorkspace('ui-app')

      expect(await store.getUiState(ownerId, workspaceId)).toBeNull()

      await sqlClient`
        INSERT INTO user_settings (user_id, app_id, display_name, email, settings)
        VALUES (${ownerId}, ${appId}, 'Owner', 'owner@orm1-test.dev', '{"theme":"dark"}'::jsonb)
      `

      await store.putUiState(ownerId, workspaceId, {
        panel: 'chat',
        collapsed: true,
      })

      const state = await store.getUiState(ownerId, workspaceId)
      expect(state).toEqual({ panel: 'chat', collapsed: true })

      const [row] = await sqlClient`
        SELECT settings
        FROM user_settings
        WHERE user_id = ${ownerId} AND app_id = ${appId}
      `

      expect(row.settings.theme).toBe('dark')
    })

    it('putUiState bootstrap preserves profile display_name/email on first row', async () => {
      const { ownerId, workspaceId, appId } = await seedWorkspace('ui-app')

      await store.putUiState(ownerId, workspaceId, {
        panel: 'files',
      })

      const [row] = await sqlClient`
        SELECT display_name, email, settings
        FROM user_settings
        WHERE user_id = ${ownerId} AND app_id = ${appId}
      `

      expect(row.display_name).toBe('ORM1 Owner')
      expect(row.email).toMatch(/@orm1-test\.dev$/)
      expect(row.settings[`workspace_ui_state:${workspaceId}`]).toEqual({
        panel: 'files',
      })
    })
  })
})

// ---------------------------------------------------------------------------
// Sub-PR 1: Workspace CRUD + Members + Sole-owner
// ---------------------------------------------------------------------------

const APP_ID = 'orm1-app'
const APP_ID_2 = 'orm1-app-2'

async function seedUser(tag?: string): Promise<string> {
  const emailTag = tag ?? randomUUID().slice(0, 8)
  const [row] = await sqlClient`
    INSERT INTO users (name, email, email_verified)
    VALUES ('Test User', ${`pr1-${emailTag}@orm1-test.dev`}, true)
    RETURNING id
  `
  return row.id as string
}

describe('PostgresWorkspaceStore Sub-PR1', () => {
  describe('create', () => {
    it('returns a Workspace and auto-inserts the creator as owner member', async () => {
      const userId = await seedUser()
      const ws = await store.create(userId, 'My WS', APP_ID)

      expect(ws.id).toBeDefined()
      expect(ws.appId).toBe(APP_ID)
      expect(ws.name).toBe('My WS')
      expect(ws.createdBy).toBe(userId)
      expect(ws.deletedAt).toBeNull()
      expect(ws.isDefault).toBe(false)

      const role = await store.getMemberRole(ws.id, userId)
      expect(role).toBe('owner')
    })

    it('is transactional — no orphan workspace when create fails', async () => {
      const fakeUser = '00000000-0000-0000-0000-ffffffffffff'
      await expect(store.create(fakeUser, 'Bad', APP_ID)).rejects.toThrow()

      const [row] = await sqlClient`
        SELECT count(*)::int AS count FROM workspaces
        WHERE name = 'Bad' AND app_id = ${APP_ID}
      `
      expect(row.count).toBe(0)
    })

    it('rolls back workspace if member insert fails (invalid role)', async () => {
      const userId = await seedUser('tx-role')
      const beforeCount = await sqlClient`
        SELECT count(*)::int AS count FROM workspaces WHERE app_id = ${APP_ID}
      `

      await expect(
        store['db'].transaction(async (tx) => {
          const [row] = await tx
            .insert(
              (await import('../../schema.js')).workspaces,
            )
            .values({ appId: APP_ID, name: 'TxTest', createdBy: userId })
            .returning()
          await tx.insert(
            (await import('../../schema.js')).workspaceMembers,
          ).values({ workspaceId: row.id, userId, role: 'superadmin' as any })
        }),
      ).rejects.toThrow()

      const afterCount = await sqlClient`
        SELECT count(*)::int AS count FROM workspaces WHERE app_id = ${APP_ID}
      `
      expect(Number(afterCount[0].count)).toBe(Number(beforeCount[0].count))
    })
  })

  describe('list', () => {
    it('returns only workspaces where user is a member', async () => {
      const userA = await seedUser('list-a')
      const userB = await seedUser('list-b')

      await store.create(userA, 'WS-A', APP_ID)
      await store.create(userB, 'WS-B', APP_ID)

      const listA = await store.list(userA, APP_ID)
      expect(listA).toHaveLength(1)
      expect(listA[0].name).toBe('WS-A')
    })

    it('filters by appId', async () => {
      const userId = await seedUser('list-app')
      await store.create(userId, 'WS-App1', APP_ID)
      await store.create(userId, 'WS-App2', APP_ID_2)

      const list1 = await store.list(userId, APP_ID)
      expect(list1).toHaveLength(1)
      expect(list1[0].name).toBe('WS-App1')

      const list2 = await store.list(userId, APP_ID_2)
      expect(list2).toHaveLength(1)
      expect(list2[0].name).toBe('WS-App2')
    })

    it('excludes soft-deleted workspaces', async () => {
      const userId = await seedUser('list-del')
      const ws = await store.create(userId, 'Gone', APP_ID)
      await store.delete(ws.id)

      const list = await store.list(userId, APP_ID)
      expect(list).toHaveLength(0)
    })

    it('orders isDefault DESC, then createdAt DESC', async () => {
      const userId = await seedUser('list-ord')
      const ws1 = await store.create(userId, 'First', APP_ID)
      const ws2 = await store.create(userId, 'Second', APP_ID)

      await sqlClient`UPDATE workspaces SET is_default = true WHERE id = ${ws1.id}`

      const list = await store.list(userId, APP_ID)
      expect(list[0].name).toBe('First')
      expect(list[1].name).toBe('Second')
    })
  })

  describe('get', () => {
    it('returns workspace by id', async () => {
      const userId = await seedUser()
      const ws = await store.create(userId, 'GetMe', APP_ID)
      const got = await store.get(ws.id)
      expect(got).not.toBeNull()
      expect(got!.name).toBe('GetMe')
    })

    it('returns null for unknown id', async () => {
      const got = await store.get('00000000-0000-0000-0000-000000000000')
      expect(got).toBeNull()
    })

    it('returns null for soft-deleted workspace', async () => {
      const userId = await seedUser()
      const ws = await store.create(userId, 'SoftDel', APP_ID)
      await store.delete(ws.id)
      expect(await store.get(ws.id)).toBeNull()
    })
  })

  describe('update', () => {
    it('updates name and returns updated workspace', async () => {
      const userId = await seedUser()
      const ws = await store.create(userId, 'Old', APP_ID)
      const updated = await store.update(ws.id, { name: 'New' })
      expect(updated).not.toBeNull()
      expect(updated!.name).toBe('New')
    })

    it('returns null for soft-deleted workspace', async () => {
      const userId = await seedUser()
      const ws = await store.create(userId, 'Del', APP_ID)
      await store.delete(ws.id)
      expect(await store.update(ws.id, { name: 'Nope' })).toBeNull()
    })
  })

  describe('delete', () => {
    it('soft-deletes and sets deletedAt', async () => {
      const userId = await seedUser()
      const ws = await store.create(userId, 'ToDelete', APP_ID)
      const result = await store.delete(ws.id)
      expect(result).toEqual({ removed: true })

      const [row] = await sqlClient`
        SELECT deleted_at FROM workspaces WHERE id = ${ws.id}
      `
      expect(row.deleted_at).not.toBeNull()
    })

    it('returns NOT_FOUND for unknown id', async () => {
      const result = await store.delete('00000000-0000-0000-0000-000000000000')
      expect(result).toEqual({ removed: false, code: ERROR_CODES.NOT_FOUND })
    })

  })

  describe('isMember / getMemberRole', () => {
    it('isMember returns true/false correctly', async () => {
      const userA = await seedUser('mem-a')
      const userB = await seedUser('mem-b')
      const ws = await store.create(userA, 'MemberTest', APP_ID)

      expect(await store.isMember(ws.id, userA)).toBe(true)
      expect(await store.isMember(ws.id, userB)).toBe(false)
    })

    it('getMemberRole returns role or null', async () => {
      const userId = await seedUser()
      const ws = await store.create(userId, 'RoleTest', APP_ID)

      expect(await store.getMemberRole(ws.id, userId)).toBe('owner')
      expect(await store.getMemberRole(ws.id, '00000000-0000-0000-0000-000000000000')).toBeNull()
    })
  })

  describe('listMembers', () => {
    it('returns members enriched with user info', async () => {
      const userId = await seedUser('lm')
      const ws = await store.create(userId, 'ListM', APP_ID)

      const members = await store.listMembers(ws.id)
      expect(members).toHaveLength(1)
      expect(members[0].role).toBe('owner')
      expect(members[0].user.id).toBe(userId)
      expect(members[0].user.email).toContain('@orm1-test.dev')
      expect(members[0].user).toHaveProperty('name')
      expect(members[0].user).toHaveProperty('image')
    })
  })

  describe('upsertMember', () => {
    it('inserts a new member', async () => {
      const owner = await seedUser('ups-own')
      const editor = await seedUser('ups-ed')
      const ws = await store.create(owner, 'Upsert', APP_ID)

      const member = await store.upsertMember(ws.id, editor, 'editor')
      expect(member.role).toBe('editor')
      expect(member.userId).toBe(editor)
      expect(await store.isMember(ws.id, editor)).toBe(true)
    })

    it('updates role on conflict', async () => {
      const owner = await seedUser('ups-upd')
      const ws = await store.create(owner, 'Upsert2', APP_ID)

      await store.upsertMember(ws.id, owner, 'editor')
      const role = await store.getMemberRole(ws.id, owner)
      expect(role).toBe('editor')
    })
  })

  describe('removeMember', () => {
    it('removes an existing member', async () => {
      const owner = await seedUser('rm-own')
      const editor = await seedUser('rm-ed')
      const ws = await store.create(owner, 'Remove', APP_ID)
      await store.upsertMember(ws.id, editor, 'editor')

      const result = await store.removeMember(ws.id, editor)
      expect(result).toEqual({ removed: true })
      expect(await store.isMember(ws.id, editor)).toBe(false)
    })

    it('returns NOT_MEMBER for non-member', async () => {
      const owner = await seedUser('rm-nm')
      const ws = await store.create(owner, 'RemoveNM', APP_ID)

      const result = await store.removeMember(ws.id, '00000000-0000-0000-0000-000000000000')
      expect(result).toEqual({ removed: false, code: ERROR_CODES.NOT_MEMBER })
    })

    it('returns LAST_OWNER when removing the sole owner', async () => {
      const owner = await seedUser('rm-lo')
      const ws = await store.create(owner, 'LastOwner', APP_ID)

      const result = await store.removeMember(ws.id, owner)
      expect(result).toEqual({ removed: false, code: ERROR_CODES.LAST_OWNER })
    })

    it('allows removing an owner when another co-owner exists', async () => {
      const ownerA = await seedUser('rm-coa')
      const ownerB = await seedUser('rm-cob')
      const ws = await store.create(ownerA, 'CoOwner', APP_ID)
      await store.upsertMember(ws.id, ownerB, 'owner')

      const result = await store.removeMember(ws.id, ownerA)
      expect(result).toEqual({ removed: true })
    })

  })

  describe('getWorkspacesWhereSoleOwner', () => {
    it('returns empty when user owns nothing', async () => {
      const userId = await seedUser('sole-none')
      const result = await store.getWorkspacesWhereSoleOwner(userId)
      expect(result).toHaveLength(0)
    })

    it('returns workspace where user is the sole owner', async () => {
      const userId = await seedUser('sole-one')
      const ws = await store.create(userId, 'SoleWS', APP_ID)

      const result = await store.getWorkspacesWhereSoleOwner(userId)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe(ws.id)
    })

    it('excludes workspace with a co-owner', async () => {
      const userA = await seedUser('sole-co-a')
      const userB = await seedUser('sole-co-b')
      const ws = await store.create(userA, 'CoOwnedWS', APP_ID)
      await store.upsertMember(ws.id, userB, 'owner')

      const result = await store.getWorkspacesWhereSoleOwner(userA)
      expect(result).toHaveLength(0)
    })

    it('excludes soft-deleted workspaces', async () => {
      const userId = await seedUser('sole-del')
      const ws = await store.create(userId, 'DeletedSole', APP_ID)
      await store.delete(ws.id)

      const result = await store.getWorkspacesWhereSoleOwner(userId)
      expect(result).toHaveLength(0)
    })

    it('excludes workspace where user is editor (not owner)', async () => {
      const owner = await seedUser('sole-ed-own')
      const editor = await seedUser('sole-ed-ed')
      const ws = await store.create(owner, 'EditorWS', APP_ID)
      await store.upsertMember(ws.id, editor, 'editor')

      const result = await store.getWorkspacesWhereSoleOwner(editor)
      expect(result).toHaveLength(0)
    })

    it('mixed: returns sole-owned but not co-owned', async () => {
      const userA = await seedUser('sole-mix-a')
      const userB = await seedUser('sole-mix-b')
      const wsSole = await store.create(userA, 'Sole', APP_ID)
      const wsShared = await store.create(userA, 'Shared', APP_ID)
      await store.upsertMember(wsShared.id, userB, 'owner')

      const result = await store.getWorkspacesWhereSoleOwner(userA)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe(wsSole.id)
    })
  })
})

describeWorkspaceStoreConformance(
  async () => store,
  {
    makeUserStore: async () => userStore,
    deleteRuntime: async (workspaceId: string) => {
      await sqlClient`DELETE FROM workspace_runtimes WHERE workspace_id = ${workspaceId}`
    },
    expireInvite: async (workspaceId: string, inviteId: string) => {
      await sqlClient`
        UPDATE workspace_invites
        SET expires_at = NOW() - interval '1 minute'
        WHERE workspace_id = ${workspaceId} AND id = ${inviteId}
      `
    },
    makeAppIds: () => ({ appId: APP_ID, otherAppId: APP_ID_2 }),
    emailDomain: 'orm1-test.dev',
  },
)
