import { mkdir } from 'node:fs/promises'

import { PROVIDER_CAPABILITIES, PROVIDER_CONTRACT_VERSION } from '../../shared/providerMatrix'
import type { SandboxProviderV1, WorkspaceSandboxPairV1 } from '../../shared/providerV1'
import { createNodeWorkspace, disposeNodeWorkspace } from '../node-workspace/createNodeWorkspace'
import { createDirectSandbox, type CreateDirectSandboxOptions } from './createDirectSandbox'

export interface DirectSandboxProviderOptions {
  sandbox?: Omit<CreateDirectSandboxOptions, 'runtimeContext'>
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
      const workspace = createNodeWorkspace(context.workspaceRoot, { runtimeContext })
      const sandbox = createDirectSandbox({ ...options.sandbox, runtimeContext })

      try {
        await sandbox.init?.({ workspace, sessionId: context.sessionId })
      } catch (error) {
        disposeNodeWorkspace(workspace)
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
          disposeNodeWorkspace(workspace)
          await sandbox.dispose?.()
        },
      }
    },
  }
}
