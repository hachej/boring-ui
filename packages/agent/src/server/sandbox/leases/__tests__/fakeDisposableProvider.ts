import type {
  DisposableSandboxProviderV1,
  SandboxProviderV1,
  WorkspaceSandboxPairV1,
} from '@hachej/boring-sandbox/shared'

/** Test-only disposable-provider double. */
export function fakeDisposableProvider(input: {
  create: SandboxProviderV1['create'] | (() => Promise<WorkspaceSandboxPairV1>)
  close?: () => Promise<void>
  providerId?: SandboxProviderV1['providerId']
  providerConfigDigest?: `sha256:${string}`
}): DisposableSandboxProviderV1 {
  return {
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
    },
  }
}
