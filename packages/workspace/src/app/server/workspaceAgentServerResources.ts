import {
  autoDetectMode,
  resolveMode,
  type RuntimeModeAdapter,
  type RuntimeModeId,
} from "@hachej/boring-agent/server"
import type { FastifyInstance } from "fastify"
import type { RuntimeBackendRegistry } from "../../server/runtimeBackend"

export interface WorkspaceAgentServerRuntimePolicyOptions {
  mode?: RuntimeModeId
  runtimeModeAdapter?: RuntimeModeAdapter
  validateUiPaths?: boolean
}

export interface WorkspaceAgentServerRuntimePolicy {
  resolvedMode: RuntimeModeId
  suppliedModeAdapter?: RuntimeModeAdapter
  validateUiPaths?: boolean
}

export interface WorkspaceAgentServerRuntimeResources {
  resolvedMode: RuntimeModeId
  modeAdapter: RuntimeModeAdapter
  workspaceFsCapability: NonNullable<RuntimeModeAdapter["workspaceFsCapability"]>
  validateUiPaths: boolean
  setRuntimeBackendRegistry(registry: RuntimeBackendRegistry): void
  markModeAdapterPassedToAgentApp(): void
  setCreatedApp(app: FastifyInstance): void
  disposeWorkspaceResources(): Promise<void>
  cleanupAfterFailure(): Promise<void>
}

export function resolveWorkspaceAgentServerRuntimePolicy(
  opts: WorkspaceAgentServerRuntimePolicyOptions,
): WorkspaceAgentServerRuntimePolicy {
  const resolvedMode = opts.runtimeModeAdapter?.id ?? opts.mode ?? autoDetectMode()
  if (opts.runtimeModeAdapter && opts.mode && opts.runtimeModeAdapter.id !== opts.mode) {
    throw new Error(`runtimeModeAdapter id ${opts.runtimeModeAdapter.id} does not match explicit mode ${opts.mode}`)
  }
  return {
    resolvedMode,
    ...(opts.runtimeModeAdapter ? { suppliedModeAdapter: opts.runtimeModeAdapter } : {}),
    ...(opts.validateUiPaths !== undefined ? { validateUiPaths: opts.validateUiPaths } : {}),
  }
}

function createOwnedModeAdapter(source: RuntimeModeAdapter): RuntimeModeAdapter {
  let disposal: Promise<void> | undefined
  return {
    id: source.id,
    ...(source.workspaceFsCapability !== undefined ? { workspaceFsCapability: source.workspaceFsCapability } : {}),
    ...(source.readiness !== undefined ? { readiness: source.readiness } : {}),
    ...(source.cachedBindingHealthCheck !== undefined ? { cachedBindingHealthCheck: source.cachedBindingHealthCheck } : {}),
    create: (ctx) => source.create.call(source, ctx),
    ...(source.createProvisioningAdapter
      ? { createProvisioningAdapter: (runtimeLayout, ctx) => source.createProvisioningAdapter!.call(source, runtimeLayout, ctx) }
      : {}),
    ...(source.getRuntimeLayoutRoot
      ? { getRuntimeLayoutRoot: (ctx) => source.getRuntimeLayoutRoot!.call(source, ctx) }
      : {}),
    ...(source.evictCachedRuntime
      ? { evictCachedRuntime: (ctx) => source.evictCachedRuntime!.call(source, ctx) }
      : {}),
    dispose: async () => {
      disposal ??= (async () => {
        await source.dispose?.call(source)
      })()
      return disposal
    },
  }
}

export function createWorkspaceAgentServerRuntimeResources(
  policy: WorkspaceAgentServerRuntimePolicy,
  unregisterUiBridge: () => void,
): WorkspaceAgentServerRuntimeResources {
  const underlyingModeAdapter = policy.suppliedModeAdapter ?? resolveMode(policy.resolvedMode)
  const modeAdapter = createOwnedModeAdapter(underlyingModeAdapter)
  const workspaceFsCapability = modeAdapter.workspaceFsCapability ?? "best-effort"
  const validateUiPaths = policy.validateUiPaths ?? workspaceFsCapability === "strong"

  let runtimeBackendRegistry: RuntimeBackendRegistry | undefined
  let createdApp: FastifyInstance | undefined
  let workspaceResourcesDisposed: Promise<void> | undefined
  let modeAdapterPassedToAgentApp = false

  async function disposeModeAdapterOnce(): Promise<void> {
    await modeAdapter.dispose?.()
  }

  async function disposeWorkspaceResources(): Promise<void> {
    workspaceResourcesDisposed ??= (async () => {
      try {
        await runtimeBackendRegistry?.close()
      } finally {
        unregisterUiBridge()
      }
    })()
    await workspaceResourcesDisposed
  }

  async function cleanupAfterFailure(): Promise<void> {
    if (createdApp) {
      await createdApp.close().catch(() => undefined)
      await disposeWorkspaceResources().catch(() => undefined)
      await disposeModeAdapterOnce().catch(() => undefined)
      return
    }

    await disposeWorkspaceResources().catch(() => undefined)
    // Before createAgentApp receives the adapter, this composer is the sole
    // adapter owner. After handoff, createAgentApp is expected to dispose it;
    // this fallback still calls the same exact-once owner to cover partial
    // failures and mocked app-creation failures without leaking or double-disposing.
    if (!modeAdapterPassedToAgentApp) {
      await disposeModeAdapterOnce().catch(() => undefined)
      return
    }
    await disposeModeAdapterOnce().catch(() => undefined)
  }

  return {
    resolvedMode: policy.resolvedMode,
    modeAdapter,
    workspaceFsCapability,
    validateUiPaths,
    setRuntimeBackendRegistry(registry) {
      runtimeBackendRegistry = registry
    },
    markModeAdapterPassedToAgentApp() {
      modeAdapterPassedToAgentApp = true
    },
    setCreatedApp(app) {
      createdApp = app
    },
    disposeWorkspaceResources,
    cleanupAfterFailure,
  }
}
