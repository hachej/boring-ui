import type {
  DisposableSandboxProviderV1,
  SandboxProviderV1,
} from '@hachej/boring-sandbox/shared'

const DISPOSABLE_PROFILE_VERSION = 'boring-sandbox.disposable-provider.v1'

/** Agent-side structural admission check; boring-sandbox remains a runtime leaf. */
export function isDisposableLeaseProvider(
  provider: SandboxProviderV1,
): provider is DisposableSandboxProviderV1 {
  const profile = (provider as Partial<DisposableSandboxProviderV1>).disposableProfile
  return profile?.contractVersion === DISPOSABLE_PROFILE_VERSION
    && profile.resume === false
    && profile.publishedCleanupOwner === 'returned-pair'
    && profile.ambiguousCreate === 'correlated-reconciliation'
}
