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
  /** Trusted host factory. The lifecycle registry invokes it at most once per digest. */
  readonly providerFactory: () => DisposableSandboxProviderV1 | Promise<DisposableSandboxProviderV1>
  readonly templatePath?: string
}

const SHA256 = /^sha256:[a-f0-9]{64}$/
const PROFILE_KEYS = new Set(['identity', 'providerFactory', 'templatePath'])
const IDENTITY_KEYS = new Set([
  'contractVersion', 'workspaceScopeId', 'placementIdentity', 'providerWorkspaceId',
  'leaseRoot', 'providerId', 'providerConfigDigest', 'templateFingerprint',
  'credentialVersionRefs', 'ttlMs', 'reapIntervalMs', 'drainTimeoutMs',
  'maxActiveLeasesPerOwner', 'maxActiveLeasesTotal',
])

function assertExactKeys(value: object, allowed: ReadonlySet<string>, name: string): void {
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new TypeError(`${name} contains unsupported fields`)
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer`)
  return value
}

function nonEmpty(value: string, name: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${name} is required`)
  return normalized
}

export function normalizeSandboxLeaseProviderProfileV1(
  profile: SandboxLeaseProviderProfileV1,
  verifiedWorkspaceScopeId: string,
): SandboxLeaseProviderProfileV1 {
  assertExactKeys(profile, PROFILE_KEYS, 'sandbox lease profile')
  const identity = profile.identity
  assertExactKeys(identity, IDENTITY_KEYS, 'sandbox lease profile identity')
  if (identity.contractVersion !== SANDBOX_LEASE_PROVIDER_PROFILE_VERSION_V1) {
    throw new TypeError('sandbox lease profile version is unsupported')
  }
  const workspaceScopeId = nonEmpty(identity.workspaceScopeId, 'workspaceScopeId')
  if (workspaceScopeId !== verifiedWorkspaceScopeId) throw new TypeError('sandbox lease profile scope is unauthorized')
  if (typeof profile.providerFactory !== 'function') throw new TypeError('sandbox lease provider factory is required')
  const leaseRoot = resolve(identity.leaseRoot)
  if (!isAbsolute(identity.leaseRoot) || identity.leaseRoot !== leaseRoot || parse(leaseRoot).root === leaseRoot) {
    throw new TypeError('sandbox lease root must be an absolute non-root path')
  }
  if (!SHA256.test(identity.providerConfigDigest)) throw new TypeError('providerConfigDigest must be sha256')
  if (identity.templateFingerprint && !SHA256.test(identity.templateFingerprint)) throw new TypeError('templateFingerprint must be sha256')
  const credentialVersionRefs = [...new Set(identity.credentialVersionRefs.map((value) => nonEmpty(value, 'credentialVersionRef')))].sort()
  const normalizedIdentity: SandboxLeaseProviderProfileIdentityV1 = Object.freeze({
    contractVersion: SANDBOX_LEASE_PROVIDER_PROFILE_VERSION_V1,
    workspaceScopeId,
    placementIdentity: nonEmpty(identity.placementIdentity, 'placementIdentity'),
    providerWorkspaceId: nonEmpty(identity.providerWorkspaceId, 'providerWorkspaceId'),
    leaseRoot,
    providerId: identity.providerId,
    providerConfigDigest: identity.providerConfigDigest,
    ...(identity.templateFingerprint ? { templateFingerprint: identity.templateFingerprint } : {}),
    credentialVersionRefs: Object.freeze(credentialVersionRefs),
    ttlMs: positiveInteger(identity.ttlMs, 'ttlMs'),
    reapIntervalMs: positiveInteger(identity.reapIntervalMs, 'reapIntervalMs'),
    drainTimeoutMs: positiveInteger(identity.drainTimeoutMs, 'drainTimeoutMs'),
    maxActiveLeasesPerOwner: positiveInteger(identity.maxActiveLeasesPerOwner, 'maxActiveLeasesPerOwner'),
    maxActiveLeasesTotal: positiveInteger(identity.maxActiveLeasesTotal, 'maxActiveLeasesTotal'),
  })
  return Object.freeze({
    identity: normalizedIdentity,
    providerFactory: profile.providerFactory,
    ...(profile.templatePath ? { templatePath: profile.templatePath } : {}),
  })
}

export async function createSandboxLeaseServiceFromProfileV1(input: {
  readonly profile: SandboxLeaseProviderProfileV1
  readonly verifiedWorkspaceScopeId: string
  readonly expectedDigest: string
}): Promise<SandboxLeaseService> {
  const profile = normalizeSandboxLeaseProviderProfileV1(
    input.profile,
    input.verifiedWorkspaceScopeId,
  )
  const digest = sandboxLeaseProviderProfileDigestV1(profile.identity)
  if (digest !== input.expectedDigest) throw new TypeError('sandbox lease profile digest does not match capability')
  const identity = profile.identity
  const provider = await profile.providerFactory()
  try {
    if (!isDisposableLeaseProvider(provider)) throw new TypeError('sandbox lease provider is not factory-registered')
    if (provider.providerId !== identity.providerId) throw new TypeError('sandbox lease provider identity does not match')
    if (provider.disposableProfile.providerConfigDigest !== identity.providerConfigDigest) {
      throw new TypeError('sandbox lease provider configuration identity does not match')
    }
  } catch (error) {
    try { await provider.close?.() }
    catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'sandbox lease provider attestation cleanup failed')
    }
    throw error
  }
  return new SandboxLeaseService({
    workspaceRoot: identity.leaseRoot,
    provider,
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
