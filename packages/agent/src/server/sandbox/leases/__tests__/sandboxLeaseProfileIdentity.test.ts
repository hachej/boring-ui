import { describe, expect, it } from 'vitest'

import type { DisposableSandboxProviderV1, SandboxProviderV1 } from '@hachej/boring-sandbox/shared'
import {
  SANDBOX_LEASE_PROVIDER_PROFILE_VERSION_V1,
  createSandboxLeaseServiceFromProfileV1,
  normalizeSandboxLeaseProviderProfileV1,
  sandboxLeaseProviderProfileDigestV1,
  type SandboxLeaseProviderProfileV1,
} from '../sandboxLeaseProfileIdentity'

const sha = `sha256:${'a'.repeat(64)}` as const

function disposableProvider(): DisposableSandboxProviderV1 {
  return {
    contractVersion: 'boring-sandbox.provider.v1',
    providerId: 'direct',
    capabilities: {} as never,
    disposableProfile: {
      contractVersion: 'boring-sandbox.disposable-provider.v1',
      resume: false,
      publishedCleanupOwner: 'returned-pair',
      ambiguousCreate: 'correlated-reconciliation',
    },
    resolveRuntimeRoot: (context) => context.workspaceRoot,
    async create() { throw new Error('not used') },
  }
}

function profile(scope = 'workspace-a'): SandboxLeaseProviderProfileV1 {
  return {
    provider: disposableProvider(),
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

  it('constructs a service bound to the complete profile identity', async () => {
    const normalized = normalizeSandboxLeaseProviderProfileV1(profile(), 'workspace-a')
    const digest = sandboxLeaseProviderProfileDigestV1(normalized.identity)
    const service = createSandboxLeaseServiceFromProfileV1({
      profile: normalized,
      verifiedWorkspaceScopeId: 'workspace-a',
      expectedDigest: digest,
    })
    expect(() => service.assertProfileBinding({
      digest,
      provider: normalized.provider,
      workspaceRoot: normalized.identity.leaseRoot,
      providerWorkspaceId: normalized.identity.providerWorkspaceId,
      templatePath: normalized.templatePath,
      ttlMs: normalized.identity.ttlMs,
      reapIntervalMs: normalized.identity.reapIntervalMs,
      drainTimeoutMs: normalized.identity.drainTimeoutMs,
      maxActiveLeasesPerOwner: normalized.identity.maxActiveLeasesPerOwner,
      maxActiveLeasesTotal: normalized.identity.maxActiveLeasesTotal,
    })).not.toThrow()
    expect(() => service.assertProfileBinding({
      digest, provider: normalized.provider,
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

  it('rejects cross-workspace reuse before provider use', () => {
    expect(() => normalizeSandboxLeaseProviderProfileV1(profile('workspace-a'), 'workspace-b'))
      .toThrow('profile scope is unauthorized')
  })

  it('rejects normal providers and provider identity mismatch', () => {
    const value = profile()
    expect(() => normalizeSandboxLeaseProviderProfileV1({
      ...value,
      provider: {
        contractVersion: 'boring-sandbox.provider.v1', providerId: 'direct',
      } as unknown as SandboxProviderV1 as never,
    }, 'workspace-a')).toThrow('provider is not disposable')
    expect(() => normalizeSandboxLeaseProviderProfileV1({
      ...value,
      identity: { ...value.identity, providerId: 'bwrap' },
    }, 'workspace-a')).toThrow('provider identity does not match')
  })
})
