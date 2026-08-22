import { PROVIDER_CAPABILITIES } from '../../shared/providerMatrix'
import type { SandboxRuntimeModeDescriptorV1 } from '../../shared/runtimeDescriptor'
import {
  BLAXEL_WORKSPACE_ROOT,
  type BlaxelSandboxProviderOptions,
} from './config'

export function createBlaxelRuntimeDescriptor(
  providerOptions: BlaxelSandboxProviderOptions = {},
): SandboxRuntimeModeDescriptorV1 {
  return Object.freeze({
    id: 'blaxel',
    providerId: 'blaxel',
    pair: {
      workspaceProviderId: 'blaxel',
      sandboxProviderId: 'blaxel',
    },
    capabilities: PROVIDER_CAPABILITIES.blaxel,
    errorCodeNamespace: 'BLAXEL',
    adapter: {
      workspaceFsCapability: 'best-effort',
      bash: { kind: 'remote' },
      filesystem: { kind: 'remote-workspace' },
      storageRoot: 'none',
      provisioning: 'pair',
      readiness: {
        initialSandboxReady: false,
        initialWorkspaceReadiness: { state: 'preparing' },
        markSandboxReadyOnTrackerCreated: true,
      },
    },
    host: {
      productionSafe: true,
      inferSiblingSessionRoot: true,
      allowPiExtensions: false,
      loadWorkspacePiResources: true,
      includePluginAuthoringProvisioning: true,
      resolveCompanyContextFromHostWorkspace: true,
      httpWorkspaceScope: 'default',
      sandboxHandle: {
        provider: 'blaxel',
        defaultPersistenceMode: 'persistent',
      },
    },
    resolveRuntimeRoot() {
      return BLAXEL_WORKSPACE_ROOT
    },
    async createPairFactory(options) {
      const { createBlaxelSandboxProvider } = await import('./createBlaxelSandboxProvider')
      return createBlaxelSandboxProvider({
        ...providerOptions,
        ...(options.sandboxHandleStore ? { handleStore: options.sandboxHandleStore } : {}),
      })
    },
  } satisfies SandboxRuntimeModeDescriptorV1)
}

export const blaxelRuntimeDescriptor = createBlaxelRuntimeDescriptor()
