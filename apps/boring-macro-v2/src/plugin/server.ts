"use server"
import type { AgentTool } from "@boring/agent/shared"

interface ServerPlugin {
  id: string
  label?: string
  systemPrompt?: string
  agentTools?: AgentTool[]
}

export function makeMacroServerPlugin(tools: AgentTool[]): ServerPlugin {
  return {
    id: "boring-macro",
    label: "Macro",
    agentTools: tools,
  }
}
