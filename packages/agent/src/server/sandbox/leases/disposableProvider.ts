import type {
  DisposableSandboxProviderV1,
  SandboxProviderV1,
} from '@hachej/boring-sandbox/shared'

const DISPOSABLE_PROFILE_VERSION = 'boring-sandbox.disposable-provider.v1'
const SHA256 = /^sha256:[a-f0-9]{64}$/

/** Agent invokes the factory-bound assertion without value-importing the sandbox package. */
export function isDisposableLeaseProvider(
  provider: SandboxProviderV1,
): provider is DisposableSandboxProviderV1 {
  const profile = (provider as Partial<DisposableSandboxProviderV1>).disposableProfile
  if (
    profile?.contractVersion !== DISPOSABLE_PROFILE_VERSION
    || profile.resume !== false
    || profile.publishedCleanupOwner !== 'returned-pair'
    || profile.ambiguousCreate !== 'correlated-reconciliation'
    || !SHA256.test(profile.providerConfigDigest)
    || typeof profile.assertProvider !== 'function'
  ) return false
  try {
    profile.assertProvider(provider)
    return true
  } catch {
    return false
  }
}
