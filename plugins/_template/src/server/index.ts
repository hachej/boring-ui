import type { AgentTool } from "@hachej/boring-workspace"
import {
  defineServerPlugin,
  type WorkspaceServerPlugin,
} from "@hachej/boring-workspace/server"
import { SAMPLE_PLUGIN_ID } from "../shared/constants"

export function createSampleServerPlugin(): WorkspaceServerPlugin {
  return defineServerPlugin({
    id: SAMPLE_PLUGIN_ID,
    label: "Sample",
    agentTools: [] satisfies AgentTool[],
    systemPrompt: "## Sample Plugin",
  })
}

/**
 * Default export — adapter for the standard `defaultPluginPackages`
 * load process. The workspace's `pluginEntryResolver` calls a
 * dir-source plugin's default-exported factory with `(options, ctx)`
 * where `ctx = { workspaceRoot, bridge }`. The named
 * `createSampleServerPlugin()` factory stays for direct callers.
 */
export default function defaultSampleServerPlugin(
  _options?: unknown,
  _ctx?: { workspaceRoot: string; bridge: unknown },
): WorkspaceServerPlugin {
  return createSampleServerPlugin()
}
