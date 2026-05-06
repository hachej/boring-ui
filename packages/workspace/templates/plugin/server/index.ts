import { defineServerPlugin } from "@boring/workspace/app/server"
import { SAMPLE_PLUGIN_ID } from "../shared/constants"
import { createSampleTools } from "../agent/tools/sampleTools"

export function createSampleServerPlugin() {
  return defineServerPlugin({
    id: SAMPLE_PLUGIN_ID,
    label: "Sample",
    agentTools: createSampleTools(),
    systemPrompt: "## Sample Plugin",
  })
}
