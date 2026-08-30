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
  createDisposableLocalProviderLifecycle,
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
  const lifecycle = createDisposableLocalProviderLifecycle('bwrap')
  const provider: SandboxProviderV1 = {
    contractVersion: PROVIDER_CONTRACT_VERSION,
    providerId: 'bwrap',
    capabilities: PROVIDER_CAPABILITIES.bwrap,
    resolveRuntimeRoot() {
      return '/workspace'
    },
    async create(context): Promise<WorkspaceSandboxPairV1> {
      if (lifecycle.closed) throw new SandboxProviderError('CONFIG_INVALID', 'bwrap provider is closed')
      const finishCreate = lifecycle.beginCreate()
      try {
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
      if (cleanup) lifecycle.own(cleanup)

      try {
        await sandbox.init?.({ workspace, sessionId: context.sessionId })
      } catch (error) {
        if (cleanup) await lifecycle.compensate(error, cleanup)
        else {
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
        if (lifecycle.closed) throw await lifecycle.compensate(
          new SandboxProviderError('CONFIG_INVALID', 'bwrap provider closed during create'), cleanup)
        lifecycle.publish(cleanup)
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
      } finally { finishCreate() }
    },
    ...(options.leaseMode === 'disposable' ? {
      async close() { await lifecycle.close() },
    } : {}),
  }
  return options.leaseMode === 'disposable'
    ? registerDisposableSandboxProviderV1(
        provider,
        disposableProviderConfigDigestV1('bwrap', {
          leaseMode: 'disposable',
          network: options.sandbox?.network ?? 'shared',
          dropAllCapabilities: options.sandbox?.namespaceProfile === 'docker'
            || options.sandbox?.dropAllCapabilities === true,
          namespaceProfile: options.sandbox?.namespaceProfile ?? 'full',
          resourceLimits: options.sandbox?.resourceLimits ?? null,
        }),
      )
    : provider
}
