import { mkdir } from 'node:fs/promises'

import { PROVIDER_CAPABILITIES, PROVIDER_CONTRACT_VERSION } from '../../shared/providerMatrix'
import type { SandboxProviderV1, WorkspaceSandboxPairV1 } from '../../shared/providerV1'
import type { Workspace } from '@hachej/boring-agent/shared'
import { createNodeWorkspace, disposeNodeWorkspace } from '../node-workspace/createNodeWorkspace'
import { createDirectSandbox, type CreateDirectSandboxOptions } from './createDirectSandbox'

export interface DirectSandboxProviderOptions {
  sandbox?: Omit<CreateDirectSandboxOptions, 'runtimeContext'>
  /** Supplies an externally owned canonical workspace shared with host plugins. */
  createWorkspace?: (context: Parameters<SandboxProviderV1['create']>[0], runtimeContext: { runtimeCwd: string }) => Workspace
}

export function createDirectSandboxProvider(
  options: DirectSandboxProviderOptions = {},
): SandboxProviderV1 {
  return {
    contractVersion: PROVIDER_CONTRACT_VERSION,
    providerId: 'direct',
    capabilities: PROVIDER_CAPABILITIES.direct,
    resolveRuntimeRoot(context) {
      return context.workspaceRoot
    },
    async create(context): Promise<WorkspaceSandboxPairV1> {
      await mkdir(context.workspaceRoot, { recursive: true })
      const runtimeContext = { runtimeCwd: context.workspaceRoot }
      const ownsWorkspace = !options.createWorkspace
      const workspace = options.createWorkspace?.(context, runtimeContext)
        ?? createNodeWorkspace(context.workspaceRoot, { runtimeContext })
      const sandbox = createDirectSandbox({ ...options.sandbox, runtimeContext: workspace.runtimeContext })

      try {
        await sandbox.init?.({ workspace, sessionId: context.sessionId })
      } catch (error) {
        if (ownsWorkspace) disposeNodeWorkspace(workspace)
        await sandbox.dispose?.()
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
