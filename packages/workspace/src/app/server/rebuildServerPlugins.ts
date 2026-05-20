/**
 * Server-side reload diagnostic pass. Re-resolves every entry in
 * `entries` (via jiti for dir-source entries → fresh modules) only to
 * detect import/factory failures and return diagnostics. Failed entries do
 * NOT abort the rest; they surface as `diagnostics[]` for the caller to
 * format into a structured /reload response.
 *
 * This deliberately does not return or install a rebuilt plugin graph. Live
 * prompt/Pi changes come from the asset manager's `systemPromptDynamic` and
 * `getDynamicResources` scans; static `agentTools` and free-form routes are
 * captured at session/server creation and require process restart.
 */
import type { WorkspaceServerPlugin } from "../../server/plugins/bootstrapServer"
import { isDirEntry, resolveOnePluginEntry } from "./pluginEntryResolver"
import type { WorkspacePluginEntry, WorkspaceAgentServerPluginContext } from "./createWorkspaceAgentServer"

export interface PluginReloadDiagnostic {
  pluginId?: string
  /** Free-form prefix already formatted for display (e.g. "directory (/abs/path)"). */
  source: string
  message: string
}

export interface PluginRebuildResult {
  ok: boolean
  diagnostics: PluginReloadDiagnostic[]
}

export async function rebuildServerPlugins(opts: {
  entries: WorkspacePluginEntry[]
  ctx: WorkspaceAgentServerPluginContext
}): Promise<PluginRebuildResult> {
  const { entries, ctx } = opts

  const diagnostics: PluginReloadDiagnostic[] = []

  for (const entry of entries) {
    try {
      await resolveOnePluginEntry<WorkspaceServerPlugin>(entry, ctx)
    } catch (error) {
      const source = isDirEntry(entry) ? `directory (${entry.dir})` : "entry"
      diagnostics.push({
        source,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { ok: diagnostics.length === 0, diagnostics }
}
