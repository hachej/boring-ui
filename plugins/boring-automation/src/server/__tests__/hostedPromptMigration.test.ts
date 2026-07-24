import { describe, expect, it, vi } from "vitest"
import type postgres from "postgres"
import type { Workspace } from "@hachej/boring-agent/shared"
import { migrateHostedPromptsToWorkspaceFiles } from "../hostedPromptMigration"

type Row = { id: string; workspace_id: string; owner_user_id: string; prompt: string }

function memoryWorkspace(files = new Map<string, string>()): Workspace {
  return {
    root: "/workspace",
    runtimeContext: {},
    async mkdir() {},
    async readFile(path: string) {
      if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" })
      return files.get(path)!
    },
    async writeFile(path: string, content: string) { files.set(path, content) },
  } as unknown as Workspace
}

describe("migrateHostedPromptsToWorkspaceFiles", () => {
  it("hard-migrates every legacy prompt and preserves existing files on restart", async () => {
    const rows: Row[] = [
      { id: "automation-1", workspace_id: "workspace-1", owner_user_id: "user-1", prompt: "legacy one" },
      { id: "automation-2", workspace_id: "workspace-1", owner_user_id: "user-1", prompt: "legacy two" },
    ]
    const sql = (() => Promise.resolve(rows)) as unknown as postgres.Sql
    const files = new Map([[".agents/automation/automation-2.md", "workspace edit wins"]])
    const workspace = memoryWorkspace(files)
    const resolveWithWorkspace = vi.fn(async () => ({ workspace, dispatcher: {} }))
    const options = { sql, dispatcherResolver: { resolve: vi.fn(), resolveWithWorkspace } as never }

    await migrateHostedPromptsToWorkspaceFiles(options)
    await migrateHostedPromptsToWorkspaceFiles(options)

    expect(files.get(".agents/automation/automation-1.md")).toBe("legacy one")
    expect(files.get(".agents/automation/automation-2.md")).toBe("workspace edit wins")
    expect(resolveWithWorkspace).toHaveBeenCalledTimes(2)
  })

  it("reads legacy rows in bounded batches and reuses each workspace binding", async () => {
    const rows: Row[] = Array.from({ length: 101 }, (_, index) => ({
      id: `automation-${String(index).padStart(3, "0")}`,
      workspace_id: index < 100 ? "workspace-1" : "workspace-2",
      owner_user_id: "user-1",
      prompt: `prompt-${index}`,
    }))
    const sql = vi.fn()
      .mockResolvedValueOnce(rows.slice(0, 100))
      .mockResolvedValueOnce(rows.slice(100)) as unknown as postgres.Sql
    const workspaces = new Map([
      ["workspace-1", memoryWorkspace()],
      ["workspace-2", memoryWorkspace()],
    ])
    const resolveWithWorkspace = vi.fn(async ({ workspaceId }: { workspaceId: string }) => ({
      workspace: workspaces.get(workspaceId)!,
      dispatcher: {},
    }))

    await migrateHostedPromptsToWorkspaceFiles({
      sql,
      dispatcherResolver: { resolve: vi.fn(), resolveWithWorkspace } as never,
    })

    expect(sql).toHaveBeenCalledTimes(2)
    expect(resolveWithWorkspace).toHaveBeenCalledTimes(2)
  })

  it("fails closed and resumes a partial migration without overwriting completed files", async () => {
    const rows: Row[] = [
      { id: "automation-1", workspace_id: "workspace-1", owner_user_id: "user-1", prompt: "legacy one" },
      { id: "automation-2", workspace_id: "workspace-2", owner_user_id: "user-2", prompt: "legacy two" },
    ]
    const sql = (() => Promise.resolve(rows)) as unknown as postgres.Sql
    const firstFiles = new Map<string, string>()
    const firstWorkspace = memoryWorkspace(firstFiles)
    let failSecondWorkspace = true
    const secondFiles = new Map<string, string>()
    const secondWorkspace = memoryWorkspace(secondFiles)
    const resolveWithWorkspace = vi.fn(async ({ workspaceId }: { workspaceId: string }) => {
      if (workspaceId === "workspace-2" && failSecondWorkspace) throw new Error("workspace unavailable")
      return { workspace: workspaceId === "workspace-1" ? firstWorkspace : secondWorkspace, dispatcher: {} }
    })
    const options = { sql, dispatcherResolver: { resolve: vi.fn(), resolveWithWorkspace } as never }

    await expect(migrateHostedPromptsToWorkspaceFiles(options)).rejects.toThrow("workspace unavailable")
    firstFiles.set(".agents/automation/automation-1.md", "edited after partial migration")
    failSecondWorkspace = false
    await migrateHostedPromptsToWorkspaceFiles(options)

    expect(firstFiles.get(".agents/automation/automation-1.md")).toBe("edited after partial migration")
    expect(secondFiles.get(".agents/automation/automation-2.md")).toBe("legacy two")
  })
})
