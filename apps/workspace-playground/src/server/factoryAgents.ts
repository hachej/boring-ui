import { resolve } from 'node:path'

import { resolveDefaultAgentFleet, type AgentHostAgentSpec } from '@hachej/boring-agent/server'
import { discoverRepositoryAgentPackages } from '@hachej/boring-workspace/server'

/**
 * A seat name as it appears in `.agents/factory/fleet.yaml` — the composed
 * `agentTypeId` minus its `boring-` prefix.
 *
 * Deliberately NOT a union of seat literals. The roster is configuration,
 * composed at boot by `loadConfiguredAgentFleet` from `.agents/personas` +
 * `fleet.yaml`; a hand-maintained union here would be a second copy of it that
 * silently drifts every time a seat is added or renamed. This file must never
 * be able to disagree with the config about who the seats are (gh-1187 S0).
 */
export type BoringFactoryRole = string

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../../..')

export interface LoadBoringFactoryAgentsOptions {
  readonly preferredModels?: Partial<Record<BoringFactoryRole, string>>
  /** Overridable for tests; defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv
}

/**
 * Repository-only dogfood fleet, resolved through the same additive path as
 * production hosts: one visible platform default plus every authored seat.
 * The explicit playground server option then receives that already-complete
 * fleet; explicit caller-owned fleets elsewhere remain isolated.
 */
export async function loadBoringFactoryAgents(
  options: LoadBoringFactoryAgentsOptions,
): Promise<readonly AgentHostAgentSpec[]> {
  const agents = await resolveDefaultAgentFleet({
    repositoryRoot: REPOSITORY_ROOT,
    discoveredPackages: await discoverRepositoryAgentPackages(REPOSITORY_ROOT),
    env: {
      ...(options.env ?? process.env),
      BORING_AGENT_FLEET: '1',
    },
  })
  if (!options.preferredModels) return agents
  return agents.map((agent) => {
    const role = agent.agentTypeId.replace(/^boring-/, '')
    const preferred = options.preferredModels?.[role]
    return preferred ? { ...agent, model: { ...agent.model, preferred } } : agent
  })
}
