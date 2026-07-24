import { describe, expect, it, vi } from "vitest"
import type postgres from "postgres"
import type { Workspace } from "@hachej/boring-agent/shared"
import { migrateHostedPromptsToWorkspaceFiles } from "../hostedPromptMigration"

describe("migrateHostedPromptsToWorkspaceFiles", () => {
  it("hard-migrates every legacy prompt and preserves existing files on restart", async () => {
    const rows = [
      { id: "automation-1", workspace_id: "workspace-1", owner_user_id: "user-1", prompt: "legacy one" },
      { id: "automation-2", workspace_id: "workspace-1", owner_user_id: "user-1", prompt: "legacy two" },
    ]
    const sql = (() => Promise.resolve(rows)) as unknown as postgres.Sql
    const files = new Map([[".agents/automation/automation-2.md", "workspace edit wins"]])
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
    const resolveWithWorkspace = vi.fn(async () => ({ workspace, dispatcher: {} }))
    const options = {
      sql,
      dispatcherResolver: { resolve: vi.fn(), resolveWithWorkspace } as never,
    }

    await migrateHostedPromptsToWorkspaceFiles(options)
    await migrateHostedPromptsToWorkspaceFiles(options)

    expect(files.get(".agents/automation/automation-1.md")).toBe("legacy one")
    expect(files.get(".agents/automation/automation-2.md")).toBe("workspace edit wins")
    expect(resolveWithWorkspace).toHaveBeenCalledTimes(2)
  })
})
