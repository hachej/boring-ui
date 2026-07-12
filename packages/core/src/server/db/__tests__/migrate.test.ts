import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { runMigrations } from '../migrate'
import type { CoreConfig } from '../../../shared/types'
import { resolveCoreTestDatabase, type CoreTestDatabase } from './testDatabase'

const TEST_DB: CoreTestDatabase | undefined = await resolveCoreTestDatabase('migrate')

function baseConfig(databaseUrl: string): CoreConfig {
  return {
    appId: 'test-app',
    appName: 'Test App',
    appLogo: null,
    port: 0,
    host: '127.0.0.1',
    staticDir: null,
    databaseUrl,
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
}

let adminSql: postgres.Sql
let config: CoreConfig

beforeAll(async () => {
  if (!TEST_DB) return
  config = baseConfig(TEST_DB.databaseUrl)
  adminSql = postgres(TEST_DB.databaseUrl, { max: 1 })
  await adminSql`DROP EXTENSION IF EXISTS pgcrypto CASCADE`
})

afterAll(async () => {
  await adminSql?.end()
  await TEST_DB?.cleanup()
})

describe.runIf(TEST_DB)('runMigrations', () => {
  it('throws when databaseUrl is null', async () => {
    await expect(runMigrations({ ...config, databaseUrl: null })).rejects.toThrow('databaseUrl is required')
  })

  it('enables pgcrypto extension', async () => {
    await runMigrations(config)

    const result = await adminSql`
      SELECT extname FROM pg_extension WHERE extname = 'pgcrypto'
    `
    expect(result).toHaveLength(1)
    expect(result[0].extname).toBe('pgcrypto')
  })

  it('is idempotent — running twice does not throw', async () => {
    await runMigrations(config)
    await runMigrations(config)

    const result = await adminSql`
      SELECT extname FROM pg_extension WHERE extname = 'pgcrypto'
    `
    expect(result).toHaveLength(1)
  })

  it('acquires and releases advisory lock', async () => {
    await runMigrations(config)

    const locks = await adminSql`
      SELECT classid, objid FROM pg_locks WHERE locktype = 'advisory' AND objid = ${0x626f7265}
    `
    expect(locks).toHaveLength(0)
  })

  it('runs concurrent migrations without error', async () => {
    const results = await Promise.all([
      runMigrations(config),
      runMigrations(config),
    ])
    expect(results).toHaveLength(2)
  })
})
