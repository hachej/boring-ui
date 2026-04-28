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
  features: { githubOauth: false, invitesEnabled: true, sendWelcomeEmail: true },
}

const OWNER_ID = '22000000-0000-0000-0000-000000000001'
const WORKSPACE_ID = '32000000-0000-0000-0000-000000000001'

let sql: postgres.Sql

beforeAll(async () => {
  await runMigrations(BASE_CONFIG)
  sql = postgres(TEST_DB_URL, { max: 1 })

  await sql`
    INSERT INTO users (id, name, email, email_verified, created_at, updated_at)
    VALUES (${OWNER_ID}, 'Runtime Owner', 'runtime-owner@example.com', true, now(), now())
    ON CONFLICT (id) DO NOTHING
  `

  await sql`
    INSERT INTO workspaces (id, app_id, name, created_by, is_default)
    VALUES (${WORKSPACE_ID}, 'runtime-app', 'Runtime Workspace', ${OWNER_ID}, false)
    ON CONFLICT (id) DO NOTHING
  `
})

afterAll(async () => {
  if (!sql) return
  await sql`DELETE FROM workspace_runtimes WHERE workspace_id = ${WORKSPACE_ID}`
  await sql`DELETE FROM workspaces WHERE id = ${WORKSPACE_ID}`
  await sql`DELETE FROM users WHERE id = ${OWNER_ID}`
  await sql.end()
})

beforeEach(async () => {
  await sql`DELETE FROM workspace_runtimes WHERE workspace_id = ${WORKSPACE_ID}`
})

describe('workspace_runtimes schema', () => {
  it('defaults state to pending and keeps nullable metadata columns null', async () => {
    const [row] = await sql`
      INSERT INTO workspace_runtimes (workspace_id)
      VALUES (${WORKSPACE_ID})
      RETURNING state, sprite_url, sprite_name, last_error, volume_path, last_error_op, provisioning_step, step_started_at, updated_at
    `

    expect(row.state).toBe('pending')
    expect(row.sprite_url).toBeNull()
    expect(row.sprite_name).toBeNull()
    expect(row.last_error).toBeNull()
    expect(row.volume_path).toBeNull()
    expect(row.last_error_op).toBeNull()
    expect(row.provisioning_step).toBeNull()
    expect(row.step_started_at).toBeNull()
    expect(row.updated_at).toBeTruthy()
  })

  it('stores full runtime metadata with v7 columns and enforces allowed state values', async () => {
    const [row] = await sql`
      INSERT INTO workspace_runtimes (
        workspace_id, sprite_url, sprite_name, state, last_error,
        volume_path, last_error_op
      )
      VALUES (
        ${WORKSPACE_ID},
        'https://cdn.example.com/sprite.png',
        'runtime-sprite',
        'error',
        'boot timeout',
        '/data/ws-123',
        'provision'
      )
      RETURNING state, sprite_name, volume_path, last_error_op
    `

    expect(row.state).toBe('error')
    expect(row.sprite_name).toBe('runtime-sprite')
    expect(row.volume_path).toBe('/data/ws-123')
    expect(row.last_error_op).toBe('provision')

    await sql`DELETE FROM workspace_runtimes WHERE workspace_id = ${WORKSPACE_ID}`

    await expect(
      sql`
        INSERT INTO workspace_runtimes (workspace_id, state)
        VALUES (${WORKSPACE_ID}, 'provisioning')
      `,
    ).rejects.toThrow(/check|violates/)

    await expect(
      sql`
        INSERT INTO workspace_runtimes (workspace_id, state)
        VALUES (${WORKSPACE_ID}, 'done')
      `,
    ).rejects.toThrow(/check|violates/)
  })

  it('enforces one runtime row per workspace via primary key', async () => {
    await sql`
      INSERT INTO workspace_runtimes (workspace_id, state)
      VALUES (${WORKSPACE_ID}, 'pending')
    `

    await expect(
      sql`
        INSERT INTO workspace_runtimes (workspace_id, state)
        VALUES (${WORKSPACE_ID}, 'ready')
      `,
    ).rejects.toThrow(/duplicate key|unique|primary key/)
  })

  it('enforces workspace FK for runtime rows', async () => {
    const missingWorkspaceId = '32000000-0000-0000-0000-000000000099'

    await expect(
      sql`
        INSERT INTO workspace_runtimes (workspace_id, state)
        VALUES (${missingWorkspaceId}, 'pending')
      `,
    ).rejects.toThrow(/foreign key|violates/)
  })
})
