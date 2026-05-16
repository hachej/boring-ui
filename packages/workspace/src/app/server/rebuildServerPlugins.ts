/**
 * Server-side rebuild on /reload. Mirrors Pi's reload pattern
 * (`@mariozechner/pi-coding-agent core/agent-session.js:1896 reload`):
 *
 *   1. Snapshot user-set state (the caller owns this — `liveLoadedIds`).
 *   2. Emit `plugin_shutdown` for each currently-loaded plugin.
 *   3. Re-resolve hot-reload-eligible entries (re-import via jiti).
 *   4. Emit `plugin_start { reason: "reload" }` for the fresh set.
 *   5. Return a diagnostics list — failed entries don't abort the rest
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
import type { ServerPluginLifecycleBus } from "./serverPluginLifecycle"
import {
  isDirEntry,
  isModuleEntry,
  resolveOnePluginEntry,
  type ResolveDirServerPluginContext,
} from "./pluginEntryResolver"
import type { WorkspacePluginEntry, WorkspaceAgentServerPluginContext } from "./createWorkspaceAgentServer"

export interface PluginReloadDiagnostic {
  pluginId?: string
  source: "module" | "directory" | "factory" | "object"
  path?: string
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
  bus?: ServerPluginLifecycleBus
  /** Plugin ids known to be loaded today, used for plugin_shutdown emission. */
  currentPluginIds?: string[]
}): Promise<PluginRebuildResult> {
  const { entries, ctx, bus, currentPluginIds = [] } = opts

  if (bus?.hasHandlers("plugin_shutdown")) {
    for (const pluginId of currentPluginIds) {
      await bus.emit({ type: "plugin_shutdown", pluginId, reason: "reload" })
    }
  }

  const plugins: WorkspaceServerPlugin[] = []
  const diagnostics: PluginReloadDiagnostic[] = []

  for (const entry of entries) {
    try {
      const plugin = await resolveOnePluginEntry<WorkspaceServerPlugin>(
        entry,
        ctx as unknown as ResolveDirServerPluginContext,
        (fn) => fn(ctx as unknown as ResolveDirServerPluginContext),
      )
      plugins.push(plugin)
      if (bus?.hasHandlers("plugin_start")) {
        await bus.emit({ type: "plugin_start", pluginId: plugin.id, reason: "reload" })
      }
    } catch (error) {
      // Classify the failed entry inline — only needed here.
      const source: PluginReloadDiagnostic["source"] =
        typeof entry === "function"
          ? "factory"
          : isDirEntry(entry)
            ? "directory"
            : isModuleEntry(entry)
              ? "module"
              : "object"
      const path = isDirEntry(entry) ? entry.dir : undefined
      diagnostics.push({
        source,
        path,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { ok: diagnostics.length === 0, plugins, diagnostics }
}

/** Stable single-line diagnostic format for the /reload error path. */
export function formatPluginDiagnostic(d: PluginReloadDiagnostic): string {
  return `${d.source}${d.path ? ` (${d.path})` : ""}: ${d.message}`
}
