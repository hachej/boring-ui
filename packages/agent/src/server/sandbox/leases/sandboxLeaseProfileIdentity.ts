import { createHash } from 'node:crypto'
import { isAbsolute, parse, resolve } from 'node:path'

import type {
  DisposableSandboxProviderV1,
  ExtractedSandboxProviderIdV1,
} from '@hachej/boring-sandbox/shared'
import { SandboxLeaseService } from './sandboxLease'
import { isDisposableLeaseProvider } from './disposableProvider'

export const SANDBOX_LEASE_PROVIDER_PROFILE_VERSION_V1 =
  'boring-agent.sandbox-lease-profile.v1' as const

export interface SandboxLeaseProviderProfileIdentityV1 {
  readonly contractVersion: typeof SANDBOX_LEASE_PROVIDER_PROFILE_VERSION_V1
  readonly workspaceScopeId: string
  readonly placementIdentity: string
  readonly providerWorkspaceId: string
  readonly leaseRoot: string
  readonly providerId: ExtractedSandboxProviderIdV1
  readonly providerConfigDigest: `sha256:${string}`
  readonly templateFingerprint?: `sha256:${string}`
  readonly credentialVersionRefs: readonly string[]
  readonly ttlMs: number
  readonly reapIntervalMs: number
  readonly drainTimeoutMs: number
  readonly maxActiveLeasesPerOwner: number
  readonly maxActiveLeasesTotal: number
}

export interface SandboxLeaseProviderProfileV1 {
  readonly identity: SandboxLeaseProviderProfileIdentityV1
  readonly provider: DisposableSandboxProviderV1
  readonly templatePath?: string
}

const SHA256 = /^sha256:[a-f0-9]{64}$/

function nonEmpty(value: string, name: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${name} is required`)
  return normalized
}

export function normalizeSandboxLeaseProviderProfileV1(
  profile: SandboxLeaseProviderProfileV1,
  verifiedWorkspaceScopeId: string,
): SandboxLeaseProviderProfileV1 {
  const identity = profile.identity
  if (identity.contractVersion !== SANDBOX_LEASE_PROVIDER_PROFILE_VERSION_V1) {
    throw new TypeError('sandbox lease profile version is unsupported')
  }
  const workspaceScopeId = nonEmpty(identity.workspaceScopeId, 'workspaceScopeId')
  if (workspaceScopeId !== verifiedWorkspaceScopeId) throw new TypeError('sandbox lease profile scope is unauthorized')
  if (!isDisposableLeaseProvider(profile.provider)) throw new TypeError('sandbox lease provider is not disposable')
  if (profile.provider.providerId !== identity.providerId) throw new TypeError('sandbox lease provider identity does not match')
  const leaseRoot = resolve(identity.leaseRoot)
  if (!isAbsolute(identity.leaseRoot) || parse(leaseRoot).root === leaseRoot) {
    throw new TypeError('sandbox lease root must be an absolute non-root path')
  }
  if (!SHA256.test(identity.providerConfigDigest)) throw new TypeError('providerConfigDigest must be sha256')
  if (identity.templateFingerprint && !SHA256.test(identity.templateFingerprint)) throw new TypeError('templateFingerprint must be sha256')
  const credentialVersionRefs = [...new Set(identity.credentialVersionRefs.map((value) => nonEmpty(value, 'credentialVersionRef')))].sort()
  const normalizedIdentity = Object.freeze({
    ...identity,
    workspaceScopeId,
    placementIdentity: nonEmpty(identity.placementIdentity, 'placementIdentity'),
    providerWorkspaceId: nonEmpty(identity.providerWorkspaceId, 'providerWorkspaceId'),
    leaseRoot,
    credentialVersionRefs: Object.freeze(credentialVersionRefs),
  })
  return Object.freeze({ ...profile, identity: normalizedIdentity })
}

export function createSandboxLeaseServiceFromProfileV1(input: {
  readonly profile: SandboxLeaseProviderProfileV1
  readonly verifiedWorkspaceScopeId: string
  readonly expectedDigest: string
}): SandboxLeaseService {
  const profile = normalizeSandboxLeaseProviderProfileV1(
    input.profile,
    input.verifiedWorkspaceScopeId,
  )
  const digest = sandboxLeaseProviderProfileDigestV1(profile.identity)
  if (digest !== input.expectedDigest) throw new TypeError('sandbox lease profile digest does not match capability')
  const identity = profile.identity
  return new SandboxLeaseService({
    workspaceRoot: identity.leaseRoot,
    provider: profile.provider,
    serviceDigest: digest,
    providerWorkspaceId: identity.providerWorkspaceId,
    templatePath: profile.templatePath,
    ttlMs: identity.ttlMs,
    reapIntervalMs: identity.reapIntervalMs,
    drainTimeoutMs: identity.drainTimeoutMs,
    maxActiveLeasesPerOwner: identity.maxActiveLeasesPerOwner,
    maxActiveLeasesTotal: identity.maxActiveLeasesTotal,
  })
}

export function sandboxLeaseProviderProfileDigestV1(
  identity: SandboxLeaseProviderProfileIdentityV1,
): `sha256:${string}` {
  const bytes = JSON.stringify({
    contractVersion: identity.contractVersion,
    workspaceScopeId: identity.workspaceScopeId,
    placementIdentity: identity.placementIdentity,
    providerWorkspaceId: identity.providerWorkspaceId,
    leaseRoot: identity.leaseRoot,
    providerId: identity.providerId,
    providerConfigDigest: identity.providerConfigDigest,
    templateFingerprint: identity.templateFingerprint ?? null,
    credentialVersionRefs: [...identity.credentialVersionRefs],
    ttlMs: identity.ttlMs,
    reapIntervalMs: identity.reapIntervalMs,
    drainTimeoutMs: identity.drainTimeoutMs,
    maxActiveLeasesPerOwner: identity.maxActiveLeasesPerOwner,
    maxActiveLeasesTotal: identity.maxActiveLeasesTotal,
  })
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}
