import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator'
import postgres from 'postgres'

const TEST_DB_URL = process.env.DATABASE_URL ?? 'postgres://ubuntu:test@localhost/boring_ui_test'
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../../drizzle', import.meta.url))
const WORKSPACE_TYPE_MIGRATION_MILLIS = 1784419200000

let client: postgres.Sql
let workspaceTypeMigration: MigrationMeta

async function applyWorkspaceTypeMigration(sql: postgres.TransactionSql): Promise<void> {
  for (const statement of workspaceTypeMigration.sql) {
    if (statement.trim()) await sql.unsafe(statement)
  }
}

beforeAll(() => {
  client = postgres(TEST_DB_URL, { max: 1 })
  const migration = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER })
    .find(({ folderMillis }) => folderMillis === WORKSPACE_TYPE_MIGRATION_MILLIS)
  if (!migration) throw new Error('0023_workspace_type_id migration not found')
  workspaceTypeMigration = migration
})

afterAll(async () => {
  await client.end()
})

describe('0023 workspace type migration', () => {
  it('backfills every populated-table row to the reserved compatibility default', async () => {
    await client.begin(async (sql) => {
      await sql`CREATE TEMP TABLE workspaces (id integer PRIMARY KEY, name text NOT NULL) ON COMMIT DROP`
      await sql`INSERT INTO workspaces (id, name) VALUES (1, 'Existing A'), (2, 'Existing B')`

      await applyWorkspaceTypeMigration(sql)

      const rows = await sql`SELECT id, workspace_type_id FROM workspaces ORDER BY id`
      expect(rows).toEqual([
        { id: 1, workspace_type_id: 'default' },
        { id: 2, workspace_type_id: 'default' },
      ])
    })
  })

  it('works on an empty table and preserves the prior released app SQL shape', async () => {
    await client.begin(async (sql) => {
      await sql`CREATE TEMP TABLE workspaces (id integer PRIMARY KEY, name text NOT NULL) ON COMMIT DROP`

      await applyWorkspaceTypeMigration(sql)

      const [column] = await sql`
        SELECT attribute.attnotnull AS not_null,
               pg_get_expr(default_value.adbin, default_value.adrelid) AS default_expression
        FROM pg_attribute attribute
        JOIN pg_attrdef default_value
          ON default_value.adrelid = attribute.attrelid
         AND default_value.adnum = attribute.attnum
        WHERE attribute.attrelid = 'workspaces'::regclass
          AND attribute.attname = 'workspace_type_id'
      `
      expect(column).toMatchObject({
        not_null: true,
        default_expression: "'default'::text",
      })

      const [legacyProjection] = await sql`
        INSERT INTO workspaces (id, name)
        VALUES (1, 'Prior app insert')
        RETURNING id, name
      `
      expect(legacyProjection).toEqual({ id: 1, name: 'Prior app insert' })
      const [persisted] = await sql`SELECT workspace_type_id FROM workspaces WHERE id = 1`
      expect(persisted.workspace_type_id).toBe('default')
    })
  })

  it('installs the exact grammar constraint', async () => {
    await client.begin(async (sql) => {
      await sql`CREATE TEMP TABLE workspaces (id integer PRIMARY KEY, name text NOT NULL) ON COMMIT DROP`
      await applyWorkspaceTypeMigration(sql)

      const [constraint] = await sql`
        SELECT pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conrelid = 'workspaces'::regclass
          AND conname = 'workspaces_workspace_type_id_check'
      `
      expect(constraint.definition).toContain("workspace_type_id ~ '^[a-z][a-z0-9-]{0,62}$'::text")
    })
  })
})
