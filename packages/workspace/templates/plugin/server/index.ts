import type { AgentTool } from "@boring/workspace"
import { SAMPLE_PLUGIN_ID } from "../constants"

export function createSampleServerPlugin(): {
  id: string
  label: string
  agentTools: AgentTool[]
  systemPrompt: string
} {
  return {
    id: SAMPLE_PLUGIN_ID,
    label: "Sample",
    agentTools: [],
    systemPrompt: "## Sample Plugin",
  }
}

