import { shortAgentLabel } from "./plugin-tabs/AppLeftPaneAgentCards"

/**
 * Agent labels for the chat headers, keyed by agentTypeId.
 *
 * Returns null when the workspace has fewer than two Agents: a lone Agent
 * disambiguates nothing, so every chat header degrades to title-only exactly
 * as it was before. Callers spread the lookup result conditionally, so a
 * missing entry is simply no label.
 */
export function chatPaneAgentLabels(
  agents: readonly { agentTypeId: string; label: string }[],
): Map<string, string> | null {
  if (agents.length < 2) return null
  return new Map(agents.map((agent) => [agent.agentTypeId, shortAgentLabel(agent.label)]))
}
