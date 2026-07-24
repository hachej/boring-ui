import type postgres from "postgres"
import type { WorkspaceAgentDispatcherResolver } from "@hachej/boring-agent/server"
import type { Workspace } from "@hachej/boring-agent/shared"
import { AUTOMATION_PROMPT_DIRECTORY, automationPromptPath } from "../shared/prompt"

export async function migrateHostedPromptsToWorkspaceFiles({
  sql,
  dispatcherResolver,
}: {
  sql: postgres.Sql
  dispatcherResolver: WorkspaceAgentDispatcherResolver
}): Promise<void> {
  if (!dispatcherResolver.resolveWithWorkspace) throw new Error("workspace-bound automation storage is unavailable")
  const rows = await sql<{ id: string; workspace_id: string; owner_user_id: string; prompt: string }[]>`
    SELECT id, workspace_id, owner_user_id, prompt
    FROM boring_automation_automations
    ORDER BY workspace_id, owner_user_id, id
  `
  const workspaces = new Map<string, Workspace>()
  for (const row of rows) {
    const actor = { workspaceId: row.workspace_id, userId: row.owner_user_id }
    let workspace = workspaces.get(actor.workspaceId)
    if (!workspace) {
      workspace = (await dispatcherResolver.resolveWithWorkspace(actor)).workspace
      await workspace.mkdir(AUTOMATION_PROMPT_DIRECTORY, { recursive: true })
      workspaces.set(actor.workspaceId, workspace)
    }
    const promptPath = automationPromptPath(row.id)
    try {
      await workspace.readFile(promptPath)
    } catch (error) {
      if (!isNotFound(error)) throw error
      await workspace.writeFile(promptPath, row.prompt)
    }
  }
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false
  return ["ENOENT", "PATH_NOT_FOUND"].includes(String((error as { code?: unknown }).code))
}
