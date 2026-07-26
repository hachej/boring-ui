import { mkdir } from 'node:fs/promises'

import { PROVIDER_CAPABILITIES, PROVIDER_CONTRACT_VERSION } from '../../shared/providerMatrix'
import {
  SandboxProviderError,
  type SandboxProviderV1,
  type WorkspaceSandboxPairV1,
} from '../../shared/providerV1'
import {
  createNodeWorkspace,
  disposeNodeWorkspace,
  getNodeWorkspaceReadonlyPolicy,
  whenNodeWorkspaceReady,
} from '../node-workspace/createNodeWorkspace'
import {
  createBwrapSandbox,
  type CreateBwrapSandboxOptions,
} from './createBwrapSandbox'
import { validateBwrapReadonlyWorkspaceRoots } from './readonlyWorkspaceRoots'

export interface BwrapSandboxProviderOptions {
  sandbox?: Omit<CreateBwrapSandboxOptions, 'hostWorkspaceRoot' | 'runtimeContext' | 'readonlyWorkspacePaths'>
}

export function createBwrapSandboxProvider(
  options: BwrapSandboxProviderOptions = {},
): SandboxProviderV1 {
  return {
    contractVersion: PROVIDER_CONTRACT_VERSION,
    providerId: 'bwrap',
    capabilities: PROVIDER_CAPABILITIES.bwrap,
    readonlyWorkspacePathEnforcement: 'operations-and-shell',
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
      const readonlyWorkspacePolicyInput = context.readonlyWorkspacePolicy
      const strongReadonlyShell = readonlyWorkspacePolicyInput !== undefined
        && context.requestedReadonlyWorkspacePathEnforcement === 'operations-and-shell'
      if (strongReadonlyShell) {
        await validateBwrapReadonlyWorkspaceRoots(
          context.workspaceRoot,
          readonlyWorkspacePolicyInput.readonlyPaths,
        )
      }
      const runtimeContext = { runtimeCwd: '/workspace' }
      const workspace = createNodeWorkspace(context.workspaceRoot, {
        runtimeContext,
        readonlyWorkspacePolicy: context.readonlyWorkspacePolicy,
      })
      await whenNodeWorkspaceReady(workspace)
      const readonlyWorkspacePolicy = await getNodeWorkspaceReadonlyPolicy(workspace)
      const sandbox = createBwrapSandbox({
        ...options.sandbox,
        hostWorkspaceRoot: context.workspaceRoot,
        runtimeContext,
        readonlyWorkspacePaths: strongReadonlyShell ? readonlyWorkspacePolicy?.readonlyPaths : undefined,
      })

      try {
        await sandbox.init?.({ workspace, sessionId: context.sessionId })
      } catch (error) {
        disposeNodeWorkspace(workspace)
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
        readonlyWorkspacePolicy,
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
