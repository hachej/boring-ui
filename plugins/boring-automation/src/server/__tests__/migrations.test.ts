import { randomUUID } from "node:crypto"
import postgres from "postgres"
import { describe, expect, it, vi } from "vitest"
import { runBoringAutomationMigrations } from "../migrations"
import { PostgresAutomationStore, reconcileStaleHostedAutomationRuns } from "../postgresStore"

const TEST_DB_URL = process.env.DATABASE_URL ?? "postgres://ubuntu:test@localhost/boring_ui_test"

describe("runBoringAutomationMigrations", () => {
  it("registers hosted automation tables and atomic lease indexes through deployment SQL", async () => {
    const unsafe = vi.fn(async () => [])
    await runBoringAutomationMigrations({ unsafe } as never)

    const statements = unsafe.mock.calls.map((call) => String((call as unknown[])[0]))
    expect(statements.some((statement) => statement.includes("CREATE TABLE IF NOT EXISTS boring_automation_automations"))).toBe(true)
    expect(statements.some((statement) => statement.includes("owner_user_id text NOT NULL"))).toBe(true)
    expect(statements.some((statement) => statement.includes("prompt text"))).toBe(false)
    expect(statements.some((statement) => statement.includes("ADD COLUMN IF NOT EXISTS agent_type_id text"))).toBe(true)
    expect(statements.some((statement) => statement.includes("ADD COLUMN IF NOT EXISTS deleted_at timestamptz"))).toBe(true)
    expect(statements.some((statement) => statement.includes("DROP COLUMN IF EXISTS prompt"))).toBe(true)
    expect(statements.some((statement) => statement.includes("DROP COLUMN IF EXISTS prompt_file_ready"))).toBe(true)
    expect(statements.some((statement) => statement.includes("boring_automation_automations_active_owner_idx") && statement.includes("WHERE deleted_at IS NULL"))).toBe(true)
    expect(statements.some((statement) => statement.includes("ADD COLUMN IF NOT EXISTS invocation_id text"))).toBe(true)
    expect(statements.some((statement) => statement.includes("ALTER COLUMN invocation_id SET NOT NULL"))).toBe(true)
    expect(statements.some((statement) => statement.includes("status IN ('queued', 'dispatching', 'running'"))).toBe(true)
    expect(statements.some((statement) => statement.includes("boring_automation_runs_active_once_idx"))).toBe(true)
    expect(statements.some((statement) => statement.includes("boring_automation_runs_invocation_once_idx"))).toBe(true)
    expect(statements.some((statement) => statement.includes("boring_automation_runs_scheduled_once_idx"))).toBe(true)
  })

  it("migrates the hosted schema through a dispatched run", async () => {
    const sql = postgres(TEST_DB_URL, { max: 1 })
    const automationId = randomUUID()
    const actor = {
      workspaceId: `migration-smoke-workspace-${randomUUID()}`,
      userId: `migration-smoke-user-${randomUUID()}`,
    }
    try {
      await runBoringAutomationMigrations(sql)
      const now = new Date().toISOString()
      await sql`
        INSERT INTO boring_automation_automations (
          id, workspace_id, owner_user_id, title, enabled, cron, timezone, model, prompt_ref, created_at, updated_at
        ) VALUES (
          ${automationId}, ${actor.workspaceId}, ${actor.userId}, 'Migration smoke', true,
          '0 9 * * *', 'UTC', 'test:model', ${`.agents/automation/${automationId}.md`}, ${now}, ${now}
        )
      `
      const store = new PostgresAutomationStore(sql, actor)
      const run = await store.beginRun({
        automationId,
        invocationId: `manual:${randomUUID()}`,
        trigger: "manual",
        promptSnapshot: "smoke",
        modelSnapshot: "test:model",
      })

      expect(run).toMatchObject({ status: "queued", dispatchRequestId: run.id })
      await expect(store.claimRunForDispatch(run.id)).resolves.toMatchObject({
        id: run.id,
        status: "dispatching",
      })

      const sessionId = randomUUID()
      const dispatchReceipt = {
        ref: { agentTypeId: "default", sessionId },
        accepted: true as const,
        cursor: 1,
        clientNonce: run.id,
        disposition: "prompt" as const,
      }
      await expect(store.updateRunLifecycle(run.id, {
        status: "running",
        sessionId,
        dispatchReceipt,
      })).resolves.toMatchObject({
        id: run.id,
        status: "running",
        sessionId,
        dispatchReceipt,
      })

      await sql`UPDATE boring_automation_runs SET updated_at = '2026-07-10T00:00:00.000Z' WHERE id = ${run.id}`
      const reconciled = await reconcileStaleHostedAutomationRuns(sql, 60_000)
      expect(reconciled).toEqual(expect.arrayContaining([
        expect.objectContaining({
          actor,
          run: expect.objectContaining({ id: run.id, status: "outcome-unknown", completedAt: expect.any(String) }),
        }),
      ]))
      await expect(store.updateRunLifecycle(run.id, { status: "succeeded" })).rejects.toMatchObject({
        code: "BORING_AUTOMATION_RUN_LEASE_LOST",
      })
    } finally {
      await sql`DELETE FROM boring_automation_automations WHERE id = ${automationId}`.catch(() => undefined)
      await sql.end()
    }
  })
})
