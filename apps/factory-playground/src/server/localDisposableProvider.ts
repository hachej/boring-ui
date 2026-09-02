import { createHash } from 'node:crypto'
import { cp, rm } from 'node:fs/promises'
import { createDirectSandboxProvider } from '@hachej/boring-sandbox/providers/direct'
import type { DisposableSandboxProviderV1 } from '@hachej/boring-sandbox/shared'

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

/**
 * Local-only disposable provider for deterministic Factory dogfood runs.
 * It proves lease routing and isolation, not security confinement.
 */
export function createLocalDisposableProvider(seedRoot: string): DisposableSandboxProviderV1 {
  const direct = createDirectSandboxProvider()
  return {
    ...direct,
    async create(context) {
      await cp(seedRoot, context.workspaceRoot, { recursive: true, errorOnExist: true, force: false })
      const pair = await direct.create(context)
      let disposed = false
      return {
        ...pair,
        async dispose() {
          if (disposed) return
          disposed = true
          try {
            await pair.dispose()
          } finally {
            await rm(context.workspaceRoot, { recursive: true, force: true })
          }
        },
      }
    },
    disposableProfile: {
      contractVersion: 'boring-sandbox.disposable-provider.v1',
      resume: false,
      publishedCleanupOwner: 'returned-pair',
      ambiguousCreate: 'correlated-reconciliation',
      providerConfigDigest: digest(`factory-playground-local:${seedRoot}`),
    },
  }
}
