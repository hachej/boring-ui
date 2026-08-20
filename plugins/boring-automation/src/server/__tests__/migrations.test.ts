import { randomUUID } from "node:crypto"
import postgres from "postgres"
import { describe, expect, it, vi } from "vitest"
import { runBoringAutomationMigrations } from "../migrations"
import { PostgresAutomationStore, reconcileStaleHostedAutomationRuns } from "../postgresStore"

const TEST_DB_URL = process.env.DATABASE_URL ?? "postgres://ubuntu:test@localhost/boring_ui_test"

describe("runBoringAutomationMigrations", () => {
  it("registers hosted automation tables and atomic lease indexes through deployment SQL", async () => {
    const unsafe = vi.fn(async () => [])
    const transactionUnsafe = vi.fn(async () => [])
    const begin = vi.fn(async (run: (transaction: { unsafe: typeof transactionUnsafe }) => Promise<void>) => {
      await run({ unsafe: transactionUnsafe })
    })
    await runBoringAutomationMigrations({ unsafe, begin } as never)

    const statements = [...unsafe.mock.calls, ...transactionUnsafe.mock.calls].map((call) => String((call as unknown[])[0]))
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
    expect(statements.some((statement) => statement.includes("HAVING COUNT(*) > 1") && statement.includes("outcome-unknown"))).toBe(true)
    expect(statements.some((statement) => statement.includes("boring_automation_runs_active_once_idx") && statement.includes("outcome-unknown"))).toBe(true)
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
      const replacements = await Promise.allSettled([
        store.beginRun({ automationId, trigger: "manual", promptSnapshot: "replacement-1", modelSnapshot: "test:model" }),
        store.beginRun({ automationId, trigger: "manual", promptSnapshot: "replacement-2", modelSnapshot: "test:model" }),
      ])
      expect(replacements).toHaveLength(2)
      for (const replacement of replacements) {
        expect(replacement.status).toBe("rejected")
        if (replacement.status === "rejected") expect(replacement.reason).toMatchObject({ code: "BORING_AUTOMATION_RUN_ALREADY_ACTIVE" })
      }
    } finally {
      await sql`DELETE FROM boring_automation_automations WHERE id = ${automationId}`.catch(() => undefined)
      await sql.end()
    }
  })
  it("rolls back the old occupancy index when legacy ambiguous duplicates block migration", async () => {
    const sql = postgres(TEST_DB_URL, { max: 1 })
    const automationId = randomUUID()
    const actor = { workspaceId: `migration-rollback-workspace-${randomUUID()}`, userId: `migration-rollback-user-${randomUUID()}` }
    try {
      await runBoringAutomationMigrations(sql)
      const now = new Date().toISOString()
      await sql`
        INSERT INTO boring_automation_automations (
          id, workspace_id, owner_user_id, title, enabled, cron, timezone, model, prompt_ref, created_at, updated_at
        ) VALUES (
          ${automationId}, ${actor.workspaceId}, ${actor.userId}, 'Rollback smoke', true,
          NULL, 'UTC', 'test:model', ${`.agents/automation/${automationId}.md`}, ${now}, ${now}
        )
      `
      await sql.unsafe(`DROP INDEX boring_automation_runs_active_once_idx`)
      await sql.unsafe(`
        CREATE UNIQUE INDEX boring_automation_runs_active_once_idx
          ON boring_automation_runs (automation_id)
          WHERE status IN ('queued', 'dispatching', 'running')
      `)
      const store = new PostgresAutomationStore(sql, actor)
      const ambiguous = await store.beginRun({ automationId, trigger: "manual", promptSnapshot: "one", modelSnapshot: "test:model" })
      await store.updateRunLifecycle(ambiguous.id, { status: "outcome-unknown", sessionId: "possibly-live" })
      await sql`
        INSERT INTO boring_automation_runs (
          id, automation_id, workspace_id, owner_user_id, invocation_id, dispatch_request_id, dispatch_receipt,
          session_id, status, trigger, scheduled_for, started_at, completed_at, duration_ms, input_tokens,
          output_tokens, total_tokens, prompt_snapshot, model_snapshot, error, created_at, updated_at
        ) SELECT
          ${randomUUID()}, automation_id, workspace_id, owner_user_id, ${`replacement:${randomUUID()}`}, ${randomUUID()}, NULL,
          NULL, 'queued', 'dispatch', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'two', model_snapshot, NULL, ${now}, ${now}
        FROM boring_automation_runs WHERE id = ${ambiguous.id}
      `

      await expect(runBoringAutomationMigrations(sql)).rejects.toThrow("multiple potentially live runs")
      const indexes = await sql<{ indexdef: string }[]>`
        SELECT indexdef FROM pg_indexes
        WHERE schemaname = current_schema() AND indexname = 'boring_automation_runs_active_once_idx'
      `
      expect(indexes).toHaveLength(1)
      expect(indexes[0]!.indexdef).toContain("'queued'::text")
      expect(indexes[0]!.indexdef).not.toContain("outcome-unknown")
    } finally {
      await sql`DELETE FROM boring_automation_automations WHERE id = ${automationId}`.catch(() => undefined)
      await runBoringAutomationMigrations(sql).catch(() => undefined)
      await sql.end()
    }
  })
})


describe("Postgres standing automation seeding", () => {
  it("is concurrent-idempotent, prompt-linked, and reactivates its deterministic tombstone", async () => {
    const sql = postgres(TEST_DB_URL, { max: 4 })
    const actor = { workspaceId: `seed-workspace-${randomUUID()}`, userId: `seed-user-${randomUUID()}` }
    const workspace = {
      root: "/workspace",
      runtimeContext: {},
      async readFile(path: string) {
        if (path === ".agents/automation/worker-slot.md") return "worker prompt"
        throw Object.assign(new Error("missing"), { code: "ENOENT" })
      },
    } as never
    const seed = {
      key: "worker-slot-1", title: "worker-slot-1", enabled: true, cron: null, timezone: "UTC",
      model: "openai-codex:gpt-5.6-sol", agentTypeId: "boring-worker",
      promptRef: ".agents/automation/worker-slot.md",
    }
    try {
      await runBoringAutomationMigrations(sql)
      const store = new PostgresAutomationStore(sql, actor, undefined, workspace)
      const [first, second] = await Promise.all([store.ensureSeededAutomation(seed), store.ensureSeededAutomation(seed)])
      expect(first).toMatchObject({ id: second?.id, cron: null, promptRef: seed.promptRef })
      await expect(store.getPrompt(first!.id)).resolves.toBe("worker prompt")
      await expect(store.listAutomations()).resolves.toHaveLength(1)

      await store.deleteAutomation(first!.id)
      await expect(store.listAutomations()).resolves.toEqual([])
      await expect(store.ensureSeededAutomation(seed)).resolves.toMatchObject({ id: first!.id, promptRef: seed.promptRef })
      await expect(store.listAutomations()).resolves.toHaveLength(1)
    } finally {
      await sql`DELETE FROM boring_automation_automations WHERE workspace_id = ${actor.workspaceId} AND owner_user_id = ${actor.userId}`.catch(() => undefined)
      await sql.end()
    }
  })
})
