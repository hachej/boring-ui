import type {
  AgentHostLegacyRoutePolicy,
  AgentHostLegacyRoutePolicyMountInput,
} from './agent-host/types'
import type {
  AgentHostLegacyRoutePolicyOptions,
  AgentHostLegacyRouteScopePolicy,
} from './agentHostLegacyRouteOptions'
import { mountAgentHostLegacyRouteRuntime } from './agentHostLegacyRouteRuntime'

export type {
  AgentHostLegacyRoutePolicyOptions,
  AgentHostLegacyRouteScopePolicy,
  PrebuiltAgentHostRoutePolicy,
  RegisterAgentRoutesOptions,
} from './agentHostLegacyRouteOptions'

/** Normalize legacy options into the nested Host projection seam. */
export function createAgentHostLegacyRoutePolicy(
  options: AgentHostLegacyRoutePolicyOptions,
  scopePolicy: AgentHostLegacyRouteScopePolicy,
): AgentHostLegacyRoutePolicy {
  const normalizedOptions = { ...options }
  return Object.freeze({
    async mount(input: AgentHostLegacyRoutePolicyMountInput) {
      return await mountAgentHostLegacyRouteRuntime(input.app, normalizedOptions, input, scopePolicy)
    },
  })
}
