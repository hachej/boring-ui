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
  features: { githubOauth: false, invitesEnabled: true },
}

let sql: postgres.Sql
let userId: string

beforeAll(async () => {
  await runMigrations(BASE_CONFIG)
  sql = postgres(TEST_DB_URL, { max: 1 })
  const [user] = await sql`
    INSERT INTO users (name, email, email_verified)
    VALUES ('Test User', 'test-settings@example.com', true)
    RETURNING id
  `
  userId = user.id
})

afterAll(async () => {
  if (userId) await sql`DELETE FROM users WHERE id = ${userId}`
  await sql.end()
})

describe('user_settings schema', () => {
  it('composite PK allows same user with different appIds', async () => {
    await sql`
      INSERT INTO user_settings (user_id, app_id, display_name, email)
      VALUES (${userId}, 'app1', 'Name1', 'test@a.com')
    `
    await sql`
      INSERT INTO user_settings (user_id, app_id, display_name, email)
      VALUES (${userId}, 'app2', 'Name2', 'test@b.com')
    `
    const rows = await sql`
      SELECT app_id FROM user_settings WHERE user_id = ${userId} ORDER BY app_id
    `
    expect(rows).toHaveLength(2)
    expect(rows[0].app_id).toBe('app1')
    expect(rows[1].app_id).toBe('app2')

    await sql`DELETE FROM user_settings WHERE user_id = ${userId}`
  })

  it('composite PK rejects duplicate (userId, appId)', async () => {
    await sql`
      INSERT INTO user_settings (user_id, app_id, display_name, email)
      VALUES (${userId}, 'dup-app', 'First', 'a@b.com')
    `
    await expect(
      sql`INSERT INTO user_settings (user_id, app_id, display_name, email)
          VALUES (${userId}, 'dup-app', 'Second', 'c@d.com')`,
    ).rejects.toThrow(/duplicate key|unique/)

    await sql`DELETE FROM user_settings WHERE user_id = ${userId}`
  })

  it('CASCADE FK deletes user_settings when user is deleted', async () => {
    const [tempUser] = await sql`
      INSERT INTO users (name, email, email_verified)
      VALUES ('Cascade Test', 'cascade-test@example.com', true)
      RETURNING id
    `
    await sql`
      INSERT INTO user_settings (user_id, app_id, display_name, email)
      VALUES (${tempUser.id}, 'app1', 'CascadeName', 'c@e.com')
    `
    await sql`DELETE FROM users WHERE id = ${tempUser.id}`
    const rows = await sql`
      SELECT * FROM user_settings WHERE user_id = ${tempUser.id}
    `
    expect(rows).toHaveLength(0)
  })

  it('defaults are applied correctly', async () => {
    await sql`
      INSERT INTO user_settings (user_id, app_id) VALUES (${userId}, 'defaults-test')
    `
    const [row] = await sql`
      SELECT display_name, email, settings, updated_at
      FROM user_settings WHERE user_id = ${userId} AND app_id = 'defaults-test'
    `
    expect(row.display_name).toBe('')
    expect(row.email).toBe('')
    expect(row.settings).toEqual({})
    expect(row.updated_at).toBeDefined()

    await sql`DELETE FROM user_settings WHERE user_id = ${userId}`
  })
})
