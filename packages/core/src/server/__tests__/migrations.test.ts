import { beforeEach, describe, expect, it, vi } from 'vitest'

const { runMigrations } = vi.hoisted(() => ({
  runMigrations: vi.fn(async () => undefined),
}))

vi.mock('../db/index.js', () => ({ runMigrations }))

import { runCoreMigrationsFromEnv } from '../migrations.js'

describe('runCoreMigrationsFromEnv', () => {
  beforeEach(() => vi.clearAllMocks())

  it('loads only the database URL required for schema deployment', async () => {
    const env = {
      DATABASE_URL: 'postgres://test',
      NODE_ENV: 'production',
      BETTER_AUTH_SECRET_FILE: '/missing/unrelated-secret',
    }

    await runCoreMigrationsFromEnv({ loadConfigOptions: { env } })

    expect(runMigrations).toHaveBeenCalledWith({ databaseUrl: 'postgres://test' }, expect.any(Object))
  })

  it('rejects conflicting inline and file database secrets', async () => {
    await expect(runCoreMigrationsFromEnv({
      loadConfigOptions: {
        env: {
          DATABASE_URL: 'postgres://test',
          DATABASE_URL_FILE: '/tmp/database-url',
        },
      },
    })).rejects.toMatchObject({
      issues: [expect.objectContaining({ path: ['env', 'DATABASE_URL_FILE'] })],
    })
    expect(runMigrations).not.toHaveBeenCalled()
  })
})
