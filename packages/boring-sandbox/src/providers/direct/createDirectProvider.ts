import { mkdir } from 'node:fs/promises'

import { PROVIDER_CAPABILITIES, PROVIDER_CONTRACT_VERSION } from '../../shared/providerMatrix'
import {
  type DisposableSandboxProviderV1,
  type SandboxProviderV1,
  type WorkspaceSandboxPairV1,
} from '../../shared/providerV1'
import {
  disposableProviderConfigDigestV1,
  registerDisposableSandboxProviderV1,
} from '../disposableProviderRegistration'
import {
  assertDisposableLocalRoot,
  createDisposableLocalDisposer,
} from '../local/disposableLocalLifecycle'
import { createNodeWorkspace, disposeNodeWorkspace } from '../node-workspace/createNodeWorkspace'
import { createDirectSandbox, type CreateDirectSandboxOptions } from './createDirectSandbox'

export interface DirectSandboxProviderOptions {
  sandbox?: Omit<CreateDirectSandboxOptions, 'runtimeContext'>
  leaseMode?: 'disposable'
}

export function createDirectSandboxProvider(
  options: DirectSandboxProviderOptions & { leaseMode: 'disposable' },
): DisposableSandboxProviderV1
export function createDirectSandboxProvider(
  options?: DirectSandboxProviderOptions,
): SandboxProviderV1
export function createDirectSandboxProvider(
  options: DirectSandboxProviderOptions = {},
): SandboxProviderV1 {
  const pendingCleanup = new Set<() => Promise<void>>()
  const provider: SandboxProviderV1 = {
    contractVersion: PROVIDER_CONTRACT_VERSION,
    providerId: 'direct',
    capabilities: PROVIDER_CAPABILITIES.direct,
    resolveRuntimeRoot(context) {
      return context.workspaceRoot
    },
    async create(context): Promise<WorkspaceSandboxPairV1> {
      const workspaceRoot = options.leaseMode === 'disposable'
        ? assertDisposableLocalRoot(context.workspaceRoot)
        : context.workspaceRoot
      await mkdir(workspaceRoot, { recursive: options.leaseMode !== 'disposable' })
      const runtimeContext = { runtimeCwd: workspaceRoot }
      const workspace = createNodeWorkspace(workspaceRoot, { runtimeContext })
      const sandbox = createDirectSandbox({ ...options.sandbox, runtimeContext })
      const cleanup = options.leaseMode === 'disposable'
        ? createDisposableLocalDisposer({
            workspaceRoot,
            disposeWorkspace: () => disposeNodeWorkspace(workspace),
            disposeSandbox: async () => { await sandbox.dispose?.() },
          })
        : undefined
      if (cleanup) pendingCleanup.add(cleanup)

      try {
        await sandbox.init?.({ workspace, sessionId: context.sessionId })
      } catch (error) {
        if (cleanup) {
          try { await cleanup(); pendingCleanup.delete(cleanup) }
          catch (cleanupError) { throw new AggregateError([error, cleanupError], 'direct sandbox creation cleanup failed') }
        } else {
          disposeNodeWorkspace(workspace)
          await sandbox.dispose?.()
        }
        throw error
      }

      if (cleanup) {
        pendingCleanup.delete(cleanup)
        return { workspace, sandbox, dispose: cleanup }
      }
      let disposed = false
      return {
        workspace,
        sandbox,
        async dispose() {
          if (disposed) return
          disposed = true
          disposeNodeWorkspace(workspace)
          await sandbox.dispose?.()
        },
      }
    },
    ...(options.leaseMode === 'disposable' ? {
      async close() {
        const results = await Promise.allSettled([...pendingCleanup].map(async (cleanup) => {
          await cleanup()
          pendingCleanup.delete(cleanup)
        }))
        const failures = results.filter((result) => result.status === 'rejected')
        if (failures.length) throw new AggregateError(failures.map((failure) => failure.reason))
      },
    } : {}),
  }
  return options.leaseMode === 'disposable'
    ? registerDisposableSandboxProviderV1(
        provider,
        disposableProviderConfigDigestV1('direct', {
          leaseMode: 'disposable',
          runtime: 'host-process',
        }),
      )
    : provider
}
