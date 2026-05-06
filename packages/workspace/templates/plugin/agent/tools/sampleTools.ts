import type { AgentTool } from "@boring/workspace"
import { SAMPLE_PLUGIN_ID } from "../../shared/constants"

/**
 * Agent tools run inside the pi/sandbox runtime.
 * They are imported by server/index.ts and registered via defineServerPlugin().
 * Do not add Node.js server infrastructure here — keep to pure tool logic.
 */
export function createSampleTools(): AgentTool[] {
  return []
}
