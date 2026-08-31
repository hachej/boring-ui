import { AgentGatewayError, AgentGatewayErrorCode } from '../../shared/index'
import { SandboxLeaseServiceRegistry } from '../sandbox/leases/sandboxLeaseServiceRegistry'
import { assertSandboxToolCatalogAuthority } from '../tools/sandboxTargeting'
import type { ResolvedAgentRuntimeScope } from './types'

interface SandboxBoundRuntimeBinding {
  readonly agentTypeId: string
  readonly workspaceScopeId: string
  readonly scope: ResolvedAgentRuntimeScope
}

/** Capability identity is exact: absence cannot reuse a sandbox-capable binding. */
export function matchesSandboxToolCapability(
  binding: Pick<SandboxBoundRuntimeBinding, 'scope'>,
  sandboxToolsDigest: string | undefined,
): boolean {
  return binding.scope.sandboxTools?.digest === sandboxToolsDigest
}

export class HostSandboxCapabilities {
  private readonly services = new SandboxLeaseServiceRegistry()

  register(scope: ResolvedAgentRuntimeScope): void {
    assertSandboxToolCatalogAuthority(scope)
    if (scope.sandboxTools) this.services.register(scope.sandboxTools)
  }

  bindingKey(agentTypeId: string, workspaceScopeId: string, scope: ResolvedAgentRuntimeScope): string {
    return JSON.stringify([
      agentTypeId,
      workspaceScopeId,
      scope.identity,
      scope.environment.provisioningFingerprint,
      scope.physicalBindingIdentity ?? scope.identity,
      scope.sandboxTools?.digest ?? null,
    ])
  }

  currentBindingKey(agentTypeId: string, workspaceScopeId: string, scope: ResolvedAgentRuntimeScope): string {
    return JSON.stringify([
      agentTypeId,
      workspaceScopeId,
      scope.physicalBindingIdentity ?? scope.identity,
      scope.sandboxTools?.digest ?? null,
    ])
  }

  assertBindingMatches(binding: SandboxBoundRuntimeBinding, scope: ResolvedAgentRuntimeScope): void {
    const currentPhysicalIdentity = binding.scope.physicalBindingIdentity ?? binding.scope.identity
    const candidatePhysicalIdentity = scope.physicalBindingIdentity ?? scope.identity
    if (
      binding.scope.identity !== scope.identity
      || binding.scope.environment.provisioningFingerprint !== scope.environment.provisioningFingerprint
      || currentPhysicalIdentity !== candidatePhysicalIdentity
      || !matchesSandboxToolCapability(binding, scope.sandboxTools?.digest)
    ) {
      throw new AgentGatewayError(
        AgentGatewayErrorCode.AGENT_RUNTIME_RESTART_REQUIRED,
        'Agent runtime identity changed; process restart is required',
      )
    }
  }

  findPublished<T extends SandboxBoundRuntimeBinding>(
    bindings: Iterable<T>,
    input: {
      readonly agentTypeId: string
      readonly workspaceScopeId: string
      readonly physicalBindingIdentity: string
      readonly bindingIdentity?: string
      readonly provisioningFingerprint?: string
      readonly sandboxToolsDigest?: string
    },
  ): T | undefined {
    const candidates = [...bindings].filter((binding) =>
      binding.agentTypeId === input.agentTypeId
      && binding.workspaceScopeId === input.workspaceScopeId
      && matchesSandboxToolCapability(binding, input.sandboxToolsDigest)
      && (!input.bindingIdentity || binding.scope.identity === input.bindingIdentity)
      && (!input.provisioningFingerprint
        || binding.scope.environment.provisioningFingerprint === input.provisioningFingerprint))
    const matches = candidates.filter((binding) =>
      (binding.scope.physicalBindingIdentity ?? binding.scope.identity) === input.physicalBindingIdentity)
    if (matches.length === 1) return matches[0]
    if (candidates.length === 1) {
      throw new AgentGatewayError(
        AgentGatewayErrorCode.AGENT_RUNTIME_RESTART_REQUIRED,
        'Agent runtime identity changed; process restart is required',
      )
    }
    return undefined
  }

  disposeUntil(deadline: number): Promise<readonly PromiseSettledResult<void>[]> {
    return this.services.disposeUntil(deadline)
  }
}
