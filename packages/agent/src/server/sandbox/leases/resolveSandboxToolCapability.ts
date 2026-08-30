import type { ResolvedSandboxToolCapability } from '../../agent-host/types'
import {
  createSandboxLeaseServiceFromProfileV1,
  normalizeSandboxLeaseProviderProfileV1,
  sandboxLeaseProviderProfileDigestV1,
} from './sandboxLeaseProfileIdentity'
import type { SandboxLeaseServiceRegistry } from './sandboxLeaseServiceRegistry'

/** Validates host profile authority and atomically binds it to one lifecycle-owned service. */
export async function resolveSandboxToolCapability(input: {
  capability: ResolvedSandboxToolCapability
  workspaceScopeId: string
  registry: SandboxLeaseServiceRegistry
}): Promise<ResolvedSandboxToolCapability> {
  const { capability, registry, workspaceScopeId } = input
  if (!capability.profile) {
    if (!capability.leases) throw new TypeError('sandbox capability requires a service or provider profile')
    registry.register({ digest: capability.digest, leases: capability.leases })
    return capability
  }
  if (capability.leases) {
    throw new TypeError('profile-backed sandbox capability cannot supply a preconstructed service')
  }
  const profile = normalizeSandboxLeaseProviderProfileV1(capability.profile, workspaceScopeId)
  const digest = sandboxLeaseProviderProfileDigestV1(profile.identity)
  if (digest !== capability.digest) throw new TypeError('sandbox lease profile digest does not match capability')
  const leases = await registry.getOrCreate(digest, async () =>
    await createSandboxLeaseServiceFromProfileV1({
      profile,
      verifiedWorkspaceScopeId: workspaceScopeId,
      expectedDigest: digest,
      registry,
    }))
  return Object.freeze({ digest, profile, leases })
}
