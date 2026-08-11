import type { AgentHostAgentSpec } from "@hachej/boring-agent/server"

function capabilityTool(name: string) {
  return {
    name,
    description: `${name} is available only to its scripted playground agent.`,
    parameters: { type: "object", properties: {} },
    async execute() {
      return { content: [{ type: "text" as const, text: name }] }
    },
  }
}

export const SCRIPTED_TWO_AGENT_CAPABILITY_PLUGINS = [
  {
    id: "scripted-alpha-capability",
    contentDigest: "scripted-alpha-capability-v1",
    agentTools: [capabilityTool("alpha_capability")],
  },
  {
    id: "scripted-beta-capability",
    contentDigest: "scripted-beta-capability-v1",
    agentTools: [capabilityTool("beta_capability")],
  },
]

export const SCRIPTED_TWO_AGENT_FLEET = [
  {
    agentTypeId: "alpha",
    definition: {
      label: "Alpha",
      instructions: "You are the Alpha scripted workspace-playground agent.",
    },
    model: { preferred: "scripted:alpha-model" },
    plugins: [{ name: "scripted-alpha-capability" }],
  },
  {
    agentTypeId: "beta",
    definition: {
      label: "Beta",
      instructions: "You are the Beta scripted workspace-playground agent.",
    },
    model: { preferred: "scripted:beta-model" },
    plugins: [{ name: "scripted-beta-capability" }],
  },
] as const satisfies readonly AgentHostAgentSpec[]

export const SCRIPTED_TWO_AGENT_DEFAULT = "alpha"

export const SCRIPTED_ONE_AGENT = [SCRIPTED_TWO_AGENT_FLEET[0]] as const satisfies readonly AgentHostAgentSpec[]
export const SCRIPTED_ONE_AGENT_CAPABILITY_PLUGINS = [SCRIPTED_TWO_AGENT_CAPABILITY_PLUGINS[0]] as const
