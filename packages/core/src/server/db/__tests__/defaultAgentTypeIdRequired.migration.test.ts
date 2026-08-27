import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator'
import postgres from 'postgres'

const TEST_DB_URL = process.env.DATABASE_URL ?? 'postgres://ubuntu:test@localhost/boring_ui_test'
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../../drizzle', import.meta.url))
const DEFAULT_AGENT_TYPE_MIGRATION_MILLIS = 1786147200000
const REQUIRED_DEFAULT_AGENT_TYPE_MIGRATION_MILLIS = 1787875200000

let client: postgres.Sql
let nullableMigration: MigrationMeta
let requiredMigration: MigrationMeta

async function applyMigration(sql: postgres.TransactionSql, migration: MigrationMeta): Promise<void> {
  for (const statement of migration.sql) {
    if (statement.trim()) await sql.unsafe(statement)
  }
}

beforeAll(() => {
  client = postgres(TEST_DB_URL, { max: 1 })
  const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER })
  const nullable = migrations.find(({ folderMillis }) => folderMillis === DEFAULT_AGENT_TYPE_MIGRATION_MILLIS)
  const required = migrations.find(({ folderMillis }) => folderMillis === REQUIRED_DEFAULT_AGENT_TYPE_MIGRATION_MILLIS)
  if (!nullable || !required) throw new Error('default Agent type migrations not found')
  nullableMigration = nullable
  requiredMigration = required
})

afterAll(async () => {
  await client.end()
})

describe('0025 required workspace default Agent type migration', () => {
  it('blocks a legacy NULL writer after the convergence barrier while existing NULL rows remain reconcilable', async () => {
    await client.begin(async (sql) => {
      await sql`CREATE TEMP TABLE workspaces (id integer PRIMARY KEY, name text NOT NULL)`
      await applyMigration(sql, nullableMigration)
      await sql`INSERT INTO workspaces (id, name, default_agent_type_id) VALUES (1, 'Legacy row', NULL)`
      await applyMigration(sql, requiredMigration)

      await sql`UPDATE workspaces SET default_agent_type_id = 'reviewer' WHERE default_agent_type_id IS NULL`
      const [{ count }] = await sql`SELECT count(*)::integer AS count FROM workspaces WHERE default_agent_type_id IS NULL`
      expect(count).toBe(0)
    })

    // This is the interleaving the one-shot application check could not
    // close: an old process writes after the new process observed zero.
    await expect(client`INSERT INTO workspaces (id, name, default_agent_type_id) VALUES (2, 'Overlapping legacy writer', NULL)`)
      .rejects.toMatchObject({ code: '23514' })
  })
})
