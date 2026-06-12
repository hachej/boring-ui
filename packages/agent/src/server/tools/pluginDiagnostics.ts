/**
 * `plugin_diagnostics` built-in agent tool.
 *
 * Surfaces current plugin/skill loading errors to the agent so it can iterate
 * on them without the failures being silently swallowed. It merges three
 * sources:
 *
 *  - `lastReloadDiagnostics`: diagnostics captured by the most recent
 *    /api/v1/agent/reload (hook + harness resource diagnostics).
 *  - `resourceDiagnostics`: live Pi skill/extension load diagnostics for the
 *    current session, read straight from the harness.
 *  - `pluginErrors`: host-provided plugin load/preflight errors for the
 *    workspace (wired by the embedding host).
 *
 * The tool is informational: it returns the diagnostics as data and never
 * reports `isError`, even when diagnostics exist.
 */
import type { AgentTool, ToolExecContext, ToolResult } from '../../shared/tool'
import type { AgentHarness } from '../../shared/harness'

interface PluginDiagnostic {
  source: string
  message: string
  pluginId?: string
}

export interface PluginDiagnosticsToolDeps {
  /** Diagnostics stashed by the last /reload. Read via a thunk because the
   * runtime binding is assigned after the tool catalog is built. */
  getLastReloadDiagnostics: () => ReadonlyArray<PluginDiagnostic>
  /** Live harness, used to read per-session resource diagnostics. */
  getHarness: () => AgentHarness | undefined
  /** Optional host callback returning workspace plugin load/preflight errors. */
  getPluginErrors?: () => Promise<ReadonlyArray<PluginDiagnostic>>
}

export function createPluginDiagnosticsTool(deps: PluginDiagnosticsToolDeps): AgentTool {
  return {
    name: 'plugin_diagnostics',
    description: [
      'Return current plugin/skill loading errors plus the diagnostics from the',
      'last /reload. Call this after asking the user to run /reload — or whenever a',
      'plugin or skill you expected does not appear to be loaded — then fix the',
      'reported error and ask the user to /reload again. Returns a JSON object with',
      'lastReloadDiagnostics, resourceDiagnostics, and pluginErrors arrays; an empty',
      'result means no load errors were detected.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    async execute(_params: Record<string, unknown>, ctx: ToolExecContext): Promise<ToolResult> {
      const harness = deps.getHarness()
      const resourceDiagnostics = harness?.getResourceDiagnostics?.(ctx.sessionId ?? '') ?? []
      const pluginErrors = deps.getPluginErrors ? await deps.getPluginErrors() : []
      const payload = {
        lastReloadDiagnostics: deps.getLastReloadDiagnostics(),
        resourceDiagnostics,
        pluginErrors,
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        details: payload,
        isError: false,
      }
    },
  }
}
