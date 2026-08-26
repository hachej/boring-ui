import { resolve } from 'node:path'

import { loadConfiguredAgentFleet, type AgentHostAgentSpec } from '@hachej/boring-agent/server'
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
  options: LoadBoringFactoryAgentsOptions,
): Promise<readonly AgentHostAgentSpec[]> {
  const { agents, diagnostics } = await loadConfiguredAgentFleet({
    discoveredPackages: await discoverRepositoryAgentPackages(REPOSITORY_ROOT),
    // The loader no longer takes a served root: personas are recorded as
    // absolute sources and addressed per request against whatever root that
    // request is served from (gh-1189). The playground serves
    // `apps/workspace-playground/workspace` (or `BORING_AGENT_WORKSPACE_ROOT`)
    // while composing from this repository's `.agents/` tree, so run it with
    // `BORING_AGENT_WORKSPACE_ROOT=<repo root>` to make persona instructions
    // genuinely reachable and their links appear.
    fleetConfigPath: FLEET_CONFIG_PATH,
    policyPath: POLICY_PATH,
    skillsRoot: resolve(REPOSITORY_ROOT, '.agents', 'skills'),
    ...(options.env ? { env: options.env } : {}),
  })
  // Only diagnostics that actually EXCLUDE a seat are fatal here. An unseated
  // discovered definition is merely inert; failing boot over it would be a
  // worse outcome than the missing row it reports.
  const excluding = diagnostics.filter((d) => d.code !== 'AGENT_DEFINITION_UNSEATED')
  for (const diagnostic of diagnostics) {
    if (excluding.includes(diagnostic)) continue
    // Withholding a link is correct but must never be silent: without this the
    // only evidence of a mis-rooted playground is a row that isn't there.
    console.warn(
      `[workspace-playground] ${diagnostic.seat}: ${diagnostic.code}: ${diagnostic.message}`,
    )
  }
  if (excluding.length > 0) {
    throw Object.assign(
      new Error(`fleet loader excluded seat(s): ${excluding.map((d) => `${d.seat} (${d.code})`).join(', ')}`),
      { name: 'TrustedAgentCompositionError', diagnostics: excluding },
    )
  }
  if (!options.preferredModels) return agents
  return agents.map((agent) => {
    if ('legacyDefault' in agent) return agent
    const role = agent.agentTypeId.replace(/^boring-/, '')
    const preferred = options.preferredModels?.[role]
    return preferred ? { ...agent, model: { ...agent.model, preferred } } : agent
  })
}
