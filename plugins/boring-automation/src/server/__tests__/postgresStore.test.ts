import { describe, expect, it } from "vitest"
import type postgres from "postgres"
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

  it("loads prompt content and revision in one actor-scoped query", async () => {
    const recorded = recordingSql([{
      prompt: "canonical",
      updated_at: "2026-07-19T08:00:00.000Z",
    }])
    const store = new PostgresAutomationStore(recorded.sql, { workspaceId: "workspace-a", userId: "user-a" })

    await expect(store.getPromptSnapshot("automation-a")).resolves.toEqual({
      prompt: "canonical",
      updatedAt: "2026-07-19T08:00:00.000Z",
    })
    expect(recorded.queries[0]!.text).toContain("SELECT prompt, updated_at")
    expect(recorded.queries[0]!.values).toEqual(expect.arrayContaining([
      "automation-a", "workspace-a", "user-a",
    ]))
  })

  it("updates prompts only at the expected actor-scoped revision", async () => {
    const expectedUpdatedAt = "2026-07-19T08:00:00.000Z"
    const recorded = recordingSql([{
      id: "automation-a",
      title: "Daily",
      enabled: true,
      cron: "0 9 * * *",
      timezone: "UTC",
      model: "test:model",
      prompt: "updated",
      created_at: expectedUpdatedAt,
      updated_at: "2026-07-19T08:00:00.001Z",
    }])
    const store = new PostgresAutomationStore(
      recorded.sql,
      { workspaceId: "workspace-a", userId: "user-a" },
      () => new Date(expectedUpdatedAt),
    )

    await expect(store.updatePromptIfCurrent("automation-a", "updated", expectedUpdatedAt)).resolves.toMatchObject({
      id: "automation-a",
      updatedAt: "2026-07-19T08:00:00.001Z",
    })

    expect(recorded.queries[0]!.text).toContain("AND updated_at = ?")
    expect(recorded.queries[0]!.values).toEqual(expect.arrayContaining([
      "updated",
      "2026-07-19T08:00:00.001Z",
      "automation-a",
      "workspace-a",
      "user-a",
      expectedUpdatedAt,
    ]))
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

    await expect(listHostedAutomationCandidates(recorded.sql)).resolves.toEqual([])

    expect(recorded.queries[0]!.text).toContain("FROM boring_automation_automations")
    expect(recorded.queries[0]!.text).toContain("WHERE deleted_at IS NULL")
  })
})
