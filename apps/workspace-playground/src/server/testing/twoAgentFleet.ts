import type { AgentHostAgentSpec } from "@hachej/boring-agent/server"

export const SCRIPTED_TWO_AGENT_FLEET = [
  {
    agentTypeId: "alpha",
    definition: {
      label: "Alpha",
      instructions: "You are the Alpha scripted workspace-playground agent.",
    },
  },
  {
    agentTypeId: "beta",
    definition: {
      label: "Beta",
      instructions: "You are the Beta scripted workspace-playground agent.",
    },
  },
] as const satisfies readonly AgentHostAgentSpec[]

export const SCRIPTED_TWO_AGENT_DEFAULT = "alpha"
