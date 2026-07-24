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

  it("materializes legacy database prompts once without overwriting an existing workspace file", async () => {
    const queries: RecordedQuery[] = []
    const row = {
      id: "00000000-0000-4000-8000-000000000001",
      title: "Daily",
      enabled: true,
      cron: "0 9 * * *",
      timezone: "UTC",
      model: "test:model",
      prompt: "legacy database prompt",
      prompt_file_ready: false,
      created_at: "2026-07-19T08:00:00.000Z",
      updated_at: "2026-07-19T08:00:00.000Z",
    }
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?")
      queries.push({ text, values })
      if (text.includes("SELECT id, title")) return Promise.resolve([{ ...row }])
      return Promise.resolve(Object.assign([], { count: 1 }))
    }) as unknown as postgres.Sql
    const files = new Map<string, string>()
    const workspace = {
      root: "/workspace",
      runtimeContext: {},
      async mkdir() {},
      async readFile(path: string) {
        if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" })
        return files.get(path)!
      },
      async writeFile(path: string, content: string) { files.set(path, content) },
    } as unknown as Workspace
    const store = new PostgresAutomationStore(sql, { workspaceId: "workspace-a", userId: "user-a" }, undefined, workspace)
    const path = `.agents/automation/${row.id}.md`

    await expect(store.getPrompt(row.id)).resolves.toBe("legacy database prompt")
    expect(files.get(path)).toBe("legacy database prompt")
    expect(queries.some((query) => query.text.includes("SET prompt_file_ready = true"))).toBe(true)

    files.set(path, "edited in workspace")
    await expect(store.getPrompt(row.id)).resolves.toBe("edited in workspace")
    expect(files.get(path)).toBe("edited in workspace")
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
        prompt: values[8], prompt_file_ready: true,
        created_at: values[9], updated_at: values[10],
      }])
    }) as unknown as postgres.Sql
    const store = new PostgresAutomationStore(sql, { workspaceId: "workspace-a", userId: "user-a" }, undefined, workspace)

    const automation = await store.createAutomation({
      title: "Daily", cron: "0 9 * * *", timezone: "UTC", model: "test:model", prompt: "canonical prompt",
    })

    expect(automation.promptRef).toBe(`.agents/automation/${automation.id}.md`)
    expect(files.get(automation.promptRef)).toBe("canonical prompt")
    expect(queries[0]!.text).toContain("prompt, prompt_file_ready")
    expect(queries[0]!.text).toContain(", true,")
    expect(queries[0]!.values).toContain("canonical prompt")
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
