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
    expect(statements.some((statement) => statement.includes("ADD COLUMN IF NOT EXISTS run_duration_cap_ms integer"))).toBe(true)
    expect(statements.some((statement) => statement.includes("run_duration_cap_ms BETWEEN 1 AND 2147483647"))).toBe(true)
    expect(statements.some((statement) => statement.includes("ADD COLUMN IF NOT EXISTS deleted_at timestamptz"))).toBe(true)
    expect(statements.some((statement) => statement.includes("DROP COLUMN IF EXISTS prompt"))).toBe(true)
    expect(statements.some((statement) => statement.includes("DROP COLUMN IF EXISTS prompt_file_ready"))).toBe(true)
    expect(statements.some((statement) => statement.includes("boring_automation_automations_active_owner_idx") && statement.includes("WHERE deleted_at IS NULL"))).toBe(true)
    expect(statements.some((statement) => statement.includes("ADD COLUMN IF NOT EXISTS invocation_id text"))).toBe(true)
    expect(statements.some((statement) => statement.includes("ALTER COLUMN invocation_id SET NOT NULL"))).toBe(true)
    expect(statements.some((statement) => statement.includes("status IN ('queued', 'dispatching', 'running'"))).toBe(true)
    expect(statements.some((statement) => statement.includes("ROW_NUMBER() OVER") && statement.includes("outcome-unknown"))).toBe(true)
    expect(statements.some((statement) => statement.includes("occupancy_rank > 1") && statement.includes("retained the automation slot"))).toBe(true)
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
      await sql`UPDATE boring_automation_runs SET updated_at = '2026-07-10T00:00:00.000Z' WHERE id = ${run.id}`
      const released = await reconcileStaleHostedAutomationRuns(sql, 60_000)
      expect(released).toEqual([])

      const replacements = await Promise.allSettled([
        store.beginRun({ automationId, trigger: "manual", promptSnapshot: "replacement-1", modelSnapshot: "test:model" }),
        store.beginRun({ automationId, trigger: "manual", promptSnapshot: "replacement-2", modelSnapshot: "test:model" }),
      ])
      expect(replacements.every((replacement) => replacement.status === "rejected")).toBe(true)
      for (const replacement of replacements) {
        if (replacement.status === "rejected") expect(replacement.reason).toMatchObject({ code: "BORING_AUTOMATION_RUN_ALREADY_ACTIVE" })
      }
    } finally {
      await sql`DELETE FROM boring_automation_automations WHERE id = ${automationId}`.catch(() => undefined)
      await sql.end()
    }
  })
  it("repairs duplicate potentially-live runs before enforcing the occupancy index", async () => {
    const sql = postgres(TEST_DB_URL, { max: 1 })
    const automationId = randomUUID()
    const olderRunId = randomUUID()
    const newerRunId = randomUUID()
    const actor = { workspaceId: `migration-repair-workspace-${randomUUID()}`, userId: `migration-repair-user-${randomUUID()}` }
    try {
      await runBoringAutomationMigrations(sql)
      await sql`
        INSERT INTO boring_automation_automations (
          id, workspace_id, owner_user_id, title, enabled, cron, timezone, model, prompt_ref, created_at, updated_at
        ) VALUES (
          ${automationId}, ${actor.workspaceId}, ${actor.userId}, 'Repair smoke', true,
          NULL, 'UTC', 'test:model', ${`.agents/automation/${automationId}.md`},
          '2026-07-10T00:00:00.000Z', '2026-07-10T00:00:00.000Z'
        )
      `
      await sql.unsafe(`DROP INDEX boring_automation_runs_active_once_idx`)
      for (const [id, status, timestamp] of [
        [olderRunId, "running", "2026-07-10T00:01:00.000Z"],
        [newerRunId, "queued", "2026-07-10T00:02:00.000Z"],
      ] as const) {
        await sql`
          INSERT INTO boring_automation_runs (
            id, automation_id, workspace_id, owner_user_id, invocation_id, dispatch_request_id, dispatch_receipt,
            session_id, status, trigger, scheduled_for, started_at, completed_at, duration_ms, input_tokens,
            output_tokens, total_tokens, prompt_snapshot, model_snapshot, error, created_at, updated_at
          ) VALUES (
            ${id}, ${automationId}, ${actor.workspaceId}, ${actor.userId}, ${`fixture:${id}`}, ${id}, NULL,
            NULL, ${status}, 'manual', NULL, ${timestamp}, NULL, NULL, NULL, NULL, NULL,
            'fixture', 'test:model', NULL, ${timestamp}, ${timestamp}
          )
        `
      }

      await expect(runBoringAutomationMigrations(sql)).resolves.toBeUndefined()
      const rows = await sql<{ id: string; status: string; completed_at: Date | null; error: string | null }[]>`
        SELECT id, status, completed_at, error
        FROM boring_automation_runs
        WHERE automation_id = ${automationId}
        ORDER BY updated_at DESC, created_at DESC, id DESC
      `
      expect(rows).toHaveLength(2)
      expect(rows).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: newerRunId, status: "queued", completed_at: null, error: null }),
        expect.objectContaining({
          id: olderRunId,
          status: "failed",
          completed_at: expect.any(Date),
          error: "Migration reconciled duplicate potentially-live run; a newer run retained the automation slot",
        }),
      ]))
      const indexes = await sql<{ indexdef: string }[]>`
        SELECT indexdef FROM pg_indexes
        WHERE schemaname = current_schema() AND indexname = 'boring_automation_runs_active_once_idx'
      `
      expect(indexes).toHaveLength(1)
      expect(indexes[0]!.indexdef).toContain("outcome-unknown")
    } finally {
      await sql`DELETE FROM boring_automation_automations WHERE id = ${automationId}`.catch(() => undefined)
      await runBoringAutomationMigrations(sql).catch(() => undefined)
      await sql.end()
    }
  })
})


