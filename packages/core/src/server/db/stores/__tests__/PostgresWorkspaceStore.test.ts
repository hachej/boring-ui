import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'

import { runMigrations } from '../../migrate'
import { PostgresWorkspaceStore } from '../PostgresWorkspaceStore'
import type { CoreConfig } from '../../../../shared/types'

const TEST_DB_URL = 'postgres://ubuntu:test@localhost/boring_ui_test'
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
  features: { githubOauth: false, invitesEnabled: true },
}

let sqlClient: postgres.Sql
let store: PostgresWorkspaceStore
let wrongKeyStore: PostgresWorkspaceStore

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

beforeAll(async () => {
  await runMigrations(BASE_CONFIG)
  sqlClient = postgres(TEST_DB_URL, { max: 4 })
  const db = drizzle(sqlClient)
  store = new PostgresWorkspaceStore(db, ENCRYPTION_KEY_A)
  wrongKeyStore = new PostgresWorkspaceStore(db, ENCRYPTION_KEY_B)
})

afterAll(async () => {
  await sqlClient.end()
})

beforeEach(async () => {
  await sqlClient`
    DELETE FROM workspace_invites
    WHERE workspace_id IN (
      SELECT id FROM workspaces WHERE app_id IN ('orm1-app', 'ui-app')
    )
  `
  await sqlClient`
    DELETE FROM workspace_members
    WHERE workspace_id IN (
      SELECT id FROM workspaces WHERE app_id IN ('orm1-app', 'ui-app')
    )
  `
  await sqlClient`
    DELETE FROM workspace_runtimes
    WHERE workspace_id IN (
      SELECT id FROM workspaces WHERE app_id IN ('orm1-app', 'ui-app')
    )
  `
  await sqlClient`
    DELETE FROM workspace_settings
    WHERE workspace_id IN (
      SELECT id FROM workspaces WHERE app_id IN ('orm1-app', 'ui-app')
    )
  `
  await sqlClient`DELETE FROM user_settings WHERE app_id IN ('orm1-app', 'ui-app')`
  await sqlClient`DELETE FROM workspaces WHERE app_id IN ('orm1-app', 'ui-app')`
  await sqlClient`DELETE FROM users WHERE email LIKE '%@orm1-test.dev'`
})

describe('PostgresWorkspaceStore Sub-PR3', () => {
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

    it('putWorkspaceRuntime updates runtime fields', async () => {
      const { workspaceId } = await seedWorkspace()
      const stepStartedAt = new Date().toISOString()

      const updated = await store.putWorkspaceRuntime(workspaceId, {
        state: 'provisioning',
        spriteUrl: 'https://cdn.example.com/sprite.png',
        spriteName: 'my-sprite',
        provisioningStep: 'creating_machine',
        stepStartedAt,
      })

      expect(updated.state).toBe('provisioning')
      expect(updated.spriteUrl).toBe('https://cdn.example.com/sprite.png')
      expect(updated.spriteName).toBe('my-sprite')
      expect(updated.provisioningStep).toBe('creating_machine')
      expect(updated.stepStartedAt).not.toBeNull()

      const persisted = await store.getWorkspaceRuntime(workspaceId)
      expect(persisted?.state).toBe('provisioning')
      expect(persisted?.provisioningStep).toBe('creating_machine')
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
  })
})
