import { describe, it, expect } from 'vitest'
import { createDatabase } from '../connection'
import type { CoreConfig } from '../../../shared/types'

const BASE_CONFIG: CoreConfig = {
  appId: 'test-app',
  appName: 'Test App',
  appLogo: null,
  port: 0,
  host: '127.0.0.1',
  staticDir: null,
  databaseUrl: null,
  stores: 'local',
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

describe('createDatabase', () => {
  it('throws when databaseUrl is null', () => {
    expect(() => createDatabase(BASE_CONFIG)).toThrow('databaseUrl is required')
  })

  it('returns db and sql when databaseUrl is provided', () => {
    const config = { ...BASE_CONFIG, databaseUrl: 'postgres://ubuntu:test@localhost/boring_ui_test' }
    const { db, sql } = createDatabase(config)
    expect(db).toBeDefined()
    expect(sql).toBeDefined()
    sql.end()
  })
})
