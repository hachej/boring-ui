import type { FastifyPluginAsync } from 'fastify'
import type { AuthorizedAgentScope, VerifiedAgentScopeClaim } from '../shared/gateway/types'
import type { CompatibilityResolvedAgentRuntimeScope } from './agent-host/buildAgentComposition'
import { createAgentHost } from './agent-host/createAgentHost'
import { createCompatibilityScopeIssuer } from './agent-host/compatibilityScope'
import { getEnv } from './config/env'
import { autoDetectMode, resolveMode } from './runtime/resolveMode'
import {
  createAgentHostLegacyRoutePolicy,
  type RegisterAgentRoutesOptions,
} from './agentHostLegacyRoutePolicy'

export type {
  AgentHostLegacyRoutePolicyOptions,
  AgentHostLegacyRouteScopePolicy,
  PrebuiltAgentHostRoutePolicy,
  RegisterAgentRoutesOptions,
} from './agentHostLegacyRoutePolicy'

/**
 * Compatibility wrapper for legacy embedding callers.
 *
 * It normalizes legacy construction inputs, creates or reuses exactly one Host,
 * and delegates the complete route profile through CreatedAgentHost.registerRoutes().
 */
export const registerAgentRoutes: FastifyPluginAsync<RegisterAgentRoutesOptions> = async (app, opts) => {
  const resolvedMode = opts.runtimeModeAdapter?.id ?? opts.mode ?? autoDetectMode()
  const runtimeModeAdapter = opts.runtimeModeAdapter ?? resolveMode(resolvedMode)
  const runtimeHost = opts.runtimeHost ?? runtimeModeAdapter.runtimeHost
  const compatibilityIssuer = opts.agentHost
    ? undefined
    : createCompatibilityScopeIssuer<CompatibilityResolvedAgentRuntimeScope>()
  const created = opts.agentHost?.created ?? await createAgentHost({
    agents: [{ agentTypeId: 'default', legacyDefault: true }],
    fleetCompiler: { async compile({ agents }) { return agents } },
    hostId: 'legacy-register-agent-routes',
    scopeVerifier: compatibilityIssuer!.verifier,
    runtimeModeAdapter,
    runtimeHost,
    sessionRoot: opts.sessionRoot,
    telemetry: opts.telemetry,
    metering: opts.metering,
    harnessFactory: opts.harnessFactory,
    ...(opts.admitEffect
      ? {
          effectAdmission: {
            async admit() {
              return { type: 'accepted' as const, admissionReceipt: 'legacy-at-most-once' }
            },
          },
        }
      : {}),
    async resolveRuntimeScope({ scope }) {
      return compatibilityIssuer!.context(scope)
    },
  })
  const defaultAgentTypeId = opts.agentHost?.defaultAgentTypeId ?? 'default'
  const issueScope = (
    claim: VerifiedAgentScopeClaim,
    runtimeScope: CompatibilityResolvedAgentRuntimeScope,
  ): AuthorizedAgentScope => opts.agentHost
    ? opts.agentHost.issueScope({ claim, runtimeScope })
    : compatibilityIssuer!.issue(claim, runtimeScope)
  const {
    agentHost: _agentHost,
    ...legacyOptions
  } = opts
  const legacyRoutePolicy = createAgentHostLegacyRoutePolicy({
    ...legacyOptions,
    workspaceRoot: opts.workspaceRoot ?? process.cwd(),
    templatePath: opts.templatePath ?? getEnv('BORING_AGENT_TEMPLATE_PATH'),
    mode: resolvedMode,
    runtimeModeAdapter,
    runtimeHost,
  }, {
    issueScope: ({ claim, runtimeScope }) => issueScope(
      claim,
      runtimeScope as CompatibilityResolvedAgentRuntimeScope,
    ),
    gatewayUsesLegacyAdmission: !opts.agentHost,
  })

  await app.register(created.registerRoutes({
    defaultAgentTypeId,
    legacyRoutePolicy,
  }))
}
