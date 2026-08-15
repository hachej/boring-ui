/**
 * Keep the legacy default runtime in composed fleets for compatibility, but do
 * not present it as an authored seat when at least one configured Agent exists.
 */
export function presentedAgentFleet<T extends object>(agents: readonly T[]): readonly T[] {
  return agents.some((agent) => !('legacyDefault' in agent))
    ? agents.filter((agent) => !('legacyDefault' in agent))
    : agents
}
