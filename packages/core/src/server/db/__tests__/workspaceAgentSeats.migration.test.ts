import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migrationPath = fileURLToPath(new URL(
  '../../../../drizzle/0026_workspace_agent_seats.sql',
  import.meta.url,
))

describe('0026 workspace Agent Seats migration', () => {
  it('relaxes the old-writer default constraint before additive Seat DDL and backfill', () => {
    const sql = readFileSync(migrationPath, 'utf8')
    const relax = sql.indexOf('DROP CONSTRAINT IF EXISTS "workspaces_default_agent_type_id_required_check"')
    const createSeats = sql.indexOf('CREATE TABLE "workspace_agent_seats"')
    const backfill = sql.indexOf('INSERT INTO "workspace_agent_seats"')

    expect(relax).toBeGreaterThanOrEqual(0)
    expect(createSeats).toBeGreaterThan(relax)
    expect(backfill).toBeGreaterThan(createSeats)
    expect(sql).toContain('WHERE "default_agent_type_id" IS NOT NULL')
    expect(sql).toContain("'migration-default'")
    expect(sql).not.toMatch(/VALIDATE CONSTRAINT|SET NOT NULL/)
  })
})
