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
import { ErrorCode } from '../../../shared/error-codes'
import type { AgentRuntimeHostOperations } from '../runtimeHost'
import { createUserFilesystemBinding } from '../userFilesystemBinding'
import { READONLY_WORKSPACE_SHELL_UNAVAILABLE_REASON } from '../mode'

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
      const providerEnforcement = options.provider.readonlyWorkspacePathEnforcement ?? 'operations'
      const requestedEnforcement = context.requestedReadonlyWorkspacePathEnforcement ?? 'operations'
      if (
        context.readonlyWorkspacePolicy
        && requestedEnforcement === 'operations-and-shell'
        && (providerEnforcement !== 'operations-and-shell' || options.provider.providerId !== 'bwrap')
      ) {
        throw Object.assign(
          new Error(`${options.provider.providerId} is not qualified for requested readonly workspace shell enforcement`),
          { code: ErrorCode.enum.CONFIG_INVALID },
        )
      }
      const readonlyWorkspacePathEnforcement = context.readonlyWorkspacePolicy
        ? requestedEnforcement === 'operations-and-shell' ? 'operations-and-shell' : 'operations'
        : undefined
      if (
        readonlyWorkspacePathEnforcement === 'operations-and-shell'
        && options.bash.kind !== 'local-sandbox'
      ) {
        throw Object.assign(
          new Error('strong readonly workspace shell enforcement requires local-sandbox bash'),
          { code: ErrorCode.enum.CONFIG_INVALID },
        )
      }
      await options.preflight?.(context)
      await options.prepare?.(context)
      const pair = await options.provider.create(context)
      try {
        if (context.readonlyWorkspacePolicy && !pair.readonlyWorkspacePolicy) {
          throw Object.assign(
            new Error(`${options.provider.providerId} dropped readonly workspace path policy`),
            { code: ErrorCode.enum.CONFIG_INVALID },
          )
        }
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
          filesystemBindings: pair.readonlyWorkspacePolicy
            ? [createUserFilesystemBinding(pair.workspace, pair.readonlyWorkspacePolicy)]
            : undefined,
          readonlyWorkspacePolicy: pair.readonlyWorkspacePolicy,
          readonlyWorkspacePathEnforcement,
          ...(pair.readonlyWorkspacePolicy && readonlyWorkspacePathEnforcement !== 'operations-and-shell'
            ? { readonlyWorkspaceShellUnavailableReason: READONLY_WORKSPACE_SHELL_UNAVAILABLE_REASON }
            : {}),
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
