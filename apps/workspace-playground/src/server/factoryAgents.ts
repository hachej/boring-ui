import { resolve } from 'node:path'

import { loadConfiguredAgentFleet, type AgentHostAgentSpec } from '@hachej/boring-agent/server'
import { discoverRepositoryAgentPackages } from '@hachej/boring-workspace/server'

export type BoringFactoryRole = 'concierge' | 'triage' | 'steward' | 'worker' | 'reviewer'

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../../..')
const FLEET_CONFIG_PATH = resolve(REPOSITORY_ROOT, '.agents', 'factory', 'fleet.yaml')
const POLICY_PATH = resolve(REPOSITORY_ROOT, '.agents', 'factory', 'policy.yaml')

export interface LoadBoringFactoryAgentsOptions {
  readonly preferredModels?: Partial<Record<BoringFactoryRole, string>>
  /** Overridable for tests; defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv
}

/**
 * Repository-only dogfood fleet, now a thin call to the production loader
 * (gh-1106 slice 3). Kept for the playground's dev server and its existing
 * `VITE_BORING_FACTORY_AGENTS=1` toggle; production/CLI-hub composition uses
 * `loadConfiguredAgentFleet` directly behind `BORING_AGENT_FLEET=1`.
 */
export async function loadBoringFactoryAgents(
  options: LoadBoringFactoryAgentsOptions = {},
): Promise<readonly AgentHostAgentSpec[]> {
  const { agents, diagnostics } = await loadConfiguredAgentFleet({
    discoveredPackages: await discoverRepositoryAgentPackages(REPOSITORY_ROOT),
    fleetConfigPath: FLEET_CONFIG_PATH,
    policyPath: POLICY_PATH,
    skillsRoot: resolve(REPOSITORY_ROOT, '.agents', 'skills'),
    ...(options.env ? { env: options.env } : {}),
  })
  if (diagnostics.length > 0) {
    throw Object.assign(
      new Error(`fleet loader excluded seat(s): ${diagnostics.map((d) => `${d.seat} (${d.code})`).join(', ')}`),
      { name: 'TrustedAgentCompositionError', diagnostics },
    )
  }
  if (!options.preferredModels) return agents
  return agents.map((agent) => {
    if ('legacyDefault' in agent) return agent
    const role = agent.agentTypeId.replace(/^boring-/, '') as BoringFactoryRole
    const preferred = options.preferredModels?.[role]
    return preferred ? { ...agent, model: { ...agent.model, preferred } } : agent
  })
}
