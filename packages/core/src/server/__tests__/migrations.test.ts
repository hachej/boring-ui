import { beforeEach, describe, expect, it, vi } from 'vitest'

const { resolveDatabaseUrl, runMigrations } = vi.hoisted(() => ({
  resolveDatabaseUrl: vi.fn(() => 'postgres://test'),
  runMigrations: vi.fn(async () => undefined),
}))

vi.mock('../config/index.js', () => ({ resolveDatabaseUrl }))
vi.mock('../db/index.js', () => ({ runMigrations }))

import { runCoreMigrationsFromEnv } from '../migrations.js'

describe('runCoreMigrationsFromEnv', () => {
  beforeEach(() => vi.clearAllMocks())

  it('loads only the database URL required for schema deployment', async () => {
    const env = { DATABASE_URL: 'postgres://test', NODE_ENV: 'production' }

    await runCoreMigrationsFromEnv({ loadConfigOptions: { env } })

    expect(resolveDatabaseUrl).toHaveBeenCalledWith({ env })
    expect(runMigrations).toHaveBeenCalledWith({ databaseUrl: 'postgres://test' }, expect.any(Object))
  })
})
