import { PROVIDER_CAPABILITIES } from '../../shared/providerMatrix'
import { REMOTE_WORKER_RUNTIME_CWD } from '../../shared/remoteWorkerProtocolV1'
import type { SandboxRuntimeModeDescriptorV1 } from '../../shared/runtimeDescriptor'
import { SandboxProviderError } from '../../shared/providerV1'
import { REMOTE_WORKER_ERROR_CODES_V1 } from '../../shared/remoteWorkerProtocolV1'
import type { RemoteWorkerSandboxProviderOptionsV1 } from './createRemoteWorkerProvider'

export function createRemoteWorkerRuntimeDescriptor(
  providerOptions?: RemoteWorkerSandboxProviderOptionsV1,
): SandboxRuntimeModeDescriptorV1 {
  return Object.freeze({
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
    async createPairFactory() {
      if (
        !providerOptions
        || typeof providerOptions.capabilityIssuer?.issueCapability !== 'function'
        || typeof providerOptions.bindingReceiptVerifier?.verifyBindingReceipt !== 'function'
        || typeof providerOptions.transport?.request !== 'function'
        || typeof providerOptions.transport?.openEventStream !== 'function'
      ) {
        throw new SandboxProviderError(
          REMOTE_WORKER_ERROR_CODES_V1.configInvalid,
          'remote-worker V1 provider options are required and must be complete',
        )
      }
      const { createRemoteWorkerSandboxProviderV1 } = await import('./createRemoteWorkerProvider')
      return createRemoteWorkerSandboxProviderV1(providerOptions)
    },
  } satisfies SandboxRuntimeModeDescriptorV1)
}

/** Canonical registry entry: V1-only, production-unsafe, and unconfigured. */
export const remoteWorkerRuntimeDescriptor = createRemoteWorkerRuntimeDescriptor()
