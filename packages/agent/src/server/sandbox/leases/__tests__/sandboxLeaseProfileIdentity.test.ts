import { describe, expect, it, vi } from 'vitest'

import type { DisposableSandboxProviderV1, SandboxProviderV1 } from '@hachej/boring-sandbox/shared'
import {
  SANDBOX_LEASE_PROVIDER_PROFILE_VERSION_V1,
  createSandboxLeaseServiceFromProfileV1,
  normalizeSandboxLeaseProviderProfileV1,
  sandboxLeaseProviderProfileDigestV1,
  type SandboxLeaseProviderProfileV1,
} from '../sandboxLeaseProfileIdentity'

const sha = `sha256:${'a'.repeat(64)}` as const

function disposableProvider(providerConfigDigest: `sha256:${string}` = sha): DisposableSandboxProviderV1 {
  return {
    contractVersion: 'boring-sandbox.provider.v1',
    providerId: 'direct',
    capabilities: {} as never,
    disposableProfile: {
      contractVersion: 'boring-sandbox.disposable-provider.v1',
      resume: false,
      publishedCleanupOwner: 'returned-pair',
      ambiguousCreate: 'correlated-reconciliation',
      providerConfigDigest,
    },
    resolveRuntimeRoot: (context) => context.workspaceRoot,
    async create() { throw new Error('not used') },
  }
}

function profile(scope = 'workspace-a'): SandboxLeaseProviderProfileV1 {
  const provider = disposableProvider()
  return {
    providerFactory: () => provider,
    identity: {
      contractVersion: SANDBOX_LEASE_PROVIDER_PROFILE_VERSION_V1,
      workspaceScopeId: scope,
      placementIdentity: 'local-trusted',
      providerWorkspaceId: 'physical-workspace-a',
      leaseRoot: '/host/sandbox-leases',
      providerId: 'direct',
      providerConfigDigest: sha,
      credentialVersionRefs: ['credential-b@2', 'credential-a@1', 'credential-a@1'],
      ttlMs: 60_000,
      reapIntervalMs: 10_000,
      drainTimeoutMs: 5_000,
      maxActiveLeasesPerOwner: 2,
      maxActiveLeasesTotal: 4,
    },
  }
}

