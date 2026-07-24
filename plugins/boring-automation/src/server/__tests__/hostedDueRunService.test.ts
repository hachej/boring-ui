import type postgres from "postgres"
import { describe, expect, it, vi } from "vitest"
import { BORING_AUTOMATION_ERROR_CODES } from "../../shared"
import { HostedDueRunService } from "../hostedDueRunService"

const AUTOMATION_ROW = {
  id: "automation-a",
  workspace_id: "workspace-a",
  owner_user_id: "user-a",
  title: "Daily",
  enabled: true,
  cron: "0 9 * * *",
  timezone: "UTC",
  model: "test:model-a",
  created_at: "2026-07-23T08:00:00.000Z",
  updated_at: "2026-07-23T08:00:00.000Z",
}

const RUN_ROW = {
  id: "run-a",
  automation_id: "automation-a",
  session_id: null,
  status: "queued",
  trigger: "scheduled",
  scheduled_for: "2026-07-23T09:00:00.000Z",
  started_at: null,
  completed_at: null,
  duration_ms: null,
  input_tokens: null,
  output_tokens: null,
  total_tokens: null,
  prompt_snapshot: "Run",
  model_snapshot: "test:model-a",
  error: null,
  created_at: "2026-07-23T09:00:15.000Z",
  updated_at: "2026-07-23T09:00:15.000Z",
}

type MutableRunRow = Omit<typeof RUN_ROW, "session_id" | "started_at" | "completed_at" | "duration_ms"> & {
  session_id: string | null
  started_at: string | null
  completed_at: string | null
  duration_ms: number | null
}

function uniqueRaceSql(constraintName: string): postgres.Sql {
  return (async (strings: TemplateStringsArray) => {
    const text = strings.join("?")
    if (text.includes("INSERT INTO boring_automation_runs")) {
      throw Object.assign(new Error("unique violation"), { code: "23505", constraint_name: constraintName })
    }
    if (text.includes("SELECT prompt")) return [{ prompt: "Run" }]
    if (text.includes("FROM boring_automation_automations")) return [AUTOMATION_ROW]
    return []
  }) as unknown as postgres.Sql
}

describe("HostedDueRunService", () => {
  it("rejects an unauthorized creator before actor-scoped execution", async () => {
    const queries: string[] = []
    const sql = (async (strings: TemplateStringsArray) => {
      const text = strings.join("?")
      queries.push(text)
      return text.includes("FROM boring_automation_automations") ? [AUTOMATION_ROW] : []
    }) as unknown as postgres.Sql
    const resolve = vi.fn()
    const verifyActor = vi.fn(() => false)
    const service = new HostedDueRunService({
      sql,
      dispatcherResolver: { resolve } as never,
      verifyActor,
      clock: () => new Date("2026-07-23T09:00:15.000Z"),
    })

    const result = await service.runDue()

    expect(verifyActor).toHaveBeenCalledWith({ workspaceId: "workspace-a", userId: "user-a" })
    expect(result.outcomes).toEqual([expect.objectContaining({
      kind: "failed",
      code: BORING_AUTOMATION_ERROR_CODES.OWNER_UNAUTHORIZED,
    })])
    expect(resolve).not.toHaveBeenCalled()
    expect(queries).toHaveLength(2)
  })

  it("executes a verified creator internally without fabricating a request", async () => {
    let runRow: MutableRunRow = { ...RUN_ROW }
    let lifecycleUpdates = 0
    const sql = (async (strings: TemplateStringsArray) => {
      const text = strings.join("?")
      if (text.includes("SELECT prompt")) return [{ prompt: "Run" }]
      if (text.includes("INSERT INTO boring_automation_runs")) return [runRow]
      if (text.includes("SELECT * FROM boring_automation_runs")) return [runRow]
      if (text.includes("UPDATE boring_automation_runs")) {
        lifecycleUpdates += 1
        runRow = lifecycleUpdates === 1
          ? { ...runRow, status: "running", started_at: "2026-07-23T09:00:15.000Z" }
          : lifecycleUpdates === 2
            ? { ...runRow, session_id: "session-1" }
            : { ...runRow, status: "succeeded", completed_at: "2026-07-23T09:00:16.000Z", duration_ms: 1_000 }
        return [runRow]
      }
      if (text.includes("FROM boring_automation_automations")) return [AUTOMATION_ROW]
      return []
    }) as unknown as postgres.Sql
    const send = vi.fn(() => (async function* () { yield { sessionId: "session-1" } })())
    const resolve = vi.fn(async () => ({ send }))
    const verifyActor = vi.fn(() => true)
    const service = new HostedDueRunService({
      sql,
      dispatcherResolver: { resolve } as never,
      verifyActor,
      clock: () => new Date("2026-07-23T09:00:15.000Z"),
    })

    const result = await service.runDue()

    const actor = { workspaceId: "workspace-a", userId: "user-a" }
    expect(verifyActor).toHaveBeenCalledWith(actor)
    expect(resolve).toHaveBeenCalledWith(actor, undefined)
    expect(send).toHaveBeenCalledOnce()
    expect(result.outcomes).toEqual([expect.objectContaining({
      kind: "started",
      automationId: "automation-a",
      scheduledFor: "2026-07-23T09:00:00.000Z",
      run: expect.objectContaining({ status: "succeeded", sessionId: "session-1" }),
    })])
  })

  it.each([
    ["boring_automation_runs_active_once_idx", "active-run"],
    ["boring_automation_runs_scheduled_once_idx", "duplicate-scheduled-run"],
  ])("reports %s cross-process races as skips", async (constraintName, reason) => {
    const resolve = vi.fn()
    const service = new HostedDueRunService({
      sql: uniqueRaceSql(constraintName),
      dispatcherResolver: { resolve } as never,
      verifyActor: vi.fn(() => true),
      clock: () => new Date("2026-07-23T09:00:15.000Z"),
    })

    const result = await service.runDue()

    expect(result.outcomes).toEqual([expect.objectContaining({
      kind: "skipped",
      automationId: "automation-a",
      scheduledFor: "2026-07-23T09:00:00.000Z",
      reason,
    })])
    expect(resolve).not.toHaveBeenCalled()
  })
})
