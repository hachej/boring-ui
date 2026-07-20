import { describe, expect, it, vi } from "vitest"
import { runBoringAutomationMigrations } from "../migrations"

describe("runBoringAutomationMigrations", () => {
  it("registers hosted automation tables and atomic lease indexes through deployment SQL", async () => {
    const unsafe = vi.fn(async () => [])
    await runBoringAutomationMigrations({ unsafe } as never)

    const statements = unsafe.mock.calls.map((call) => String((call as unknown[])[0]))
    expect(statements.some((statement) => statement.includes("CREATE TABLE IF NOT EXISTS boring_automation_automations"))).toBe(true)
    expect(statements.some((statement) => statement.includes("owner_user_id text NOT NULL"))).toBe(true)
    expect(statements.some((statement) => statement.includes("ADD COLUMN IF NOT EXISTS deleted_at timestamptz"))).toBe(true)
    expect(statements.some((statement) => statement.includes("boring_automation_automations_active_owner_idx") && statement.includes("WHERE deleted_at IS NULL"))).toBe(true)
    expect(statements.some((statement) => statement.includes("boring_automation_runs_active_once_idx"))).toBe(true)
    expect(statements.some((statement) => statement.includes("boring_automation_runs_scheduled_once_idx"))).toBe(true)
  })
})
