import { PROVIDER_CAPABILITIES } from '../../shared/providerMatrix'
import { REMOTE_WORKER_RUNTIME_CWD } from '../../shared/remoteWorkerProtocolV1'
import type { SandboxRuntimeModeDescriptorV1 } from '../../shared/runtimeDescriptor'
import type { RemoteWorkerSandboxProviderOptionsV1 } from './createRemoteWorkerProvider'
import type { LegacyRemoteWorkerProviderOptions } from './createLegacyRemoteWorkerProvider'

export const remoteWorkerRuntimeDescriptor = Object.freeze({
  id: 'remote-worker',
  providerId: 'remote-worker',
  pair: {
    workspaceProviderId: 'remote-worker',
    sandboxProviderId: 'remote-worker',
    isolationProviderId: 'runsc',
  },
  capabilities: PROVIDER_CAPABILITIES['remote-worker'],
  errorCodeNamespace: 'REMOTE_WORKER',
  adapter: {
    workspaceFsCapability: 'best-effort',
    bash: { kind: 'remote' },
    filesystem: { kind: 'remote-workspace' },
    storageRoot: 'none',
    provisioning: 'pair',
  },
  host: {
    productionSafe: false,
    inferSiblingSessionRoot: false,
    allowPiExtensions: true,
    loadWorkspacePiResources: false,
    includePluginAuthoringProvisioning: true,
    resolveCompanyContextFromHostWorkspace: true,
    httpWorkspaceScope: 'session',
  },
  resolveRuntimeRoot() {
    return REMOTE_WORKER_RUNTIME_CWD
  },
  async createPairFactory(options) {
    const providerOptions = options.providerOptions as
      | RemoteWorkerSandboxProviderOptionsV1
      | LegacyRemoteWorkerProviderOptions
      | undefined
    if (providerOptions && 'fleet' in providerOptions) {
      const { createRemoteWorkerSandboxProviderV1 } = await import('./createRemoteWorkerProvider')
      return createRemoteWorkerSandboxProviderV1(
        providerOptions as RemoteWorkerSandboxProviderOptionsV1,
      )
    }
    const { createLegacyRemoteWorkerSandboxProvider } = await import('./createLegacyRemoteWorkerProvider')
    return createLegacyRemoteWorkerSandboxProvider(providerOptions as LegacyRemoteWorkerProviderOptions)
  },
} satisfies SandboxRuntimeModeDescriptorV1)
