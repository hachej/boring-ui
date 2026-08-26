import { resolve } from 'node:path'

import { createLogger } from '@hachej/boring-bash/server'

import { loadConfiguredAgentFleet, type DiscoveredAgentPackageDescriptor } from './loadConfiguredAgentFleet'
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
 * Fails closed at two levels:
 *  - Per seat: `loadConfiguredAgentFleet` excludes an individual invalid
 *    persona/skill with a stable diagnostic; the remaining seats still boot
 *    (see its own docstring).
 *  - Whole fleet: a missing/malformed `fleet.yaml` or `policy.yaml` would
 *    otherwise throw `FleetConfigError` out of the boot path. That throw is
 *    preserved for direct/programmatic callers of `loadConfiguredAgentFleet`
 *    (e.g. the playground, tests), but this boot-seam wrapper catches it and
 *    degrades to the legacy default-agent-only fleet plus a logged
 *    diagnostic — a container with the flag on and no `.agents/` tree must
 *    still boot.
 */
export async function resolveDefaultAgentFleet(
  options: ResolveDefaultAgentFleetOptions,
): Promise<readonly AgentHostAgentSpec[]> {
  const env = options.env ?? process.env
  if (env.BORING_AGENT_FLEET !== '1') return LEGACY_DEFAULT_AGENT_FLEET
  const root = options.repositoryRoot ?? process.cwd()
  try {
    if (!options.discoveredPackages) throw new Error('agent package discovery descriptors were not injected by the boot layer')
    const { agents: configuredAgents, diagnostics } = await loadConfiguredAgentFleet({
      discoveredPackages: options.discoveredPackages,
      fleetConfigPath: resolve(root, '.agents', 'factory', 'fleet.yaml'),
      policyPath: resolve(root, '.agents', 'factory', 'policy.yaml'),
      skillsRoot: resolve(root, '.agents', 'skills'),
      env,
    })
    for (const diagnostic of diagnostics) {
      // Not every diagnostic excludes a seat: an unseated discovered
      // definition is merely inert. Instruction-ref publication is no longer
      // decided here — it is a per-request concern (gh-1189).
      logger.warn('fleet package excluded or inert', {
        seat: diagnostic.seat,
        agentTypeId: diagnostic.agentTypeId,
        code: diagnostic.code,
        message: diagnostic.message,
      })
    }
    return Object.freeze([...LEGACY_DEFAULT_AGENT_FLEET, ...configuredAgents])
  } catch (error) {
    logger.error('fleet composition failed at boot; degrading to the legacy default agent', {
      error: error instanceof Error ? error.message : String(error),
      code: (error as { code?: unknown })?.code,
    })
    return LEGACY_DEFAULT_AGENT_FLEET
  }
}
