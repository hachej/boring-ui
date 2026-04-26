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
  features: { githubOauth: false, invitesEnabled: true, sendWelcomeEmail: true },
}

let sql: postgres.Sql
let ownerId: string
let memberId: string
let workspaceId: string

beforeAll(async () => {
  await runMigrations(BASE_CONFIG)
  sql = postgres(TEST_DB_URL, { max: 1 })

  const [owner] = await sql`
    INSERT INTO users (name, email, email_verified)
    VALUES ('Members Owner', 'members-owner@example.com', true)
    RETURNING id
  `
  ownerId = owner.id

  const [member] = await sql`
    INSERT INTO users (name, email, email_verified)
    VALUES ('Members User', 'members-user@example.com', true)
    RETURNING id
  `
  memberId = member.id

  const [workspace] = await sql`
    INSERT INTO workspaces (app_id, name, created_by)
    VALUES ('members-app', 'Members Test Workspace', ${ownerId})
    RETURNING id
  `
  workspaceId = workspace.id
})

afterAll(async () => {
  if (!sql) return
  await sql`DELETE FROM workspace_members WHERE workspace_id = ${workspaceId}`
  await sql`DELETE FROM workspaces WHERE id = ${workspaceId}`
  await sql`DELETE FROM users WHERE id IN (${ownerId}, ${memberId})`
  await sql.end()
})

describe('workspace_members schema', () => {
  it('RESTRICT FK blocks deleting a user with active memberships', async () => {
    await sql`
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES (${workspaceId}, ${memberId}, 'editor')
    `

    await expect(
      sql`DELETE FROM users WHERE id = ${memberId}`,
    ).rejects.toThrow(/foreign key|violates/)

    await sql`DELETE FROM workspace_members WHERE workspace_id = ${workspaceId} AND user_id = ${memberId}`
  })

  it('role CHECK rejects invalid role values', async () => {
    await expect(
      sql`
        INSERT INTO workspace_members (workspace_id, user_id, role)
        VALUES (${workspaceId}, ${memberId}, 'admin')
      `,
    ).rejects.toThrow(/check|violates/)
  })
})
