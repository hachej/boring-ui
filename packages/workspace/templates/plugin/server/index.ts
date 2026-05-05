import type { AgentTool } from "@boring/workspace"
import { defineServerPlugin } from "@boring/workspace/app/server"
import { SAMPLE_PLUGIN_ID } from "../shared/constants"

export function createSampleServerPlugin() {
  return defineServerPlugin({
    id: SAMPLE_PLUGIN_ID,
    label: "Sample",
    agentTools: [] satisfies AgentTool[],
    systemPrompt: "## Sample Plugin",
  })
}
