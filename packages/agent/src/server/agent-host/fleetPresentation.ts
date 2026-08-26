/**
 * How the legacy `default` runtime presents itself in agent listings.
 *
 * The `default` agentTypeId is never removed from a composed fleet: existing
 * sessions are bound to it and Decision 28 retains session/history
 * compatibility, so dropping it from the compiled fleet would strand chat
 * history. What gh-1296 fixes is the *presentation*: alongside a configured
 * fleet the fallback used to advertise itself as an authored seat labelled
 * `Agent`, sitting above the real seats.
 *
 * So listings keep the entry — every caller can still address it, and clients
 * still enumerate its sessions — but mark it `legacy` and label it `default`,
 * which is what it is. Clients hide a legacy entry that owns no sessions from
 * seat chrome; one that owns sessions stays visible so its chats are reachable.
 *
 * With no configured fleet (the legacy single-agent boot) nothing changes: the
 * lone default agent is the workspace's agent and keeps the `Agent` label.
 */

/** True once at least one configured (authored) Agent shares the fleet. */
export function fleetHasConfiguredAgents(agents: readonly object[]): boolean {
  return agents.some((agent) => !('legacyDefault' in agent))
}

/** Listing identity of the legacy default entry for a fleet of either shape. */
export function legacyDefaultPresentation(
  configuredFleet: boolean,
): { readonly label: string; readonly legacy?: true } {
  return configuredFleet ? { label: 'default', legacy: true } : { label: 'Agent' }
}
