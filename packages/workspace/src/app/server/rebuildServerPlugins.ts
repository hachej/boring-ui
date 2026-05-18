/**
 * Server-side rebuild on /reload. Re-resolves every entry in
 * `entries` (via jiti for dir-source entries → fresh modules) and
 * returns a diagnostics list. Failed entries do NOT abort the rest;
 * they surface as `diagnostics[]` for the caller to format into a
 * structured /reload response.
 *
 * What this rebuilds:
 *   - `{ dir, hotReload: true }` entries — their fresh systemPrompt
 *     flows through `systemPromptDynamic` and pi resources through
 *     `getDynamicResources`.
 *
 * What this does NOT rebuild (captured at session creation in the
 * harness/Fastify): static `agentTools` and free-form routes. Swaps
 * to those surfaces only land after a server restart.
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
  plugins: WorkspaceServerPlugin[]
  diagnostics: PluginReloadDiagnostic[]
}

export async function rebuildServerPlugins(opts: {
  entries: WorkspacePluginEntry[]
  ctx: WorkspaceAgentServerPluginContext
}): Promise<PluginRebuildResult> {
  const { entries, ctx } = opts

  const plugins: WorkspaceServerPlugin[] = []
  const diagnostics: PluginReloadDiagnostic[] = []

  for (const entry of entries) {
    try {
      const plugin = await resolveOnePluginEntry<WorkspaceServerPlugin>(entry, ctx)
      plugins.push(plugin)
    } catch (error) {
      const source = isDirEntry(entry) ? `directory (${entry.dir})` : "entry"
      diagnostics.push({
        source,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { ok: diagnostics.length === 0, plugins, diagnostics }
}

