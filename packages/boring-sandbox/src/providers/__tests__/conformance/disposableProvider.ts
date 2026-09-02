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
  })
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
