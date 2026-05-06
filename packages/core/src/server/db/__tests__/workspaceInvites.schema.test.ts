import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import postgres from 'postgres'
import { runMigrations } from '../migrate'
import type { CoreConfig } from '../../../shared/types'

const TEST_DB_URL = 'postgres://ubuntu:test@localhost/boring_ui_test'

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
  features: { githubOauth: false, invitesEnabled: true, sendWelcomeEmail: true, inviteTtlDays: 7 },
}

let sql: postgres.Sql

beforeAll(async () => {
  await runMigrations(BASE_CONFIG)
  sql = postgres(TEST_DB_URL, { max: 5 })
})

afterAll(async () => {
  await sql.end()
})

beforeEach(async () => {
  await sql`DELETE FROM workspace_invites WHERE workspace_id = ${WS_ID}`
})

async function ensureUser(id: string, email: string) {
  await sql`
    INSERT INTO users (id, email, name, email_verified, created_at, updated_at)
    VALUES (${id}, ${email}, 'Test', false, now(), now())
    ON CONFLICT (id) DO NOTHING
  `
}

async function ensureWorkspace(id: string, createdBy: string) {
  await sql`
    INSERT INTO workspaces (id, app_id, name, created_by, is_default)
    VALUES (${id}, 'test-app', 'Test WS', ${createdBy}, false)
    ON CONFLICT (id) DO NOTHING
  `
}

const USER_ID = '20000000-0000-0000-0000-000000000001'
const WS_ID = '30000000-0000-0000-0000-000000000001'

describe('workspace_invites schema', () => {
  beforeAll(async () => {
    await ensureUser(USER_ID, 'inviter@test.com')
    await ensureWorkspace(WS_ID, USER_ID)
  })

  it('expires_at has no SQL default — insert requires explicit value', async () => {
    await expect(
      sql`
        INSERT INTO workspace_invites (workspace_id, email, token_hash, role, created_by)
        VALUES (${WS_ID}, 'invitee@test.com', 'hash_no_default', 'editor', ${USER_ID})
      `,
    ).rejects.toThrow(/null value.*expires_at|not-null/i)
  })

  it('insert succeeds with explicit expires_at', async () => {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const [row] = await sql`
      INSERT INTO workspace_invites (workspace_id, email, token_hash, role, expires_at, created_by)
      VALUES (${WS_ID}, 'invitee@test.com', 'hash_explicit_exp', 'editor', ${expiresAt}, ${USER_ID})
      RETURNING expires_at, failed_attempts, locked_until
    `
    expect(new Date(row.expires_at).getTime()).toBeGreaterThan(Date.now())
    expect(row.failed_attempts).toBe(0)
    expect(row.locked_until).toBeNull()
  })

  it('unique violation on duplicate tokenHash', async () => {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    await sql`
      INSERT INTO workspace_invites (workspace_id, email, token_hash, role, expires_at, created_by)
      VALUES (${WS_ID}, 'a@test.com', 'hash_unique_test', 'viewer', ${expiresAt}, ${USER_ID})
    `
    await expect(
      sql`
        INSERT INTO workspace_invites (workspace_id, email, token_hash, role, expires_at, created_by)
        VALUES (${WS_ID}, 'b@test.com', 'hash_unique_test', 'editor', ${expiresAt}, ${USER_ID})
      `,
    ).rejects.toThrow(/unique/i)
  })

  it('role check constraint rejects invalid roles', async () => {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    await expect(
      sql`
        INSERT INTO workspace_invites (workspace_id, email, token_hash, role, expires_at, created_by)
        VALUES (${WS_ID}, 'c@test.com', 'hash_bad_role', 'admin', ${expiresAt}, ${USER_ID})
      `,
    ).rejects.toThrow(/check/i)
  })

  it('createdBy ON DELETE RESTRICT prevents user deletion', async () => {
    const tempUserId = '20000000-0000-0000-0000-000000000099'
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    await ensureUser(tempUserId, 'restrict@test.com')
    await sql`
      INSERT INTO workspace_invites (workspace_id, email, token_hash, role, expires_at, created_by)
      VALUES (${WS_ID}, 'd@test.com', 'hash_restrict_test', 'viewer', ${expiresAt}, ${tempUserId})
    `
    await expect(
      sql`DELETE FROM users WHERE id = ${tempUserId}`,
    ).rejects.toThrow(/foreign key constraint/i)

    await sql`DELETE FROM workspace_invites WHERE token_hash = 'hash_restrict_test'`
    await sql`DELETE FROM users WHERE id = ${tempUserId}`
  })

  it('acceptedAt is nullable', async () => {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const [row] = await sql`
      INSERT INTO workspace_invites (workspace_id, email, token_hash, role, expires_at)
      VALUES (${WS_ID}, 'e@test.com', 'hash_null_accepted', 'editor', ${expiresAt})
      RETURNING accepted_at
    `
    expect(row.accepted_at).toBeNull()
  })

  it('createdBy is nullable (system-generated invites)', async () => {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const [row] = await sql`
      INSERT INTO workspace_invites (workspace_id, email, token_hash, role, expires_at)
      VALUES (${WS_ID}, 'f@test.com', 'hash_null_creator', 'viewer', ${expiresAt})
      RETURNING created_by
    `
    expect(row.created_by).toBeNull()
  })

  it('failed_attempts defaults to 0, locked_until is nullable', async () => {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const [row] = await sql`
      INSERT INTO workspace_invites (workspace_id, email, token_hash, role, expires_at)
      VALUES (${WS_ID}, 'g@test.com', 'hash_rate_limit', 'editor', ${expiresAt})
      RETURNING failed_attempts, locked_until
    `
    expect(row.failed_attempts).toBe(0)
    expect(row.locked_until).toBeNull()
  })
})
