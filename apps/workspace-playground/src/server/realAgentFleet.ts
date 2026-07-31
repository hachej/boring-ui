import type { AgentHostAgentSpec } from "@hachej/boring-agent/server"

const DEFAULT_AGENT_MODEL = "openai-codex:gpt-5.4-mini"
const RESEARCHER_AGENT_MODEL = "openai-codex:gpt-5.3-codex-spark"

const PLAYGROUND_AGENT_PLUGINS = [
  { name: "ask-user" },
  { name: "diagram" },
  { name: "tasks" },
] as const

function configuredModel(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  return env[name]?.trim() || fallback
}

export function createWorkspacePlaygroundRealAgentFleet(env: NodeJS.ProcessEnv = process.env): {
  readonly agents: readonly AgentHostAgentSpec[]
  readonly defaultAgentTypeId: string
} | undefined {
  if (env.BORING_WORKSPACE_PLAYGROUND_REAL_FLEET !== "1") return undefined

  return {
    agents: [
      {
        agentTypeId: "default",
        definition: {
          label: "Default",
          instructions: 'You are the Default real workspace-playground agent. Start every final response with "DEFAULT_AGENT:".',
        },
        plugins: PLAYGROUND_AGENT_PLUGINS,
        model: {
          preferred: configuredModel(
            env,
            "BORING_WORKSPACE_PLAYGROUND_DEFAULT_MODEL",
            DEFAULT_AGENT_MODEL,
          ),
        },
      },
      {
        agentTypeId: "researcher",
        definition: {
          label: "Researcher",
          instructions: 'You are the Researcher real workspace-playground agent. Start every final response with "RESEARCHER_AGENT:".',
        },
        plugins: PLAYGROUND_AGENT_PLUGINS,
        model: {
          preferred: configuredModel(
            env,
            "BORING_WORKSPACE_PLAYGROUND_RESEARCHER_MODEL",
            RESEARCHER_AGENT_MODEL,
          ),
        },
      },
    ],
    defaultAgentTypeId: "default",
  }
}
