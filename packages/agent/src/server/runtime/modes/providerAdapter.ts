import type {
  SandboxProviderV1,
  WorkspaceSandboxPairV1,
} from '@hachej/boring-sandbox/shared'

import { createServerFileSearch } from '../createServerFileSearch'
import type {
  ModeContext,
  RuntimeBashStrategy,
  RuntimeBundle,
  RuntimeFilesystemStrategy,
  RuntimeModeAdapter,
} from '../mode'
import type { WorkspaceProvisioningAdapter } from '../../workspace/provisioning'
import type { AgentRuntimeHostOperations } from '../runtimeHost'

interface ProviderRuntimeModeAdapterOptions {
  id: 'direct' | 'local' | 'vercel-sandbox'
  provider: SandboxProviderV1
  runtimeHost: AgentRuntimeHostOperations
  workspaceFsCapability: 'strong' | 'best-effort'
  bash: RuntimeBashStrategy
  filesystem: RuntimeFilesystemStrategy
  storageRoot?: (context: ModeContext) => string | undefined
  preflight?: (context: ModeContext) => void | Promise<void>
  prepare?: (context: ModeContext) => Promise<void>
  provisioningAdapter?: (
    context: ModeContext,
    pair: WorkspaceSandboxPairV1,
  ) => WorkspaceProvisioningAdapter | undefined
  healthCheckIntervalMs?: number
  readiness?: RuntimeModeAdapter['readiness']
}

const runtimePair = Symbol('boring-sandbox-runtime-pair')
type ProviderRuntimeBundle = RuntimeBundle & {
  [runtimePair]: WorkspaceSandboxPairV1
}

export function createProviderRuntimeModeAdapter(
  options: ProviderRuntimeModeAdapterOptions,
): RuntimeModeAdapter {
  return {
    id: options.id,
    runtimeHost: options.runtimeHost,
    workspaceFsCapability: options.workspaceFsCapability,
    readiness: options.readiness,
    ...(options.healthCheckIntervalMs === undefined
      ? {}
      : {
          cachedBindingHealthCheck: {
            intervalMs: options.healthCheckIntervalMs,
            async check({ runtimeBundle }) {
              const pair = (runtimeBundle as Partial<ProviderRuntimeBundle>)[runtimePair]
              return await pair?.checkHealth?.() ?? { state: 'ok' as const }
            },
          },
        }),
    getRuntimeLayoutRoot: (context) => options.provider.resolveRuntimeRoot(context),
    evictCachedRuntime: async ({ workspaceId }) => {
      await options.provider.invalidate?.({ workspaceId })
    },
    async dispose() {
      await options.provider.close?.()
    },
    async create(context) {
      await options.preflight?.(context)
      await options.prepare?.(context)
      const pair = await options.provider.create(context)
      try {
        const runtimeBundle: ProviderRuntimeBundle = {
          [runtimePair]: pair,
          runtimeContext: pair.workspace.runtimeContext,
          storageRoot: options.storageRoot?.(context),
          workspace: pair.workspace,
          sandbox: pair.sandbox,
          fileSearch: createServerFileSearch(pair.workspace, pair.sandbox),
          runtimeHost: options.runtimeHost,
          bash: options.bash,
          filesystem: options.filesystem,
          provisioningAdapter: options.provisioningAdapter?.(context, pair)
            ?? pair.provisioning,
          disposeRuntime: () => pair.dispose(),
        }
        return runtimeBundle
      } catch (error) {
        try {
          await pair.dispose()
        } catch {
          // Preserve the construction failure; cleanup failure is secondary.
        }
        throw error
      }
    },
  }
}
