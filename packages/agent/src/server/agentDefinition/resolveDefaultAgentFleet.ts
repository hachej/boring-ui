import { resolve } from 'node:path'

import { createLogger } from '@hachej/boring-bash/server'

import { loadConfiguredAgentFleet, type DiscoveredAgentPackageDescriptor } from './loadConfiguredAgentFleet'
import { ErrorCode } from '../../shared/error-codes'
import type { AgentHostAgentSpec } from '../agent-host/types'

const logger = createLogger('agent-fleet-loader')

export const LEGACY_DEFAULT_AGENT_FLEET: readonly AgentHostAgentSpec[] = Object.freeze([
  Object.freeze({ agentTypeId: 'default', legacyDefault: true } as const),
])

export interface ResolveDefaultAgentFleetOptions {
  /**
   * Repository root used to resolve `.agents/{factory,skills}` when
   * `BORING_AGENT_FLEET=1` composes the fleet. Defaults to `process.cwd()`.
   */
  readonly repositoryRoot?: string
  /** Asset-manager scan results supplied by the workspace/CLI boot layer. */
  readonly discoveredPackages?: readonly DiscoveredAgentPackageDescriptor[]
  /**
   * Root of the workspace the `user` filesystem serves, or `null` when the
   * host resolves one per request. Explicit rather than defaulted, because it
   * is a DIFFERENT root from `repositoryRoot` in every multi-workspace host —
   * the two only coincide in the single-root dogfood/playground case.
   * Personas outside it are not published as openable instruction refs (see
   * `loadConfiguredAgentFleet`): a well-formed path the workbench cannot open
   * is worse than no link.
   */
  readonly workspaceRoot: string | null
  /** Overridable for tests; defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv
}

/**
 * `BORING_AGENT_FLEET=1` composes the config-driven production fleet
 * from boot-injected plugin scan descriptors plus `.agents/factory` under `repositoryRoot`
 * alongside the default agent; flag absent preserves the legacy
 * single-default-agent boot byte-identically. Shared by
 * `createWorkspaceAgentServer`, `createCoreWorkspaceAgentServer`, and the CLI
 * hub — one composition path for every production/CLI entry point.
 *
 * Invalid unseated discovery is diagnostic-only. Any invalid configured seat,
 * configured digest, conflict, or fleet file rejects boot: silently degrading
 * a flag-enabled host would publish a fleet different from its declared
 * roster. Flag-off behavior remains the legacy single-agent path.
 */
export async function resolveDefaultAgentFleet(
  options: ResolveDefaultAgentFleetOptions,
): Promise<readonly AgentHostAgentSpec[]> {
  const env = options.env ?? process.env
  if (env.BORING_AGENT_FLEET !== '1') return LEGACY_DEFAULT_AGENT_FLEET
  const root = options.repositoryRoot ?? process.cwd()
  if (!options.discoveredPackages) throw new Error('agent package discovery descriptors were not injected by the boot layer')
  const { agents: configuredAgents, diagnostics } = await loadConfiguredAgentFleet({
    discoveredPackages: options.discoveredPackages,
    workspaceRoot: options.workspaceRoot,
    fleetConfigPath: resolve(root, '.agents', 'factory', 'fleet.yaml'),
    policyPath: resolve(root, '.agents', 'factory', 'policy.yaml'),
    skillsRoot: resolve(root, '.agents', 'skills'),
    env,
  })
  for (const diagnostic of diagnostics) {
    // Not every diagnostic excludes a seat: an unpublishable instructions
    // path withholds one link while the seat boots and chats normally, and
    // an unseated discovered definition is merely inert.
    const excluded = diagnostic.code !== ErrorCode.enum.AGENT_FLEET_SEAT_INSTRUCTIONS_PATH_UNPUBLISHABLE
    logger.warn(excluded ? 'fleet package excluded or inert' : 'fleet seat instructions not linkable', {
      seat: diagnostic.seat,
      agentTypeId: diagnostic.agentTypeId,
      code: diagnostic.code,
      message: diagnostic.message,
    })
  }
  return Object.freeze([...LEGACY_DEFAULT_AGENT_FLEET, ...configuredAgents])
}