describe('sandbox lease provider profile identity', () => {
  it('normalizes serializable identity and produces a stable digest', () => {
    const normalized = normalizeSandboxLeaseProviderProfileV1(profile(), 'workspace-a')
    expect(normalized.identity.credentialVersionRefs).toEqual(['credential-a@1', 'credential-b@2'])
    expect(sandboxLeaseProviderProfileDigestV1(normalized.identity)).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(sandboxLeaseProviderProfileDigestV1(normalized.identity)).toBe(
      sandboxLeaseProviderProfileDigestV1(normalized.identity),
    )
  })

  it('rejects unknown identity fields and provider configuration aliases', async () => {
    const value = profile()
    expect(() => normalizeSandboxLeaseProviderProfileV1({
      ...value,
      identity: { ...value.identity, hiddenAuthority: 'unexpected' } as typeof value.identity,
    }, 'workspace-a')).toThrow('unsupported fields')

    const mismatched = {
      ...value,
      identity: { ...value.identity, providerConfigDigest: `sha256:${'b'.repeat(64)}` as const },
    }
    await expect(createSandboxLeaseServiceFromProfileV1({
      profile: mismatched,
      verifiedWorkspaceScopeId: 'workspace-a',
      expectedDigest: sandboxLeaseProviderProfileDigestV1(
        normalizeSandboxLeaseProviderProfileV1(mismatched, 'workspace-a').identity,
      ),
    })).rejects.toThrow('registration does not match trusted profile')
  })

  it('constructs a service bound to the complete profile identity', async () => {
    const normalized = normalizeSandboxLeaseProviderProfileV1(profile(), 'workspace-a')
    const digest = sandboxLeaseProviderProfileDigestV1(normalized.identity)
    const service = await createSandboxLeaseServiceFromProfileV1({
      profile: normalized,
      verifiedWorkspaceScopeId: 'workspace-a',
      expectedDigest: digest,
    })
    const provider = await normalized.providerFactory()
    expect(() => service.assertProfileBinding({
      digest,
      provider,
      workspaceRoot: normalized.identity.leaseRoot,
      providerWorkspaceId: normalized.identity.providerWorkspaceId,
      ttlMs: normalized.identity.ttlMs,
      reapIntervalMs: normalized.identity.reapIntervalMs,
      drainTimeoutMs: normalized.identity.drainTimeoutMs,
      maxActiveLeasesPerOwner: normalized.identity.maxActiveLeasesPerOwner,
      maxActiveLeasesTotal: normalized.identity.maxActiveLeasesTotal,
    })).not.toThrow()
    expect(() => service.assertProfileBinding({
      digest, provider,
      workspaceRoot: '/other-root',
      providerWorkspaceId: normalized.identity.providerWorkspaceId,
      ttlMs: normalized.identity.ttlMs,
      reapIntervalMs: normalized.identity.reapIntervalMs,
      drainTimeoutMs: normalized.identity.drainTimeoutMs,
      maxActiveLeasesPerOwner: normalized.identity.maxActiveLeasesPerOwner,
      maxActiveLeasesTotal: normalized.identity.maxActiveLeasesTotal,
    })).toThrow('does not match')
    await service.dispose()
  })

  it('validates constructor intervals before provider effects and closes on construction failure', async () => {
    const value = profile()
    const providerFactory = vi.fn(value.providerFactory)
    const invalid = { ...value, providerFactory, identity: { ...value.identity, reapIntervalMs: 999 } }
    await expect(createSandboxLeaseServiceFromProfileV1({
      profile: invalid, verifiedWorkspaceScopeId: 'workspace-a',
      expectedDigest: sandboxLeaseProviderProfileDigestV1(invalid.identity),
    })).rejects.toThrow('outside the supported interval')
    expect(providerFactory).not.toHaveBeenCalled()

    const close = vi.fn(async () => { throw new Error('close failed') })
    const valid = { ...value, providerFactory: () => ({ ...disposableProvider(), close }) }
    const interval = vi.spyOn(globalThis, 'setInterval').mockImplementationOnce(() => { throw new Error('timer failed') })
    try {
      const failure = await createSandboxLeaseServiceFromProfileV1({
        profile: valid, verifiedWorkspaceScopeId: 'workspace-a',
        expectedDigest: sandboxLeaseProviderProfileDigestV1(
          normalizeSandboxLeaseProviderProfileV1(valid, 'workspace-a').identity,
        ),
      }).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(AggregateError)
      expect((failure as AggregateError).errors.map(String)).toEqual([
        'Error: timer failed', 'Error: close failed',
      ])
      expect(close).toHaveBeenCalledOnce()
    } finally { interval.mockRestore() }
  })

  it('rejects caller-asserted generic template aliases', () => {
    const value = profile()
    expect(() => normalizeSandboxLeaseProviderProfileV1({
      ...value, templatePath: '/templates/a',
    } as SandboxLeaseProviderProfileV1, 'workspace-a')).toThrow('unsupported fields')
    expect(() => normalizeSandboxLeaseProviderProfileV1({
      ...value,
      identity: { ...value.identity, templateFingerprint: sha },
    } as SandboxLeaseProviderProfileV1, 'workspace-a')).toThrow('unsupported fields')
  })

  it('rejects cross-workspace reuse before provider use', () => {
    expect(() => normalizeSandboxLeaseProviderProfileV1(profile('workspace-a'), 'workspace-b'))
      .toThrow('profile scope is unauthorized')
  })

  it('rejects normal providers and provider identity mismatch during registry construction', async () => {
    const value = normalizeSandboxLeaseProviderProfileV1(profile(), 'workspace-a')
    const digest = sandboxLeaseProviderProfileDigestV1(value.identity)
    await expect(createSandboxLeaseServiceFromProfileV1({
      profile: {
        ...value,
        providerFactory: () => ({
          contractVersion: 'boring-sandbox.provider.v1', providerId: 'direct',
        } as unknown as SandboxProviderV1 as never),
      },
      verifiedWorkspaceScopeId: 'workspace-a',
      expectedDigest: digest,
    })).rejects.toThrow('registration does not match trusted profile')
    const mismatch = { ...value, identity: { ...value.identity, providerId: 'bwrap' as const } }
    await expect(createSandboxLeaseServiceFromProfileV1({
      profile: mismatch,
      verifiedWorkspaceScopeId: 'workspace-a',
      expectedDigest: sandboxLeaseProviderProfileDigestV1(mismatch.identity),
    })).rejects.toThrow('provider identity does not match')
  })
})
