import { describe, expect, it } from "vitest"
import type postgres from "postgres"
import type { Workspace } from "@hachej/boring-agent/shared"
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

  it("claims queued dispatch atomically within the actor scope", async () => {
    const recorded = recordingSql([])
    const actor = { workspaceId: "workspace-a", userId: "user-a" }
    const store = new PostgresAutomationStore(recorded.sql, actor)

    await expect(store.claimRunForDispatch("run-1")).resolves.toBeNull()

    expect(recorded.queries).toHaveLength(1)
    expect(recorded.queries[0]!.text).toContain("UPDATE boring_automation_runs")
    expect(recorded.queries[0]!.text).toContain("status = 'queued'")
    expect(recorded.queries[0]!.text).toContain("RETURNING *")
    expect(recorded.queries[0]!.values).toEqual(expect.arrayContaining([
      "run-1", actor.workspaceId, actor.userId,
    ]))
  })

  it("reads canonical prompts from the workspace without querying PostgreSQL prompt bodies", async () => {
    const row = {
      id: "automation-1",
      title: "Daily",
      enabled: true,
      cron: "0 9 * * *",
      timezone: "UTC",
      model: "test:model",
      created_at: "2026-07-19T08:00:00.000Z",
      updated_at: "2026-07-19T08:00:00.000Z",
    }
    const recorded = recordingSql([row])
    const workspace = {
      root: "/workspace",
      runtimeContext: {},
      async readFile() { return "workspace prompt" },
    } as unknown as Workspace
    const store = new PostgresAutomationStore(
      recorded.sql,
      { workspaceId: "workspace-a", userId: "user-a" },
      undefined,
      workspace,
    )

    await expect(store.getPrompt(row.id)).resolves.toBe("workspace prompt")

    expect(recorded.queries).toHaveLength(1)
    expect(recorded.queries[0]!.text).not.toMatch(/\bprompt\b/)
    expect(recorded.queries[0]!.text).not.toContain("UPDATE boring_automation_automations")
  })

  it("writes a new canonical prompt file before committing hosted metadata", async () => {
    const queries: RecordedQuery[] = []
    const files = new Map<string, string>()
    const workspace = {
      root: "/workspace",
      runtimeContext: {},
      async mkdir() {},
      async readFile(path: string) { return files.get(path) ?? "" },
      async writeFile(path: string, content: string) { files.set(path, content) },
    } as unknown as Workspace
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?")
      queries.push({ text, values })
      if (!text.includes("INSERT INTO boring_automation_automations")) return Promise.resolve([])
      return Promise.resolve([{
        id: values[0], title: values[3], enabled: values[4], cron: values[5], timezone: values[6], model: values[7],
        created_at: values[8], updated_at: values[9],
      }])
    }) as unknown as postgres.Sql
    const store = new PostgresAutomationStore(sql, { workspaceId: "workspace-a", userId: "user-a" }, undefined, workspace)

    const automation = await store.createAutomation({
      title: "Daily", cron: "0 9 * * *", timezone: "UTC", model: "test:model", prompt: "canonical prompt",
    })

    expect(automation.promptRef).toBe(`.agents/automation/${automation.id}.md`)
    expect(files.get(automation.promptRef)).toBe("canonical prompt")
    expect(queries[0]!.text).toContain("model, created_at")
    expect(queries[0]!.text).not.toMatch(/\bprompt\b/)
    expect(queries[0]!.values).not.toContain("canonical prompt")
  })

  it("updates canonical prompt files without mirroring bodies into PostgreSQL", async () => {
    const queries: RecordedQuery[] = []
    const row = {
      id: "automation-1", title: "Daily", enabled: true, cron: "0 9 * * *", timezone: "UTC", model: "test:model",
      created_at: "2026-07-19T08:00:00.000Z", updated_at: "2026-07-19T08:00:00.000Z",
    }
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?")
      queries.push({ text, values })
      return Promise.resolve(text.includes("SELECT id, title") ? [row] : [])
    }) as unknown as postgres.Sql
    const files = new Map<string, string>()
    const workspace = {
      root: "/workspace",
      runtimeContext: {},
      async mkdir() {},
      async writeFile(path: string, content: string) { files.set(path, content) },
    } as unknown as Workspace
    const store = new PostgresAutomationStore(sql, { workspaceId: "workspace-a", userId: "user-a" }, undefined, workspace)

    await store.updatePrompt(row.id, "workspace-only prompt")

    expect(files.get(`.agents/automation/${row.id}.md`)).toBe("workspace-only prompt")
    expect(queries).toHaveLength(2)
    expect(queries[1]!.text).toContain("SET updated_at = ?")
    expect(queries[1]!.text).not.toMatch(/\bprompt\b/)
    expect(queries[1]!.values).not.toContain("workspace-only prompt")
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
    expect(recorded.queries[1]!.text).toContain("runs.status IN ('queued', 'dispatching', 'running')")
    expect(recorded.queries[1]!.text).toContain("runs.scheduled_for = ?")
    expect(recorded.queries[1]!.text).not.toContain("SELECT *")
    expect(recorded.queries[1]!.values).toContain("2026-07-23T09:00:00.000Z")
  })
})
