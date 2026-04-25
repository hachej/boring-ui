import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import type { CoreConfig } from '../../shared/types.js'

export type Database = ReturnType<typeof drizzle>

export function createDatabase(config: CoreConfig): { db: Database; sql: postgres.Sql } {
  if (!config.databaseUrl) {
    throw new Error('databaseUrl is required to create a database connection')
  }

  const sql = postgres(config.databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  })

  const db = drizzle(sql)
  return { db, sql }
}
