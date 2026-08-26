import { resolve } from 'node:path'

import { createLogger } from '@hachej/boring-bash/server'

import { loadConfiguredAgentFleet, type DiscoveredAgentPackageDescriptor } from './loadConfiguredAgentFleet'
import { DEFAULT_AGENT_TYPE_ID, type AgentHostAgentSpec } from '../agent-host/types'

const logger = createLogger('agent-fleet-loader')

/**
 * A real, regular Agent used by hosts that do not opt into authored fleet
 * discovery. Platform host adapters preserve the established `default` ID's
 * plugin, skill, and transcript behavior without a separate pseudo-Agent type.
 */
export const DEFAULT_AGENT_FLEET: readonly AgentHostAgentSpec[] = Object.freeze([
  Object.freeze({
    agentTypeId: DEFAULT_AGENT_TYPE_ID,
    definition: Object.freeze({
      instructions: 'You are the default Agent for this workspace.',
      label: 'Agent',
      version: '1',
    }),
    provisioning: Object.freeze({ inheritSkillPaths: true }),
  }),
])

/** True only for the canonical built-in spec, before a host binds ordinary plugins. */
export function isBuiltInDefaultAgentSpec(agent: AgentHostAgentSpec): boolean {
  return agent === DEFAULT_AGENT_FLEET[0]
}

export interface ResolveDefaultAgentFleetOptions {
  /** Repository root used to resolve `.agents/{factory,skills}`. Defaults to `process.cwd()`. */
  readonly repositoryRoot?: string
  /** Asset-manager scan results supplied by the workspace/CLI boot layer. */
  readonly discoveredPackages?: readonly DiscoveredAgentPackageDescriptor[]
  /** Overridable for tests; defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv
}

/**
 * Resolves one deployment-static fleet for Core, Workspace, and CLI hosts.
 *
 * The built-in default is a regular configured Agent. When authored fleet
 * discovery is enabled it remains available alongside discovered seats so old
 * `default` session references stay routable. Invalid enabled fleet
 * composition fails boot; it never degrades to a pseudo-Agent.
 */
export async function resolveDefaultAgentFleet(
  options: ResolveDefaultAgentFleetOptions,
): Promise<readonly AgentHostAgentSpec[]> {
  const env = options.env ?? process.env
  if (env.BORING_AGENT_FLEET !== '1') return DEFAULT_AGENT_FLEET

  const root = options.repositoryRoot ?? process.cwd()
  if (!options.discoveredPackages) {
    throw new Error('agent package discovery descriptors were not injected by the boot layer')
  }

  const { agents: configuredAgents, diagnostics } = await loadConfiguredAgentFleet({
    discoveredPackages: options.discoveredPackages,
    fleetConfigPath: resolve(root, '.agents', 'factory', 'fleet.yaml'),
    policyPath: resolve(root, '.agents', 'factory', 'policy.yaml'),
    skillsRoot: resolve(root, '.agents', 'skills'),
    env,
  })
  for (const diagnostic of diagnostics) {
    logger.warn('fleet package excluded or inert', {
      seat: diagnostic.seat,
      agentTypeId: diagnostic.agentTypeId,
      code: diagnostic.code,
      message: diagnostic.message,
    })
  }
  return Object.freeze([...DEFAULT_AGENT_FLEET, ...configuredAgents])
}
