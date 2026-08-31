import { registerTrustedDisposableLeaseProvider } from '../disposableProvider'

import type {
  DisposableSandboxProviderV1,
  SandboxProviderV1,
  WorkspaceSandboxPairV1,
} from '@hachej/boring-sandbox/shared'

/** Test-only factory-bound provider double. Production admission remains unconditional. */
export function fakeDisposableProvider(input: {
  create: SandboxProviderV1['create'] | (() => Promise<WorkspaceSandboxPairV1>)
  close?: () => Promise<void>
  providerId?: SandboxProviderV1['providerId']
  providerConfigDigest?: `sha256:${string}`
}): DisposableSandboxProviderV1 {
  let provider!: SandboxProviderV1
  provider = {
    contractVersion: 'boring-sandbox.provider.v1',
    providerId: input.providerId ?? 'direct',
    capabilities: {} as never,
    resolveRuntimeRoot: (context) => context.workspaceRoot,
    create: input.create,
    close: input.close,
    disposableProfile: {
      contractVersion: 'boring-sandbox.disposable-provider.v1',
      resume: false,
      publishedCleanupOwner: 'returned-pair',
      ambiguousCreate: 'correlated-reconciliation',
      providerConfigDigest: input.providerConfigDigest ?? `sha256:${'a'.repeat(64)}`,
      assertProvider(candidate: SandboxProviderV1) {
        if (candidate !== provider) throw new TypeError('registration mismatch')
      },
    },
  } as SandboxProviderV1
  registerTrustedDisposableLeaseProvider(
    provider,
    (provider as DisposableSandboxProviderV1).disposableProfile.providerConfigDigest,
  )
  return provider as DisposableSandboxProviderV1
}
