import { mkdir } from 'node:fs/promises'

import type {
  SandboxProviderV1,
  SandboxRuntimeHostPolicyV1,
  SandboxRuntimeModeDescriptorV1,
  SandboxRuntimePairFactoryOptionsV1,
  WorkspaceSandboxPairV1,
} from '@hachej/boring-sandbox/shared'

import { createServerFileSearch } from '../createServerFileSearch'
import type {
  BuiltinRuntimeModeId,
  ModeContext,
  RuntimeBashStrategy,
  RuntimeBundle,
  RuntimeFilesystemStrategy,
  RuntimeModeAdapter,
} from '../mode'
import type { WorkspaceProvisioningAdapter } from '../../workspace/provisioning'
import type { AgentRuntimeHostOperations } from '../runtimeHost'
import { copyTemplate } from '../../workspace/provision'
import {
  createDirectProvisioningAdapter,
  createLocalProvisioningAdapter,
} from './provisioningAdapter'

interface ProviderRuntimeModeAdapterOptions {
  id: BuiltinRuntimeModeId | (string & {})
  provider?: SandboxProviderV1
  providerFactory?: () => SandboxProviderV1 | Promise<SandboxProviderV1>
  resolveRuntimeRoot?: (context: ModeContext) => string
  runtimeProvider?: SandboxRuntimeModeDescriptorV1
  runtimeHostPolicy?: SandboxRuntimeHostPolicyV1
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
  let providerPromise: Promise<SandboxProviderV1> | undefined = options.provider
    ? Promise.resolve(options.provider)
    : undefined
  const getProvider = (): Promise<SandboxProviderV1> => {
    if (!providerPromise) {
      if (options.provider) providerPromise = Promise.resolve(options.provider)
      else if (options.providerFactory) providerPromise = Promise.resolve(options.providerFactory())
      else throw new Error(`Runtime mode "${options.id}" has no pair factory`)
    }
    return providerPromise
  }

  return {
    id: options.id,
    runtimeProvider: options.runtimeProvider,
    runtimeHostPolicy: options.runtimeHostPolicy,
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
    getRuntimeLayoutRoot: (context) => options.resolveRuntimeRoot?.(context)
      ?? options.provider?.resolveRuntimeRoot(context)
      ?? context.workspaceRoot,
    evictCachedRuntime: async ({ workspaceId }) => {
      if (!providerPromise) return
      const provider = await providerPromise
      await provider.invalidate?.({ workspaceId })
    },
    async dispose() {
      if (!providerPromise) return
      const provider = await providerPromise
      await provider.close?.()
    },
    async create(context) {
      await options.preflight?.(context)
      await options.prepare?.(context)
      const provider = await getProvider()
      if (options.runtimeProvider && provider.providerId !== options.runtimeProvider.providerId) {
        throw new Error(
          `Runtime mode "${options.id}" resolved provider "${provider.providerId}"; expected "${options.runtimeProvider.providerId}".`,
        )
      }
      const pair = await provider.create(context)
      try {
        if (
          pair.workspace.root !== pair.workspace.runtimeContext.runtimeCwd
          || pair.workspace.runtimeContext.runtimeCwd !== pair.sandbox.runtimeContext.runtimeCwd
        ) {
          throw new Error(
            `Runtime mode "${options.id}" returned a mismatched Workspace + Sandbox pair.`,
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

export function createDescriptorRuntimeModeAdapter(options: {
  descriptor: SandboxRuntimeModeDescriptorV1
  pairFactoryOptions?: SandboxRuntimePairFactoryOptionsV1
  runtimeHost: AgentRuntimeHostOperations
}): RuntimeModeAdapter {
  const { descriptor, runtimeHost } = options
  const readiness = descriptor.adapter.readiness
  return createProviderRuntimeModeAdapter({
    id: descriptor.id,
    runtimeProvider: descriptor,
    runtimeHostPolicy: descriptor.host,
    providerFactory: () => descriptor.createPairFactory(options.pairFactoryOptions ?? {}),
    resolveRuntimeRoot: (context) => descriptor.resolveRuntimeRoot(context),
    runtimeHost,
    workspaceFsCapability: descriptor.adapter.workspaceFsCapability,
    bash: descriptor.adapter.bash,
    filesystem: descriptor.adapter.filesystem,
    storageRoot: descriptor.adapter.storageRoot === 'workspace-root'
      ? (context) => context.workspaceRoot
      : undefined,
    preflight: descriptor.adapter.requiredPlatform
      ? () => {
          if (process.platform !== descriptor.adapter.requiredPlatform?.platform) {
            throw new Error(descriptor.adapter.requiredPlatform?.message)
          }
        }
      : undefined,
    prepare: descriptor.adapter.prepareWorkspaceTemplateOnHost
      ? async (context) => {
          await mkdir(context.workspaceRoot, { recursive: true })
          await copyTemplate(context.templatePath, context.workspaceRoot)
        }
      : undefined,
    provisioningAdapter: descriptor.adapter.provisioning === 'host-direct'
      ? (context) => createDirectProvisioningAdapter(
          runtimeHost.getBoringAgentRuntimePaths(context.workspaceRoot),
          runtimeHost,
        )
      : descriptor.adapter.provisioning === 'host-local'
        ? (context) => createLocalProvisioningAdapter(
            runtimeHost.getBoringAgentRuntimePaths(context.workspaceRoot),
            runtimeHost,
          )
        : undefined,
    healthCheckIntervalMs: descriptor.adapter.healthCheckIntervalMs,
    readiness: readiness
      ? {
          initialSandboxReady: readiness.initialSandboxReady,
          initialWorkspaceReadiness: readiness.initialWorkspaceReadiness,
          ...(readiness.markSandboxReadyOnTrackerCreated
            ? { onTrackerCreated: (tracker) => { queueMicrotask(() => tracker.markSandboxReady()) } }
            : {}),
        }
      : undefined,
  })
}
