import type {
  DisposableSandboxProviderV1,
  SandboxProviderV1,
} from '@hachej/boring-sandbox/shared'

const DISPOSABLE_PROFILE_VERSION = 'boring-sandbox.disposable-provider.v1'
const SHA256 = /^sha256:[a-f0-9]{64}$/

const trustedProviders = new WeakMap<SandboxProviderV1, `sha256:${string}`>()

export function hasDisposableLeaseProviderShape(provider: SandboxProviderV1): provider is DisposableSandboxProviderV1 {
  const profile = (provider as Partial<DisposableSandboxProviderV1>).disposableProfile
  return profile?.contractVersion === DISPOSABLE_PROFILE_VERSION
    && profile.resume === false
    && profile.publishedCleanupOwner === 'returned-pair'
    && profile.ambiguousCreate === 'correlated-reconciliation'
    && SHA256.test(profile.providerConfigDigest)
}

/** Minted only by Agent's trusted host profile factory after exact digest verification. */
export function registerTrustedDisposableLeaseProvider(
  provider: SandboxProviderV1,
  expectedDigest: `sha256:${string}`,
): asserts provider is DisposableSandboxProviderV1 {
  if (!hasDisposableLeaseProviderShape(provider) || provider.disposableProfile.providerConfigDigest !== expectedDigest) {
    throw new TypeError('sandbox lease provider registration does not match trusted profile')
  }
  trustedProviders.set(provider, expectedDigest)
}

export function isDisposableLeaseProvider(
  provider: SandboxProviderV1,
): provider is DisposableSandboxProviderV1 {
  const digest = trustedProviders.get(provider)
  return digest !== undefined
    && hasDisposableLeaseProviderShape(provider)
    && provider.disposableProfile.providerConfigDigest === digest
}
