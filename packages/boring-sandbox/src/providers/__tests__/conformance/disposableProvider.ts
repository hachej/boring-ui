import { expect } from 'vitest'

import {
  DISPOSABLE_SANDBOX_PROVIDER_PROFILE_V1,
  isDisposableSandboxProviderV1,
  type ExtractedSandboxProviderIdV1,
  type SandboxProviderV1,
} from '../../../shared/providerV1'

/** Shared marker/ownership law used by every disposable provider qualification. */
export function expectDisposableProviderProfile(
  provider: SandboxProviderV1,
  providerId: ExtractedSandboxProviderIdV1,
): void {
  expect(provider.providerId).toBe(providerId)
  expect(isDisposableSandboxProviderV1(provider)).toBe(true)
  if (!isDisposableSandboxProviderV1(provider)) return
  expect(provider.disposableProfile).toEqual({
    contractVersion: DISPOSABLE_SANDBOX_PROVIDER_PROFILE_V1,
    resume: false,
    publishedCleanupOwner: 'returned-pair',
    ambiguousCreate: 'correlated-reconciliation',
  })
}

export function expectPersistentProviderDefault(provider: SandboxProviderV1): void {
  expect(isDisposableSandboxProviderV1(provider)).toBe(false)
}
