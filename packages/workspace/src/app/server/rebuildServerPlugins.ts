/**
 * Phase 4 of the unified plugin plan: server-side rebuild on /reload.
 *
 * Mirrors Pi's reload pattern (`@mariozechner/pi-coding-agent`
 * `core/agent-session.js:1896 reload`):
 *
 *   1. Snapshot user-set state.
 *   2. Emit `plugin_shutdown` for each currently-loaded plugin.
 *   3. Re-resolve hot-reload-eligible entries (re-import via jiti).
 *   4. Emit `plugin_start { reason: "reload" }` for the fresh set.
 *   5. Return a diagnostics list — failed entries don't abort the rest.
 *
 * Phase 4 introduces this primitive. Phase 5 will wire it into the
 * actual `/reload` HTTP path so the response carries the diagnostics.
 *
 * What this DOES rebuild:
 *   - WorkspaceServerPlugin objects derived from `{ spec: { dir }, hotReload: true }`
 *     entries. Their `systemPrompt` flows back into the next agent turn
 *     via `systemPromptDynamic`, and their `piPackages`/`extensionPaths`
 *     via `getDynamicResources`.
 *
 * What this does NOT rebuild (Pi parity boundary — these are
 * captured-at-session-creation in the harness/Fastify):
 *   - Static `agentTools` registered via WorkspaceServerPlugin.agentTools
 *     — emit `boring.plugin.needs-session-restart` diagnostic.
 *   - Free-form Fastify `routes` registered via factory entries — emit
 *     `boring.plugin.needs-server-restart` diagnostic.
 */
import type { WorkspaceServerPlugin } from "../../server/plugins/bootstrapServer"
import type { ServerPluginLifecycleBus } from "./serverPluginLifecycle"
import {
  isDirEntry,
  isModuleEntry,
  resolveDirServerPlugin,
  resolveModuleServerPlugin,
  type ResolveDirServerPluginContext,
} from "./pluginEntryResolver"
import type { WorkspacePluginEntry, WorkspaceAgentServerPluginContext } from "./createWorkspaceAgentServer"

export interface PluginReloadDiagnostic {
  pluginId?: string
  source: "module" | "directory" | "factory" | "object"
  path?: string
  message: string
  /** Hint to consumers about what action would clear the diagnostic. */
  needs?: "page-reload" | "session-restart" | "server-restart"
}

export interface PluginRebuildResult {
  ok: boolean
  plugins: WorkspaceServerPlugin[]
  diagnostics: PluginReloadDiagnostic[]
}

/**
 * Rebuild the SERVER plugin set by re-resolving the current entry list.
 *
 * - Pre-built objects and factory functions pass through (their bodies
 *   were captured at boot; nothing to re-import).
 * - `{ spec: { module } }` entries call their `module()` thunk again —
 *   if the host wired a fresh-import thunk, the new module is loaded.
 * - `{ spec: { dir }, hotReload: true }` entries re-resolve via jiti
 *   (Pi parity: `extensions/loader.js:224 createJiti({ moduleCache: false })`).
 *
 * Returns diagnostics for any entry that fails to re-resolve. The other
 * entries still rebuild — Pi posture (`extensions/loader.js:288`):
 * one failed extension records `{ path, error }` and the loop continues.
 */
export async function rebuildServerPlugins(opts: {
  entries: WorkspacePluginEntry[]
  ctx: WorkspaceAgentServerPluginContext
  bus?: ServerPluginLifecycleBus
  /** Plugin ids known to be loaded today, used for plugin_shutdown emission. */
  currentPluginIds?: string[]
}): Promise<PluginRebuildResult> {
  const { entries, ctx, bus, currentPluginIds = [] } = opts

  // Pi parity: emit shutdown to every currently-loaded plugin BEFORE
  // re-resolving. Handlers can flush state before their module is gone.
  if (bus?.hasHandlers("plugin_shutdown")) {
    for (const pluginId of currentPluginIds) {
      await bus.emit({ type: "plugin_shutdown", pluginId, reason: "reload" })
    }
  }

  const plugins: WorkspaceServerPlugin[] = []
  const diagnostics: PluginReloadDiagnostic[] = []

  for (const entry of entries) {
    // Gemini Phase 4 review: classify ONCE outside the try block so the
    // catch branch can use the same shape without recomputing.
    const source = classifyEntrySource(entry)
    const path = classifyEntryPath(entry)
    try {
      let plugin: WorkspaceServerPlugin
      if (typeof entry === "function") {
        plugin = entry(ctx as unknown as WorkspaceAgentServerPluginContext)
      } else if (isDirEntry(entry)) {
        plugin = await resolveDirServerPlugin(entry, ctx as unknown as ResolveDirServerPluginContext)
      } else if (isModuleEntry(entry)) {
        plugin = await resolveModuleServerPlugin(entry, ctx as unknown as ResolveDirServerPluginContext)
      } else {
        plugin = entry as WorkspaceServerPlugin
      }
      plugins.push(plugin)
      // Pi parity: emit `plugin_start { reason: "reload" }` after each
      // successful resolve. Phase 5 will use this to drive front
      // re-mount and bridge re-subscription.
      if (bus?.hasHandlers("plugin_start")) {
        await bus.emit({ type: "plugin_start", pluginId: plugin.id, reason: "reload" })
      }
    } catch (error) {
      diagnostics.push({
        source,
        path,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { ok: diagnostics.length === 0, plugins, diagnostics }
}

function classifyEntrySource(entry: WorkspacePluginEntry): PluginReloadDiagnostic["source"] {
  if (typeof entry === "function") return "factory"
  if (isDirEntry(entry)) return "directory"
  if (isModuleEntry(entry)) return "module"
  return "object"
}

function classifyEntryPath(entry: WorkspacePluginEntry): string | undefined {
  if (typeof entry !== "object" || entry === null) return undefined
  if (isDirEntry(entry)) return entry.spec.dir
  return undefined
}
