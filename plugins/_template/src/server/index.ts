import type { AgentTool } from "@hachej/boring-workspace"
import { defineServerPlugin } from "@hachej/boring-workspace/app/server"
import { SAMPLE_PLUGIN_ID } from "../shared/constants"

export function createSampleServerPlugin() {
  return defineServerPlugin({
    id: SAMPLE_PLUGIN_ID,
    label: "Sample",
    agentTools: [] satisfies AgentTool[],
    systemPrompt: "## Sample Plugin",
  })
}
