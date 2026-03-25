/**
 * Database client factory.
 *
 * Uses postgres.js (postgres) driver with drizzle-orm.
 * Connection is lazy — only established on first query.
 */
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import type { ServerConfig } from '../config.js'

export function createDbClient(config: ServerConfig) {
  if (!config.databaseUrl) {
    return null
  }

  const sql = postgres(config.databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  })

  const db = drizzle(sql)

  return { db, sql }
}
