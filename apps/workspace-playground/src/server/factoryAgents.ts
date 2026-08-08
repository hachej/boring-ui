import { resolve } from 'node:path'

import { loadConfiguredAgentFleet, type AgentHostAgentSpec } from '@hachej/boring-agent/server'

export type BoringFactoryRole = 'concierge' | 'triage' | 'steward' | 'worker' | 'reviewer'

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../../..')
const PERSONAS_DIR = resolve(REPOSITORY_ROOT, '.agents', 'personas')
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
    // The playground serves this repository as the workspace, so the fleet
    // repository root and the served workspace root genuinely coincide here.
    workspaceRoot: REPOSITORY_ROOT,
    personasDir: PERSONAS_DIR,
    fleetConfigPath: FLEET_CONFIG_PATH,
    policyPath: POLICY_PATH,
    ...(options.env ? { env: options.env } : {}),
  })
  // Only diagnostics that actually EXCLUDE a seat are fatal here. An
  // unpublishable instructions path withholds one link; failing boot over it
  // would be a worse outcome than the missing row it reports.
  const excluding = diagnostics.filter((d) => d.code !== 'AGENT_FLEET_SEAT_INSTRUCTIONS_PATH_UNPUBLISHABLE')
  if (excluding.length > 0) {
    throw Object.assign(
      new Error(`fleet loader excluded seat(s): ${excluding.map((d) => `${d.seat} (${d.code})`).join(', ')}`),
      { name: 'TrustedAgentCompositionError', diagnostics: excluding },
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
