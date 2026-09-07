import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migrationPath = fileURLToPath(new URL(
  '../../../../drizzle/0027_workspace_default_index_excludes_deleted.sql',
  import.meta.url,
))

describe('0027 workspace default index excludes deleted migration', () => {
  it('drops and rebuilds idx_workspaces_default_per_user_app scoped to live, default rows', () => {
    const sql = readFileSync(migrationPath, 'utf8')
    const drop = sql.indexOf('DROP INDEX "idx_workspaces_default_per_user_app"')
    const create = sql.indexOf('CREATE UNIQUE INDEX "idx_workspaces_default_per_user_app"')

    expect(drop).toBeGreaterThanOrEqual(0)
    expect(create).toBeGreaterThan(drop)
    expect(sql).toContain('"workspaces"."is_default" = true AND "workspaces"."deleted_at" IS NULL')
  })
})
