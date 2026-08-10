import { resolve } from 'node:path'

import { loadConfiguredAgentFleet, type AgentHostAgentSpec } from '@hachej/boring-agent/server'
import { discoverRepositoryAgentPackages } from '@hachej/boring-workspace/server'

export type BoringFactoryRole = 'concierge' | 'triage' | 'steward' | 'worker' | 'reviewer'

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../../..')
const FLEET_CONFIG_PATH = resolve(REPOSITORY_ROOT, '.agents', 'factory', 'fleet.yaml')
const POLICY_PATH = resolve(REPOSITORY_ROOT, '.agents', 'factory', 'policy.yaml')

export interface LoadBoringFactoryAgentsOptions {
  /**
   * The root the playground's `user` filesystem actually serves — i.e. the
   * exact value `startPlaygroundServer` hands to `createWorkspaceAgentServer`
   * (`BORING_AGENT_WORKSPACE_ROOT ?? WORKSPACE_DIR`), never the repository
   * root the fleet is composed FROM.
   *
   * Required, and required to be passed in rather than recomputed here,
   * because the two roots are independent: whoever decides what the client
   * reads through is the only caller that can honestly answer whether a
   * persona path is reachable. Getting this wrong does not fail loudly at
   * boot — it publishes a well-formed ref that 404s on click.
   */
  readonly workspaceRoot: string
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
    // The SERVED root, not `REPOSITORY_ROOT`. The playground composes the
    // fleet from this repository's `.agents/` tree but serves
    // `apps/workspace-playground/workspace` (or
    // `BORING_AGENT_WORKSPACE_ROOT`) as the `user` filesystem, so the two
    // roots differ by default and the loader must gate against the one the
    // client reads through. Run the playground with
    // `BORING_AGENT_WORKSPACE_ROOT=<repo root>` to make persona instructions
    // genuinely reachable and their links appear.
    workspaceRoot: options.workspaceRoot,
    fleetConfigPath: FLEET_CONFIG_PATH,
    policyPath: POLICY_PATH,
    skillsRoot: resolve(REPOSITORY_ROOT, '.agents', 'skills'),
    ...(options.env ? { env: options.env } : {}),
  })
  // Only diagnostics that actually EXCLUDE a seat are fatal here. An
  // unpublishable instructions path withholds one link, and an unseated
  // discovered definition is merely inert; failing boot over either would be
  // a worse outcome than the missing row it reports.
  const excluding = diagnostics.filter(
    (d) => d.code !== 'AGENT_FLEET_SEAT_INSTRUCTIONS_PATH_UNPUBLISHABLE' && d.code !== 'AGENT_DEFINITION_UNSEATED',
  )
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
    const role = agent.agentTypeId.replace(/^boring-/, '') as BoringFactoryRole
    const preferred = options.preferredModels?.[role]
    return preferred ? { ...agent, model: { ...agent.model, preferred } } : agent
  })
}
