import { describe, expect, it } from "vitest"
import type postgres from "postgres"
import { BORING_AUTOMATION_ERROR_CODES } from "../../shared"
import { PostgresAutomationStore, listHostedAutomationCandidates } from "../postgresStore"

type RecordedQuery = { text: string; values: unknown[] }

function recordingSql(rows: unknown[] = []) {
  const queries: RecordedQuery[] = []
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push({ text: strings.join("?"), values })
    return Promise.resolve(rows)
  }) as unknown as postgres.Sql
  return { sql, queries }
}

describe("PostgresAutomationStore actor isolation", () => {
  it("scopes every active automation and run read by both workspace and owner", async () => {
    const recorded = recordingSql([])
    const actorA = { workspaceId: "workspace-a", userId: "user-a" }
    const actorB = { workspaceId: "workspace-b", userId: "user-b" }
    const storeA = new PostgresAutomationStore(recorded.sql, actorA)
    const storeB = new PostgresAutomationStore(recorded.sql, actorB)

    await expect(storeA.listAutomations()).resolves.toEqual([])
    await expect(storeA.getAutomation("automation-from-b")).resolves.toBeNull()
    await expect(storeA.listRuns("automation-from-b")).resolves.toEqual([])
    await expect(storeB.listAutomations()).resolves.toEqual([])
    await expect(storeB.getAutomation("automation-from-a")).resolves.toBeNull()
    await expect(storeB.listRuns("automation-from-a")).resolves.toEqual([])

    expect(recorded.queries).toHaveLength(6)
    for (const query of recorded.queries.slice(0, 3)) {
      expect(query.text).toContain("workspace_id = ?")
      expect(query.text).toContain("owner_user_id = ?")
      if (query.text.includes("boring_automation_automations")) expect(query.text).toContain("deleted_at IS NULL")
      expect(query.values).toEqual(expect.arrayContaining([actorA.workspaceId, actorA.userId]))
      expect(query.values).not.toEqual(expect.arrayContaining([actorB.workspaceId, actorB.userId]))
    }
    for (const query of recorded.queries.slice(3)) {
      expect(query.text).toContain("workspace_id = ?")
      expect(query.text).toContain("owner_user_id = ?")
      if (query.text.includes("boring_automation_automations")) expect(query.text).toContain("deleted_at IS NULL")
      expect(query.values).toEqual(expect.arrayContaining([actorB.workspaceId, actorB.userId]))
      expect(query.values).not.toEqual(expect.arrayContaining([actorA.workspaceId, actorA.userId]))
    }
  })

  it("soft-deletes actor-scoped metadata without deleting prompt or run rows", async () => {
    const queries: RecordedQuery[] = []
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      queries.push({ text: strings.join("?"), values })
      return Promise.resolve(Object.assign([], { count: 1 }))
    }) as unknown as postgres.Sql
    const store = new PostgresAutomationStore(sql, { workspaceId: "workspace-a", userId: "user-a" }, () => new Date("2026-07-19T08:00:00.000Z"))

    await expect(store.deleteAutomation("automation-a")).resolves.toBeUndefined()

    expect(queries).toHaveLength(1)
    expect(queries[0]!.text).toContain("UPDATE boring_automation_automations")
    expect(queries[0]!.text).toContain("SET enabled = false, deleted_at = ?")
    expect(queries[0]!.text).toContain("deleted_at IS NULL")
    expect(queries[0]!.text).not.toContain("DELETE FROM")
    expect(queries[0]!.text).not.toContain("boring_automation_runs")
    expect(queries[0]!.values).toEqual(expect.arrayContaining([
      "automation-a", "workspace-a", "user-a", "2026-07-19T08:00:00.000Z",
    ]))
  })

  it("excludes tombstoned automations from hosted due candidates", async () => {
    const recorded = recordingSql([])

    await expect(listHostedAutomationCandidates(recorded.sql, "2026-07-23T09:00:00.000Z")).resolves.toEqual([])

    expect(recorded.queries[0]!.text).toContain("FROM boring_automation_automations")
    expect(recorded.queries[0]!.text).toContain("WHERE deleted_at IS NULL")
    expect(recorded.queries[0]!.text).not.toContain("prompt")
    expect(recorded.queries[1]!.text).toContain("runs.status IN ('queued', 'running')")
    expect(recorded.queries[1]!.text).toContain("runs.scheduled_for = ?")
    expect(recorded.queries[1]!.text).not.toContain("SELECT *")
    expect(recorded.queries[1]!.values).toContain("2026-07-23T09:00:00.000Z")
  })

  it.each([
    ["boring_automation_runs_active_once_idx", BORING_AUTOMATION_ERROR_CODES.RUN_ALREADY_ACTIVE],
    ["boring_automation_runs_scheduled_once_idx", BORING_AUTOMATION_ERROR_CODES.RUN_ALREADY_RECORDED],
  ])("maps %s uniqueness races to the stable duplicate-run error", async (constraintName, expectedCode) => {
    const automationRow = {
      id: "automation-a",
      title: "Daily",
      enabled: true,
      cron: "0 9 * * *",
      timezone: "UTC",
      model: "test:model-a",
      prompt: "Run",
      created_at: "2026-07-23T08:00:00.000Z",
      updated_at: "2026-07-23T08:00:00.000Z",
    }
    const sql = (async (strings: TemplateStringsArray) => {
      const text = strings.join("?")
      if (text.includes("FROM boring_automation_automations")) return [automationRow]
      if (text.includes("status IN ('queued', 'running')")) return []
      if (text.includes("INSERT INTO boring_automation_runs")) {
        throw Object.assign(new Error("unique violation"), { code: "23505", constraint_name: constraintName })
      }
      return []
    }) as unknown as postgres.Sql
    const store = new PostgresAutomationStore(sql, { workspaceId: "workspace-a", userId: "user-a" })

    await expect(store.beginRun({
      automationId: "automation-a",
      trigger: "scheduled",
      scheduledFor: "2026-07-23T09:00:00.000Z",
      promptSnapshot: "Run",
      modelSnapshot: "test:model-a",
      createdAt: "2026-07-23T09:00:00.000Z",
    })).rejects.toMatchObject({ code: expectedCode })
  })
})
