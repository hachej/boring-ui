import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { runMigrations } from '../../migrate'
import { PostgresUserStore } from '../PostgresUserStore'
import type { CoreConfig } from '../../../../shared/types'
import { describeUserStoreConformance } from '../../__tests__/storeConformance'

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

let sqlClient: postgres.Sql
let store: PostgresUserStore

beforeAll(async () => {
  await runMigrations(BASE_CONFIG)
  sqlClient = postgres(TEST_DB_URL, { max: 5 })
  const db = drizzle(sqlClient)
  store = new PostgresUserStore(db)
})

afterAll(async () => {
  await sqlClient.end()
})

beforeEach(async () => {
  // This suite shares a live Postgres with other files, so cleanup must stay
  // scoped to its own fixture users instead of truncating global auth tables.
  await sqlClient`
    DELETE FROM user_settings
    WHERE user_id IN (
      SELECT id FROM users WHERE email LIKE '%@pgtest.com'
    )
  `
  await sqlClient`
    DELETE FROM sessions
    WHERE user_id IN (
      SELECT id FROM users WHERE email LIKE '%@pgtest.com'
    )
  `
  await sqlClient`
    DELETE FROM accounts
    WHERE user_id IN (
      SELECT id FROM users WHERE email LIKE '%@pgtest.com'
    )
  `
  await sqlClient`DELETE FROM users WHERE email LIKE '%@pgtest.com'`
})

describe('PostgresUserStore', () => {
  describe('getById / getByEmail', () => {
    it('returns null for unknown id', async () => {
      expect(await store.getById('00000000-0000-0000-0000-000000000000')).toBeNull()
    })

    it('returns null for unknown email', async () => {
      expect(await store.getByEmail('nonexistent@pgtest.com')).toBeNull()
    })

    it('finds user after upsert', async () => {
      const user = await store.upsert('10000000-0000-0000-0000-000000000001', {
        email: 'alice@pgtest.com',
        name: 'Alice',
      })
      const byId = await store.getById(user.id)
      expect(byId?.email).toBe('alice@pgtest.com')
      const byEmail = await store.getByEmail('alice@pgtest.com')
      expect(byEmail?.id).toBe(user.id)
    })
  })

  describe('email normalization', () => {
    it('getByEmail is case-insensitive and trims whitespace', async () => {
      await store.upsert('10000000-0000-0000-0000-000000000002', {
        email: 'bob@pgtest.com',
        name: 'Bob',
      })
      const found = await store.getByEmail('  Bob@PGtest.COM  ')
      expect(found?.email).toBe('bob@pgtest.com')
    })

    it('upsert normalizes email before insert', async () => {
      const user = await store.upsert('10000000-0000-0000-0000-000000000003', {
        email: '  Carol@PGtest.COM  ',
        name: 'Carol',
      })
      expect(user.email).toBe('carol@pgtest.com')
    })
  })

  describe('upsert', () => {
    it('creates new user on first call', async () => {
      const user = await store.upsert('10000000-0000-0000-0000-000000000004', {
        email: 'dave@pgtest.com',
        name: 'Dave',
      })
      expect(user.id).toBe('10000000-0000-0000-0000-000000000004')
      expect(user.name).toBe('Dave')
      expect(user.emailVerified).toBe(false)
    })

    it('updates existing user on second call', async () => {
      await store.upsert('10000000-0000-0000-0000-000000000005', {
        email: 'eve@pgtest.com',
        name: 'Eve',
      })
      const updated = await store.upsert('10000000-0000-0000-0000-000000000005', {
        email: 'eve-new@pgtest.com',
        name: 'Eve Updated',
      })
      expect(updated.email).toBe('eve-new@pgtest.com')
      expect(updated.name).toBe('Eve Updated')
    })
  })

  describe('getUserSettings', () => {
    it('returns defaults from user record when no settings row exists', async () => {
      const user = await store.upsert('10000000-0000-0000-0000-000000000006', {
        email: 'frank@pgtest.com',
        name: 'Frank',
      })
      const settings = await store.getUserSettings(user.id, 'app1')
      expect(settings.displayName).toBe('Frank')
      expect(settings.email).toBe('frank@pgtest.com')
      expect(settings.settings).toEqual({})
    })

    it('queries by composite (userId, appId) — cross-app isolation', async () => {
      const user = await store.upsert('10000000-0000-0000-0000-000000000007', {
        email: 'grace@pgtest.com',
        name: 'Grace',
      })
      await store.putUserSettings(user.id, 'appX', {
        displayName: 'Grace-X',
        settings: { theme: 'dark' },
      })
      await store.putUserSettings(user.id, 'appY', {
        displayName: 'Grace-Y',
        settings: { theme: 'light' },
      })
      const settingsX = await store.getUserSettings(user.id, 'appX')
      expect(settingsX.displayName).toBe('Grace-X')
      expect(settingsX.settings).toEqual({ theme: 'dark' })
      const settingsY = await store.getUserSettings(user.id, 'appY')
      expect(settingsY.displayName).toBe('Grace-Y')
      expect(settingsY.settings).toEqual({ theme: 'light' })
    })
  })

  describe('putUserSettings', () => {
    it('inserts on first call (no existing row)', async () => {
      const user = await store.upsert('10000000-0000-0000-0000-000000000008', {
        email: 'hank@pgtest.com',
        name: 'Hank',
      })
      const result = await store.putUserSettings(user.id, 'app1', {
        displayName: 'Hank Display',
        email: 'hank-display@pgtest.com',
        settings: { lang: 'en' },
      })
      expect(result.displayName).toBe('Hank Display')
      expect(result.email).toBe('hank-display@pgtest.com')
      expect(result.settings).toEqual({ lang: 'en' })
    })

    it('first write preserves profile defaults when only settings are provided', async () => {
      const user = await store.upsert('10000000-0000-0000-0000-00000000000a', {
        email: 'kate@pgtest.com',
        name: 'Kate',
      })

      const result = await store.putUserSettings(user.id, 'app1', {
        settings: { density: 'compact' },
      })

      expect(result.displayName).toBe('Kate')
      expect(result.email).toBe('kate@pgtest.com')
      expect(result.settings).toEqual({ density: 'compact' })
    })

    it('updates on second call (row exists) — real upsert, not no-op', async () => {
      const user = await store.upsert('10000000-0000-0000-0000-000000000009', {
        email: 'iris@pgtest.com',
        name: 'Iris',
      })
      await store.putUserSettings(user.id, 'app1', {
        displayName: 'Iris V1',
        settings: { version: 1 },
      })
      const updated = await store.putUserSettings(user.id, 'app1', {
        displayName: 'Iris V2',
        settings: { version: 2 },
      })
      expect(updated.displayName).toBe('Iris V2')
      expect(updated.settings).toEqual({ version: 2 })
    })

    it('partial update preserves unmentioned fields', async () => {
      const user = await store.upsert('10000000-0000-0000-0000-000000000010', {
        email: 'jane@pgtest.com',
        name: 'Jane',
      })
      await store.putUserSettings(user.id, 'app1', {
        displayName: 'Jane',
        email: 'jane@pgtest.com',
        settings: { a: 1, b: 2 },
      })
      const updated = await store.putUserSettings(user.id, 'app1', {
        displayName: 'Jane Updated',
      })
      expect(updated.displayName).toBe('Jane Updated')
      expect(updated.email).toBe('jane@pgtest.com')
      expect(updated.settings).toEqual({ a: 1, b: 2 })
    })
  })
})

describeUserStoreConformance(async () => store, {
  emailDomain: 'pgtest.com',
})
