import type {
  DisposableSandboxProviderProfileV1,
  DisposableSandboxProviderV1,
  SandboxProviderV1,
} from '../shared/providerV1'

const PROFILE_VERSION = 'boring-sandbox.disposable-provider.v1' as const
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/
const disposableProviders = new WeakMap<SandboxProviderV1, DisposableSandboxProviderProfileV1>()

/** Internal factory registration; intentionally absent from public package exports. */
export function registerDisposableSandboxProviderV1<T extends SandboxProviderV1>(
  provider: T,
  providerConfigDigest: `sha256:${string}`,
): T & DisposableSandboxProviderV1 {
  if (!SHA256_DIGEST.test(providerConfigDigest)) {
    throw new TypeError('disposable provider config identity must be sha256')
  }
  const profile: DisposableSandboxProviderProfileV1 = Object.freeze({
    contractVersion: PROFILE_VERSION,
    resume: false,
    publishedCleanupOwner: 'returned-pair',
    ambiguousCreate: 'correlated-reconciliation',
    providerConfigDigest,
    assertProvider(candidate: SandboxProviderV1) {
      if (candidate !== provider || disposableProviders.get(candidate) !== profile) {
        throw new TypeError('disposable provider registration does not match')
      }
    },
  })
  Object.defineProperty(provider, 'disposableProfile', {
    configurable: false,
    enumerable: true,
    value: profile,
    writable: false,
  })
  disposableProviders.set(provider, profile)
  return provider as T & DisposableSandboxProviderV1
}
