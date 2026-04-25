import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CoreConfig } from '../../shared/types.js'

const ADVISORY_LOCK_ID = 0x626f7265 // crc32-ish of 'boring-ui-v2-core-migrations'

export async function runMigrations(config: CoreConfig): Promise<void> {
  if (!config.databaseUrl) {
    throw new Error('databaseUrl is required to run migrations')
  }

  const migrationClient = postgres(config.databaseUrl, { max: 1 })
  const db = drizzle(migrationClient)

  try {
    await db.execute(sql.raw(`SELECT pg_advisory_lock(${ADVISORY_LOCK_ID})`))

    try {
      await db.execute(sql.raw('CREATE EXTENSION IF NOT EXISTS pgcrypto'))

      const migrationsFolder = resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../../../drizzle',
      )

      await migrate(db, { migrationsFolder })
    } finally {
      await db.execute(sql.raw(`SELECT pg_advisory_unlock(${ADVISORY_LOCK_ID})`))
    }
  } finally {
    await migrationClient.end()
  }
}
