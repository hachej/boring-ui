import { describe, it, expect, beforeAll, afterAll } from 'vitest'
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

const ENCRYPTION_KEY_A = 'a'.repeat(64)
const ENCRYPTION_KEY_B = 'b'.repeat(64)

let sql: postgres.Sql
let ownerId: string
let workspaceId: string

beforeAll(async () => {
  await runMigrations(BASE_CONFIG)
  sql = postgres(TEST_DB_URL, { max: 1 })

  const [owner] = await sql`
    INSERT INTO users (name, email, email_verified)
    VALUES ('Settings Owner', 'settings-owner@example.com', true)
    RETURNING id
  `
  ownerId = owner.id

  const [workspace] = await sql`
    INSERT INTO workspaces (app_id, name, created_by)
    VALUES ('settings-app', 'Settings Workspace', ${ownerId})
    RETURNING id
  `
  workspaceId = workspace.id
})

afterAll(async () => {
  if (!sql) return
  await sql`DELETE FROM workspace_settings WHERE workspace_id = ${workspaceId}`
  await sql`DELETE FROM workspaces WHERE id = ${workspaceId}`
  await sql`DELETE FROM users WHERE id = ${ownerId}`
  await sql.end()
})

async function getWorkspaceSettingsWithDecryptGuard(
  workspaceIdValue: string,
  key: string,
): Promise<Array<{ key: string; configured: boolean; updated_at: string }>> {
  const rows = await sql<{ key: string; updated_at: string }[]>`
    SELECT key, updated_at
    FROM workspace_settings
    WHERE workspace_id = ${workspaceIdValue}
    ORDER BY key
  `

  const output: Array<{ key: string; configured: boolean; updated_at: string }> = []
  for (const row of rows) {
    try {
      await sql`
        SELECT pgp_sym_decrypt(value, ${key})
        FROM workspace_settings
        WHERE workspace_id = ${workspaceIdValue} AND key = ${row.key}
      `
      output.push({ key: row.key, configured: true, updated_at: row.updated_at })
    } catch {
      output.push({ key: row.key, configured: false, updated_at: row.updated_at })
    }
  }

  return output
}

describe('workspace_settings schema', () => {
  it('round-trips encrypted bytea values via pgcrypto', async () => {
    const plaintext = JSON.stringify({ installationId: 12345, state: 'ok' })
    await sql`
      INSERT INTO workspace_settings (workspace_id, key, value)
      VALUES (
        ${workspaceId},
        'github.installation',
        pgp_sym_encrypt(${plaintext}, ${ENCRYPTION_KEY_A})
      )
    `

    const [row] = await sql<{ plaintext: string }[]>`
      SELECT pgp_sym_decrypt(value, ${ENCRYPTION_KEY_A}) AS plaintext
      FROM workspace_settings
      WHERE workspace_id = ${workspaceId} AND key = 'github.installation'
    `

    expect(row.plaintext).toBe(plaintext)
  })

  it('survives key-rotation mismatch by marking configured=false', async () => {
    await sql`
      INSERT INTO workspace_settings (workspace_id, key, value)
      VALUES (
        ${workspaceId},
        'github.refreshToken',
        pgp_sym_encrypt('refresh-token', ${ENCRYPTION_KEY_A})
      )
      ON CONFLICT (workspace_id, key) DO UPDATE
      SET value = EXCLUDED.value, updated_at = NOW()
    `

    await expect(
      getWorkspaceSettingsWithDecryptGuard(workspaceId, ENCRYPTION_KEY_B),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'github.refreshToken', configured: false }),
      ]),
    )
  })

  it('enforces composite PK on (workspace_id, key)', async () => {
    await sql`
      INSERT INTO workspace_settings (workspace_id, key, value)
      VALUES (
        ${workspaceId},
        'dup-key',
        pgp_sym_encrypt('first', ${ENCRYPTION_KEY_A})
      )
    `

    await expect(
      sql`
        INSERT INTO workspace_settings (workspace_id, key, value)
        VALUES (
          ${workspaceId},
          'dup-key',
          pgp_sym_encrypt('second', ${ENCRYPTION_KEY_A})
        )
      `,
    ).rejects.toThrow(/duplicate key|unique/)
  })
})
