import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { runMigrations } from '../migrate'
import type { CoreConfig } from '../../../shared/types'

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

let sql: postgres.Sql
let userAId: string
let userBId: string

beforeAll(async () => {
  await runMigrations(BASE_CONFIG)
  sql = postgres(TEST_DB_URL, { max: 1 })
  const [userA] = await sql`
    INSERT INTO users (name, email, email_verified)
    VALUES ('User A', 'ws-test-a@example.com', true)
    RETURNING id
  `
  const [userB] = await sql`
    INSERT INTO users (name, email, email_verified)
    VALUES ('User B', 'ws-test-b@example.com', true)
    RETURNING id
  `
  userAId = userA.id
  userBId = userB.id
})

afterAll(async () => {
  await sql`DELETE FROM workspaces WHERE created_by IN (${userAId}, ${userBId})`
  await sql`DELETE FROM users WHERE id IN (${userAId}, ${userBId})`
  await sql.end()
})

describe('workspaces schema', () => {
  it('inserts a workspace with defaults', async () => {
    const [ws] = await sql`
      INSERT INTO workspaces (app_id, name, created_by)
      VALUES ('app1', 'Default workspace', ${userAId})
      RETURNING *
    `
    expect(ws.id).toBeDefined()
    expect(ws.app_id).toBe('app1')
    expect(ws.name).toBe('Default workspace')
    expect(ws.created_by).toBe(userAId)
    expect(ws.created_at).toBeDefined()
    expect(ws.deleted_at).toBeNull()
    expect(ws.is_default).toBe(false)

    await sql`DELETE FROM workspaces WHERE id = ${ws.id}`
  })

  it('partial unique index: rejects second default for same (user, app)', async () => {
    await sql`
      INSERT INTO workspaces (app_id, name, created_by, is_default)
      VALUES ('dup-app', 'Default 1', ${userAId}, true)
    `
    await expect(
      sql`INSERT INTO workspaces (app_id, name, created_by, is_default)
          VALUES ('dup-app', 'Default 2', ${userAId}, true)`,
    ).rejects.toThrow(/duplicate key|unique/)

    await sql`DELETE FROM workspaces WHERE created_by = ${userAId} AND app_id = 'dup-app'`
  })

  it('partial unique index: allows non-default duplicates for same (user, app)', async () => {
    await sql`
      INSERT INTO workspaces (app_id, name, created_by, is_default)
      VALUES ('multi-app', 'WS 1', ${userAId}, false)
    `
    await sql`
      INSERT INTO workspaces (app_id, name, created_by, is_default)
      VALUES ('multi-app', 'WS 2', ${userAId}, false)
    `
    const rows = await sql`
      SELECT id FROM workspaces
      WHERE created_by = ${userAId} AND app_id = 'multi-app'
    `
    expect(rows).toHaveLength(2)

    await sql`DELETE FROM workspaces WHERE created_by = ${userAId} AND app_id = 'multi-app'`
  })

  it('cross-app isolation: default per (userA, appX) AND (userA, appY) both succeed', async () => {
    await sql`
      INSERT INTO workspaces (app_id, name, created_by, is_default)
      VALUES ('appX', 'Default X', ${userAId}, true)
    `
    await sql`
      INSERT INTO workspaces (app_id, name, created_by, is_default)
      VALUES ('appY', 'Default Y', ${userAId}, true)
    `
    const rows = await sql`
      SELECT app_id FROM workspaces
      WHERE created_by = ${userAId} AND is_default = true AND app_id IN ('appX', 'appY')
      ORDER BY app_id
    `
    expect(rows).toHaveLength(2)
    expect(rows[0].app_id).toBe('appX')
    expect(rows[1].app_id).toBe('appY')

    await sql`DELETE FROM workspaces WHERE created_by = ${userAId} AND app_id IN ('appX', 'appY')`
  })

  it('cross-user isolation: different users can each have a default for same app', async () => {
    await sql`
      INSERT INTO workspaces (app_id, name, created_by, is_default)
      VALUES ('shared-app', 'A Default', ${userAId}, true)
    `
    await sql`
      INSERT INTO workspaces (app_id, name, created_by, is_default)
      VALUES ('shared-app', 'B Default', ${userBId}, true)
    `
    const rows = await sql`
      SELECT created_by FROM workspaces
      WHERE app_id = 'shared-app' AND is_default = true
      ORDER BY created_by
    `
    expect(rows).toHaveLength(2)

    await sql`DELETE FROM workspaces WHERE app_id = 'shared-app'`
  })

  it('soft delete: sets deleted_at without removing row', async () => {
    const [ws] = await sql`
      INSERT INTO workspaces (app_id, name, created_by)
      VALUES ('soft-del', 'To Delete', ${userAId})
      RETURNING id
    `
    await sql`UPDATE workspaces SET deleted_at = NOW() WHERE id = ${ws.id}`
    const [row] = await sql`SELECT deleted_at FROM workspaces WHERE id = ${ws.id}`
    expect(row.deleted_at).not.toBeNull()

    await sql`DELETE FROM workspaces WHERE id = ${ws.id}`
  })

  it('createdBy FK has NO cascade — workspace survives user deletion', async () => {
    const [tempUser] = await sql`
      INSERT INTO users (name, email, email_verified)
      VALUES ('Temp Owner', 'ws-temp-owner@example.com', true)
      RETURNING id
    `
    const [ws] = await sql`
      INSERT INTO workspaces (app_id, name, created_by)
      VALUES ('orphan-app', 'Orphaned WS', ${tempUser.id})
      RETURNING id
    `
    await expect(
      sql`DELETE FROM users WHERE id = ${tempUser.id}`,
    ).rejects.toThrow(/foreign key|violates/)

    await sql`DELETE FROM workspaces WHERE id = ${ws.id}`
    await sql`DELETE FROM users WHERE id = ${tempUser.id}`
  })
})
