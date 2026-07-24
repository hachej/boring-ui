import type postgres from "postgres"
import type { WorkspaceAgentDispatcherResolver } from "@hachej/boring-agent/server"
import type { Workspace } from "@hachej/boring-agent/shared"
import { AUTOMATION_PROMPT_DIRECTORY, automationPromptPath } from "../shared/prompt"

const PROMPT_MIGRATION_BATCH_SIZE = 100

type LegacyPromptCursor = {
  id: string
  workspace_id: string
  owner_user_id: string
}

type LegacyPromptRow = LegacyPromptCursor & { prompt: string }

export async function migrateHostedPromptsToWorkspaceFiles({
  sql,
  dispatcherResolver,
}: {
  sql: postgres.Sql
  dispatcherResolver: WorkspaceAgentDispatcherResolver
}): Promise<void> {
  if (!dispatcherResolver.resolveWithWorkspace) throw new Error("workspace-bound automation storage is unavailable")
  let cursor: LegacyPromptCursor | undefined
  let workspaceId: string | undefined
  let workspace: Workspace | undefined

  while (true) {
    const rows = cursor
      ? await sql<LegacyPromptRow[]>`
          SELECT id, workspace_id, owner_user_id, prompt
          FROM boring_automation_automations
          WHERE (workspace_id, owner_user_id, id) > (${cursor.workspace_id}, ${cursor.owner_user_id}, ${cursor.id})
          ORDER BY workspace_id, owner_user_id, id
          LIMIT ${PROMPT_MIGRATION_BATCH_SIZE}
        `
      : await sql<LegacyPromptRow[]>`
          SELECT id, workspace_id, owner_user_id, prompt
          FROM boring_automation_automations
          ORDER BY workspace_id, owner_user_id, id
          LIMIT ${PROMPT_MIGRATION_BATCH_SIZE}
        `
    if (rows.length === 0) return

    for (const row of rows) {
      if (row.workspace_id !== workspaceId) {
        workspace = (await dispatcherResolver.resolveWithWorkspace({
          workspaceId: row.workspace_id,
          userId: row.owner_user_id,
        })).workspace
        await workspace.mkdir(AUTOMATION_PROMPT_DIRECTORY, { recursive: true })
        workspaceId = row.workspace_id
      }
      if (!workspace) throw new Error("workspace prompt migration resolution failed")
      await writeMissingPrompt(workspace, row)
    }

    if (rows.length < PROMPT_MIGRATION_BATCH_SIZE) return
    const last = rows.at(-1)!
    cursor = { id: last.id, workspace_id: last.workspace_id, owner_user_id: last.owner_user_id }
  }
}

async function writeMissingPrompt(workspace: Workspace, row: LegacyPromptRow): Promise<void> {
  const promptPath = automationPromptPath(row.id)
  try {
    await workspace.readFile(promptPath)
  } catch (error) {
    if (!isNotFound(error)) throw error
    await workspace.writeFile(promptPath, row.prompt)
  }
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false
  return ["ENOENT", "PATH_NOT_FOUND"].includes(String((error as { code?: unknown }).code))
}
