import { expect } from 'vitest'

import {
  DISPOSABLE_SANDBOX_PROVIDER_PROFILE_V1,
  isDisposableSandboxProviderV1,
  type ExtractedSandboxProviderIdV1,
  type SandboxProviderV1,
  type WorkspaceSandboxPairV1,
} from '../../../shared/providerV1'

/** Shared marker/ownership law used by every disposable provider qualification. */
export function expectDisposableProviderProfile(
  provider: SandboxProviderV1,
  providerId: ExtractedSandboxProviderIdV1,
): void {
  expect(provider.providerId).toBe(providerId)
  expect(isDisposableSandboxProviderV1(provider)).toBe(true)
  if (!isDisposableSandboxProviderV1(provider)) return
  expect(provider.disposableProfile).toMatchObject({
    contractVersion: DISPOSABLE_SANDBOX_PROVIDER_PROFILE_V1,
    resume: false,
    publishedCleanupOwner: 'returned-pair',
    ambiguousCreate: 'correlated-reconciliation',
    providerConfigDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    assertProvider: expect.any(Function),
  })
  expect(() => provider.disposableProfile.assertProvider(provider)).not.toThrow()
  const copied = { ...provider, disposableProfile: provider.disposableProfile } as SandboxProviderV1
  expect(isDisposableSandboxProviderV1(copied)).toBe(false)
  expect(() => provider.disposableProfile.assertProvider(copied)).toThrow()
}

/** Shared publication, provider-close, joined-disposal, and terminal-cleanup laws. */
export async function expectPublishedPairLifecycle(input: {
  provider: SandboxProviderV1
  pair: WorkspaceSandboxPairV1
  assertUsableAfterProviderClose(): Promise<void>
  assertTerminalCleanup(): Promise<void>
}): Promise<void> {
  await input.provider.close?.()
  await input.assertUsableAfterProviderClose()
  await Promise.all([input.pair.dispose(), input.pair.dispose()])
  await input.assertTerminalCleanup()
}

export function expectPersistentProviderDefault(provider: SandboxProviderV1): void {
  expect(isDisposableSandboxProviderV1(provider)).toBe(false)
}
