import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import type { CoreConfig } from '../../../../shared/types'
import { withBeadId } from '../../../__tests__/_setup'
import { runMigrations } from '../../migrate'
import { PostgresWorkspaceStore } from '../PostgresWorkspaceStore'

const TEST_DB_URL = process.env.DATABASE_URL ?? 'postgres://ubuntu:test@localhost/boring_ui_test'
const APP_ID = 'iozo-crypto-app'
const BEAD_ID = 'boring-ui-v2-iozo'
const ENCRYPTION_KEY_A = 'a'.repeat(64)
const ENCRYPTION_KEY_B = 'b'.repeat(64)
const SECRET = 'sk_live_abcdef'

const BASE_CONFIG: CoreConfig = {
  appId: APP_ID,
  appName: 'IOZO Crypto Test',
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
  features: { githubOauth: false, invitesEnabled: true, sendWelcomeEmail: true, inviteTtlDays: 7 },
}

let sqlClient: postgres.Sql
let store: PostgresWorkspaceStore
let wrongKeyStore: PostgresWorkspaceStore

async function seedWorkspace() {
  const tag = randomUUID()
  const [owner] = await sqlClient`
    INSERT INTO users (name, email, email_verified)
    VALUES ('IOZO Owner', ${`owner-${tag}@iozo-crypto.test`}, true)
    RETURNING id
  `

  const [workspace] = await sqlClient`
    INSERT INTO workspaces (app_id, name, created_by, is_default)
    VALUES (${APP_ID}, 'IOZO Crypto Workspace', ${owner.id}, false)
    RETURNING id
  `

  return {
    ownerId: owner.id as string,
    workspaceId: workspace.id as string,
  }
}

async function readCiphertext(workspaceId: string, key: string): Promise<Uint8Array> {
  const [row] = await sqlClient<{ value: Uint8Array }[]>`
    SELECT value
    FROM workspace_settings
    WHERE workspace_id = ${workspaceId} AND key = ${key}
  `

  if (!row) {
    throw new Error(`Missing workspace_settings row for ${key}`)
  }

  return row.value
}

function toBuffer(value: Uint8Array): Buffer {
  return Buffer.from(value)
}

beforeAll(async () => {
  await runMigrations(BASE_CONFIG)
  sqlClient = postgres(TEST_DB_URL, { max: 2 })
  const db = drizzle(sqlClient)
  store = new PostgresWorkspaceStore(db, ENCRYPTION_KEY_A)
  wrongKeyStore = new PostgresWorkspaceStore(db, ENCRYPTION_KEY_B)
})

afterAll(async () => {
  await sqlClient.end()
})

beforeEach(async () => {
  await sqlClient`
    DELETE FROM workspace_settings
    WHERE workspace_id IN (SELECT id FROM workspaces WHERE app_id = ${APP_ID})
  `
  await sqlClient`
    DELETE FROM workspace_members
    WHERE workspace_id IN (SELECT id FROM workspaces WHERE app_id = ${APP_ID})
  `
  await sqlClient`
    DELETE FROM workspace_runtimes
    WHERE workspace_id IN (SELECT id FROM workspaces WHERE app_id = ${APP_ID})
  `
  await sqlClient`DELETE FROM workspaces WHERE app_id = ${APP_ID}`
  await sqlClient`DELETE FROM users WHERE email LIKE '%@iozo-crypto.test'`
})

describe('workspace settings crypto', () => {
  it(
    'round-trips encrypted settings through typed accessors',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const { workspaceId } = await seedWorkspace()

      const metadata = await store.putWorkspaceSettings(workspaceId, {
        foo: 'bar',
        api_key: SECRET,
      })

      expect(metadata).toEqual([
        expect.objectContaining({ key: 'api_key', configured: true }),
        expect.objectContaining({ key: 'foo', configured: true }),
      ])
      expect((metadata[0] as Record<string, unknown>).value).toBeUndefined()
      await expect(store.decryptSetting(workspaceId, 'foo')).resolves.toBe('bar')
      await expect(store.decryptSetting(workspaceId, 'api_key')).resolves.toBe(SECRET)
      assertionPassed('round-trip plaintext recovered only through decryptSetting')
    }),
  )

  it(
    'stores ciphertext bytes instead of plaintext',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const { workspaceId } = await seedWorkspace()
      await store.putWorkspaceSettings(workspaceId, { api_key: SECRET })

      const raw = toBuffer(await readCiphertext(workspaceId, 'api_key'))

      expect(raw.toString('utf8')).not.toContain(SECRET)
      expect(raw.equals(Buffer.from(SECRET, 'utf8'))).toBe(false)
      assertionPassed('raw bytea value does not contain plaintext')
    }),
  )

  it(
    'surfaces wrong-key decrypt failure without returning garbage',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const { workspaceId } = await seedWorkspace()
      await store.putWorkspaceSettings(workspaceId, { api_key: SECRET })

      await expect(sqlClient`
        SELECT pgp_sym_decrypt(value, ${ENCRYPTION_KEY_B})
        FROM workspace_settings
        WHERE workspace_id = ${workspaceId} AND key = 'api_key'
      `).rejects.toThrow()
      await expect(wrongKeyStore.decryptSetting(workspaceId, 'api_key')).resolves.toBeNull()
      await expect(wrongKeyStore.getWorkspaceSettings(workspaceId)).resolves.toEqual([
        expect.objectContaining({ key: 'api_key', configured: false }),
      ])
      assertionPassed('wrong key errors at pgcrypto and store returns null/configured=false')
    }),
  )

  it(
    'uses fresh ciphertext for repeated writes of the same plaintext',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const { workspaceId } = await seedWorkspace()

      await store.putWorkspaceSettings(workspaceId, { api_key: SECRET })
      const first = toBuffer(await readCiphertext(workspaceId, 'api_key'))

      await store.putWorkspaceSettings(workspaceId, { api_key: SECRET })
      const second = toBuffer(await readCiphertext(workspaceId, 'api_key'))

      expect(first.equals(second)).toBe(false)
      await expect(store.decryptSetting(workspaceId, 'api_key')).resolves.toBe(SECRET)
      assertionPassed('pgcrypto output changes on same plaintext rewrite')
    }),
  )
})
