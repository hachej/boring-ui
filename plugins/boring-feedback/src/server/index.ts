import type { AgentTool } from "@hachej/boring-workspace"
import {
  defineServerPlugin,
  type WorkspaceServerPlugin,
} from "@hachej/boring-workspace/server"
import { BORING_FEEDBACK_PLUGIN_ID } from "../shared/constants"

export function createBoringFeedbackServerPlugin(): WorkspaceServerPlugin {
  return defineServerPlugin({
    id: BORING_FEEDBACK_PLUGIN_ID,
    label: "Feedback",
    agentTools: [] satisfies AgentTool[],
    systemPrompt: "## Feedback Plugin\n\nUse the boring-feedback skill for /feedback intake.",
  })
}

/**
 * Default export — adapter for the standard `defaultPluginPackages`
 * load process. The workspace's `pluginEntryResolver` calls a
 * dir-source plugin's default-exported factory with `(options, ctx)`
 * where `ctx = { workspaceRoot, bridge }`. The named
 * `createBoringFeedbackServerPlugin()` factory stays for direct callers.
 */
export default function defaultBoringFeedbackServerPlugin(
  _options?: unknown,
  _ctx?: { workspaceRoot: string; bridge: unknown },
): WorkspaceServerPlugin {
  return createBoringFeedbackServerPlugin()
}
