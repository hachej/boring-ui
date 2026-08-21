import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator'
import postgres from 'postgres'

const TEST_DB_URL = process.env.DATABASE_URL ?? 'postgres://ubuntu:test@localhost/boring_ui_test'
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../../drizzle', import.meta.url))
const DEFAULT_AGENT_TYPE_MIGRATION_MILLIS = 1786147200000

let client: postgres.Sql
let migration: MigrationMeta

async function applyMigration(sql: postgres.TransactionSql): Promise<void> {
  for (const statement of migration.sql) {
    if (statement.trim()) await sql.unsafe(statement)
  }
}

beforeAll(() => {
  client = postgres(TEST_DB_URL, { max: 1 })
  const found = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER })
    .find(({ folderMillis }) => folderMillis === DEFAULT_AGENT_TYPE_MIGRATION_MILLIS)
  if (!found) throw new Error('0024_workspace_default_agent_type_id migration not found')
  migration = found
})

afterAll(async () => {
  await client.end()
})

describe('0024 workspace default agent type migration', () => {
  it('adds a nullable column and leaves existing rows NULL (no implicit rewrite)', async () => {
    await client.begin(async (sql) => {
      await sql`CREATE TEMP TABLE workspaces (id integer PRIMARY KEY, name text NOT NULL) ON COMMIT DROP`
      await sql`INSERT INTO workspaces (id, name) VALUES (1, 'Existing A'), (2, 'Existing B')`

      await applyMigration(sql)

      const rows = await sql`SELECT id, default_agent_type_id FROM workspaces ORDER BY id`
      expect(rows).toEqual([
        { id: 1, default_agent_type_id: null },
        { id: 2, default_agent_type_id: null },
      ])

      const [column] = await sql`
        SELECT attnotnull AS not_null
        FROM pg_attribute
        WHERE attrelid = 'workspaces'::regclass
          AND attname = 'default_agent_type_id'
      `
      expect(column).toMatchObject({ not_null: false })
    })
  })

  it('installs the NULL-permitting grammar constraint', async () => {
    await client.begin(async (sql) => {
      await sql`CREATE TEMP TABLE workspaces (id integer PRIMARY KEY, name text NOT NULL) ON COMMIT DROP`
      await applyMigration(sql)

      const [constraint] = await sql`
        SELECT pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conrelid = 'workspaces'::regclass
          AND conname = 'workspaces_default_agent_type_id_check'
      `
      expect(constraint.definition).toContain("default_agent_type_id ~ '^[a-z][a-z0-9-]{0,62}$'::text")

      await sql`INSERT INTO workspaces (id, name, default_agent_type_id) VALUES (1, 'Seated', 'boring-v2'), (2, 'Unseated', NULL)`
    })
  })

  it('rejects non-slug seats via the check constraint', async () => {
    await expect(client.begin(async (sql) => {
      await sql`CREATE TEMP TABLE workspaces (id integer PRIMARY KEY, name text NOT NULL) ON COMMIT DROP`
      await applyMigration(sql)
      await sql`INSERT INTO workspaces (id, name, default_agent_type_id) VALUES (1, 'Bad seat', 'Not-A-Slug')`
    })).rejects.toMatchObject({ code: '23514' })
  })
})
