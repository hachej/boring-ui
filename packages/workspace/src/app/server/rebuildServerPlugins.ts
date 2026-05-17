/**
 * Server-side rebuild on /reload. Mirrors Pi's reload pattern
 * (`@mariozechner/pi-coding-agent core/agent-session.js:1896 reload`):
 *
 *   1. Snapshot user-set state (the caller owns this — `liveLoadedIds`).
 *   2. Re-resolve hot-reload-eligible entries (re-import via jiti).
 *   3. Return a diagnostics list — failed entries don't abort the rest
 *      (Pi parity: `core/extensions/loader.js:288` error continuation).
 *
 * What this DOES rebuild:
 *   - `{ dir, hotReload: true }` entries — their fresh systemPrompt
 *     flows through `systemPromptDynamic` and pi resources through
 *     `getDynamicResources`.
 *
 * What this does NOT rebuild (Pi parity boundary — captured at session
 * creation in the harness/Fastify): static `agentTools` and free-form
 * routes. A future phase may surface that as a structured diagnostic;
 * today swaps to those surfaces only land after a restart.
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
  /** Plugin ids known to be loaded today; reserved for diagnostics. */
  currentPluginIds?: string[]
}): Promise<PluginRebuildResult> {
  const { entries, ctx } = opts

  const plugins: WorkspaceServerPlugin[] = []
  const diagnostics: PluginReloadDiagnostic[] = []

  for (const entry of entries) {
    try {
      const plugin = await resolveOnePluginEntry<WorkspaceServerPlugin>(entry, ctx)
      plugins.push(plugin)
    } catch (error) {
      // Compose the diagnostic source prefix inline — only needed here.
      const source =
        typeof entry === "function"
          ? "factory"
          : isDirEntry(entry)
            ? `directory (${entry.dir})`
            : "entry"
      diagnostics.push({
        source,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { ok: diagnostics.length === 0, plugins, diagnostics }
}

