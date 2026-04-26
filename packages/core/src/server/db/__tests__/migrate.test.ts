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

let adminSql: postgres.Sql

beforeAll(async () => {
  adminSql = postgres(TEST_DB_URL, { max: 1 })
  await adminSql`DROP EXTENSION IF EXISTS pgcrypto CASCADE`
})

afterAll(async () => {
  await adminSql.end()
})

describe('runMigrations', () => {
  it('throws when databaseUrl is null', async () => {
    const config = { ...BASE_CONFIG, databaseUrl: null }
    await expect(runMigrations(config)).rejects.toThrow('databaseUrl is required')
  })

  it('enables pgcrypto extension', async () => {
    await runMigrations(BASE_CONFIG)

    const result = await adminSql`
      SELECT extname FROM pg_extension WHERE extname = 'pgcrypto'
    `
    expect(result).toHaveLength(1)
    expect(result[0].extname).toBe('pgcrypto')
  })

  it('is idempotent — running twice does not throw', async () => {
    await runMigrations(BASE_CONFIG)
    await runMigrations(BASE_CONFIG)

    const result = await adminSql`
      SELECT extname FROM pg_extension WHERE extname = 'pgcrypto'
    `
    expect(result).toHaveLength(1)
  })

  it('acquires and releases advisory lock', async () => {
    await runMigrations(BASE_CONFIG)

    const locks = await adminSql`
      SELECT classid, objid FROM pg_locks WHERE locktype = 'advisory' AND objid = ${0x626f7265}
    `
    expect(locks).toHaveLength(0)
  })

  it('runs concurrent migrations without error', async () => {
    const results = await Promise.all([
      runMigrations(BASE_CONFIG),
      runMigrations(BASE_CONFIG),
    ])
    expect(results).toHaveLength(2)
  })
})
