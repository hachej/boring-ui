import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const TEST_DB_URL = process.env.DATABASE_URL ?? 'postgres://ubuntu:test@localhost/boring_ui_test'
const migrationPath = fileURLToPath(new URL(
  '../../../../drizzle/0029_fenced_sandbox_handles.sql',
  import.meta.url,
))

let client: postgres.Sql

beforeAll(() => {
  client = postgres(TEST_DB_URL, { max: 1 })
})

afterAll(async () => {
  await client.end()
})

describe('0029 fenced sandbox handles migration', () => {
  it('uses exact table creation and supports a fresh upgrade followed by old-code operation', async () => {
    const migrationSql = readFileSync(migrationPath, 'utf8')
    expect(migrationSql).toContain('CREATE TABLE "fenced_sandbox_handles"')
    expect(migrationSql).toContain('CREATE TABLE "fenced_sandbox_handle_audit"')
    expect(migrationSql).not.toMatch(/CREATE TABLE IF NOT EXISTS/i)

    const schema = `fenced_migration_${randomUUID().replaceAll('-', '')}`
    await client.unsafe(`CREATE SCHEMA "${schema}"`)
    try {
      await client.unsafe(`SET search_path TO "${schema}"`)
      await client`CREATE TABLE old_app_state (id text PRIMARY KEY, value text NOT NULL)`
      await client.unsafe(migrationSql)
      await client`INSERT INTO old_app_state (id, value) VALUES ('old-code', 'still-writes')`
      expect(await client<{ value: string }[]>`SELECT value FROM old_app_state WHERE id = 'old-code'`).toEqual([
        { value: 'still-writes' },
      ])

      await expect(client.unsafe(migrationSql)).rejects.toMatchObject({ code: '42P07' })
    } finally {
      await client.unsafe('SET search_path TO public')
      await client.unsafe(`DROP SCHEMA "${schema}" CASCADE`)
    }
  })
})
