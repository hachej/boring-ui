import { mkdir } from 'node:fs/promises'

import { PROVIDER_CAPABILITIES, PROVIDER_CONTRACT_VERSION } from '../../shared/providerMatrix'
import {
  SandboxProviderError,
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
import {
  createBwrapSandbox,
  type CreateBwrapSandboxOptions,
} from './createBwrapSandbox'

export interface BwrapSandboxProviderOptions {
  sandbox?: Omit<CreateBwrapSandboxOptions, 'hostWorkspaceRoot' | 'runtimeContext'>
  leaseMode?: 'disposable'
}

export function createBwrapSandboxProvider(
  options: BwrapSandboxProviderOptions & { leaseMode: 'disposable' },
): DisposableSandboxProviderV1
export function createBwrapSandboxProvider(
  options?: BwrapSandboxProviderOptions,
): SandboxProviderV1
export function createBwrapSandboxProvider(
  options: BwrapSandboxProviderOptions = {},
): SandboxProviderV1 {
  const pendingCleanup = new Set<() => Promise<void>>()
  const provider: SandboxProviderV1 = {
    contractVersion: PROVIDER_CONTRACT_VERSION,
    providerId: 'bwrap',
    capabilities: PROVIDER_CAPABILITIES.bwrap,
    resolveRuntimeRoot() {
      return '/workspace'
    },
    async create(context): Promise<WorkspaceSandboxPairV1> {
      const workspaceRoot = options.leaseMode === 'disposable'
        ? assertDisposableLocalRoot(context.workspaceRoot)
        : context.workspaceRoot
      if (process.platform !== 'linux') {
        throw new SandboxProviderError(
          'BWRAP_UNAVAILABLE',
          'local mode requires Linux with bubblewrap',
        )
      }

      await mkdir(workspaceRoot, { recursive: options.leaseMode !== 'disposable' })
      const runtimeContext = { runtimeCwd: '/workspace' }
      const workspace = createNodeWorkspace(workspaceRoot, { runtimeContext })
      const sandbox = createBwrapSandbox({
        ...options.sandbox,
        hostWorkspaceRoot: workspaceRoot,
        runtimeContext,
      })
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
          catch (cleanupError) { throw new AggregateError([error, cleanupError], 'bwrap sandbox creation cleanup failed') }
        } else {
          disposeNodeWorkspace(workspace)
          await sandbox.dispose?.()
        }
        const message = error instanceof Error ? error.message : String(error)
        if (/bubblewrap|\bbwrap\b/i.test(message)) {
          throw new SandboxProviderError('BWRAP_UNAVAILABLE', message, { cause: error })
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
        disposableProviderConfigDigestV1('bwrap', {
          leaseMode: 'disposable',
          network: options.sandbox?.network ?? 'shared',
          dropAllCapabilities: options.sandbox?.dropAllCapabilities ?? true,
          namespaceProfile: options.sandbox?.namespaceProfile ?? null,
          resourceLimits: options.sandbox?.resourceLimits ?? null,
        }),
      )
    : provider
}