describe("Postgres standing automation seeding", () => {
  it("serializes seeded pruning with concurrent hosted run admission", async () => {
    const sql = postgres(TEST_DB_URL, { max: 4 })
    const blockerSql = postgres(TEST_DB_URL, { max: 1 })
    const actor = { workspaceId: `seed-race-workspace-${randomUUID()}`, userId: `seed-race-user-${randomUUID()}` }
    const workspace = {
      root: "/workspace",
      runtimeContext: {},
      async readFile(path: string) {
        if (path === ".agents/automation/worker-slot.md") return "worker prompt"
        throw Object.assign(new Error("missing"), { code: "ENOENT" })
      },
    } as never
    const seed = {
      key: "worker-slot-4", title: "worker-slot-4", enabled: true, cron: null, timezone: "UTC",
      model: "openai-codex:gpt-5.6-sol", agentTypeId: "boring-worker",
      promptRef: ".agents/automation/worker-slot.md",
    }
    const suffix = randomUUID().replaceAll("-", "")
    const functionName = `boring_automation_run_gate_${suffix}`
    const triggerName = `boring_automation_run_gate_${suffix}`
    const advisoryKey = Number.parseInt(suffix.slice(0, 7), 16)
    let automationId: string | undefined
    try {
      await runBoringAutomationMigrations(sql)
      const store = new PostgresAutomationStore(sql, actor, undefined, workspace)
      automationId = (await store.ensureSeededAutomation(seed))!.id
      await sql.unsafe(`
        CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.automation_id = '${automationId}' THEN
            PERFORM pg_advisory_xact_lock(${advisoryKey});
          END IF;
          RETURN NEW;
        END
        $$
      `)
      await sql.unsafe(`
        CREATE TRIGGER "${triggerName}"
        BEFORE INSERT ON boring_automation_runs
        FOR EACH ROW EXECUTE FUNCTION "${functionName}"()
      `)
      await blockerSql`SELECT pg_advisory_lock(${advisoryKey})`

      const runPromise = store.beginRun({
        automationId,
        invocationId: `manual:${randomUUID()}`,
        trigger: "manual",
        promptSnapshot: "race",
        modelSnapshot: seed.model,
      })
      await waitFor(async () => {
        const rows = await sql<{ waiting: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM pg_locks
            WHERE locktype = 'advisory' AND granted = false AND objid = ${advisoryKey}
          ) AS waiting
        `
        return rows[0]?.waiting === true
      })

      const prunePromise = store.removeSeededAutomationIfIdle(seed.key)
      await expect(Promise.race([
        prunePromise.then(() => "settled" as const),
        delay(100).then(() => "pending" as const),
      ])).resolves.toBe("pending")

      await blockerSql`SELECT pg_advisory_unlock(${advisoryKey})`
      await expect(runPromise).resolves.toMatchObject({ automationId, status: "queued" })
      await expect(prunePromise).resolves.toBe(false)
      await expect(store.getAutomation(automationId)).resolves.toMatchObject({ id: automationId })
    } finally {
      await blockerSql`SELECT pg_advisory_unlock(${advisoryKey})`.catch(() => undefined)
      await sql.unsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON boring_automation_runs`).catch(() => undefined)
      await sql.unsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`).catch(() => undefined)
      if (automationId) await sql`DELETE FROM boring_automation_automations WHERE id = ${automationId}`.catch(() => undefined)
      await blockerSql.end()
      await sql.end()
    }
  }, 10_000)

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

      const edited = await store.updateAutomation(first!.id, { title: "operator title", enabled: false })
      await expect(store.ensureSeededAutomation(seed)).resolves.toMatchObject({
        title: "operator title", enabled: false, updatedAt: edited.updatedAt,
      })

      await store.deleteAutomation(first!.id)
      await expect(store.listAutomations()).resolves.toEqual([])
      await expect(store.ensureSeededAutomation(seed)).resolves.toMatchObject({
        id: first!.id, title: seed.title, enabled: true, promptRef: seed.promptRef,
      })
      await expect(store.listAutomations()).resolves.toHaveLength(1)
    } finally {
      await sql`DELETE FROM boring_automation_automations WHERE workspace_id = ${actor.workspaceId} AND owner_user_id = ${actor.userId}`.catch(() => undefined)
      await sql.end()
    }
  })
})

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await delay(10)
  }
  throw new Error("timed out waiting for PostgreSQL concurrency gate")
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}
