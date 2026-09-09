/** Keep the scripted server roster and its tests aligned on one default id. */
export const SCRIPTED_DEFAULT_AGENT_TYPE_ID = "alpha"

interface PlaygroundAgentSeat {
  readonly agentTypeId: string
}

/** Resolve the playground default from the roster that was actually loaded. */
export function resolvePlaygroundDefaultAgentTypeId(
  agents: readonly PlaygroundAgentSeat[],
): string {
  const agentTypeId = agents[0]?.agentTypeId.trim()
  if (agentTypeId) return agentTypeId
  throw Object.assign(new Error("playground agent roster must include at least one seat"), {
    code: "PLAYGROUND_AGENT_ROSTER_EMPTY",
  })
}
