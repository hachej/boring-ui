import { mkdir } from 'node:fs/promises'

import { PROVIDER_CAPABILITIES, PROVIDER_CONTRACT_VERSION } from '../../shared/providerMatrix'
import {
  SandboxProviderError,
  type SandboxProviderV1,
  type WorkspaceSandboxPairV1,
} from '../../shared/providerV1'
import { createNodeWorkspace, disposeNodeWorkspace } from '../node-workspace/createNodeWorkspace'
import type { Workspace } from '@hachej/boring-agent/shared'
import {
  createBwrapSandbox,
  type CreateBwrapSandboxOptions,
} from './createBwrapSandbox'

export interface BwrapSandboxProviderOptions {
  sandbox?: Omit<CreateBwrapSandboxOptions, 'hostWorkspaceRoot' | 'runtimeContext'>
  /** Supplies an externally owned canonical workspace shared with host plugins. */
  createWorkspace?: (context: Parameters<SandboxProviderV1['create']>[0], runtimeContext: { runtimeCwd: string }) => Workspace
}

export function createBwrapSandboxProvider(
  options: BwrapSandboxProviderOptions = {},
): SandboxProviderV1 {
  return {
    contractVersion: PROVIDER_CONTRACT_VERSION,
    providerId: 'bwrap',
    capabilities: PROVIDER_CAPABILITIES.bwrap,
    resolveRuntimeRoot() {
      return '/workspace'
    },
    async create(context): Promise<WorkspaceSandboxPairV1> {
      if (process.platform !== 'linux') {
        throw new SandboxProviderError(
          'BWRAP_UNAVAILABLE',
          'local mode requires Linux with bubblewrap',
        )
      }

      await mkdir(context.workspaceRoot, { recursive: true })
      const runtimeContext = { runtimeCwd: '/workspace' }
      const ownsWorkspace = !options.createWorkspace
      const workspace = options.createWorkspace?.(context, runtimeContext)
        ?? createNodeWorkspace(context.workspaceRoot, { runtimeContext })
      const sandbox = createBwrapSandbox({
        ...options.sandbox,
        hostWorkspaceRoot: context.workspaceRoot,
        runtimeContext: workspace.runtimeContext,
      })

      try {
        await sandbox.init?.({ workspace, sessionId: context.sessionId })
      } catch (error) {
        if (ownsWorkspace) disposeNodeWorkspace(workspace)
        await sandbox.dispose?.()
        const message = error instanceof Error ? error.message : String(error)
        if (/bubblewrap|\bbwrap\b/i.test(message)) {
          throw new SandboxProviderError('BWRAP_UNAVAILABLE', message, {
            cause: error,
          })
        }
        throw error
      }

      let disposed = false
      return {
        workspace,
        sandbox,
        async dispose() {
          if (disposed) return
          disposed = true
          if (ownsWorkspace) disposeNodeWorkspace(workspace)
          await sandbox.dispose?.()
        },
      }
    },
  }
}
