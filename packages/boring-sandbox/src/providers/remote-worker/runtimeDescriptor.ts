import { PROVIDER_CAPABILITIES } from '../../shared/providerMatrix'
import { REMOTE_WORKER_RUNTIME_CWD } from '../../shared/remoteWorkerProtocolV1'
import type { SandboxRuntimeModeDescriptorV1 } from '../../shared/runtimeDescriptor'
import { SandboxProviderError } from '../../shared/providerV1'
import { REMOTE_WORKER_ERROR_CODES_V1 } from '../../shared/remoteWorkerProtocolV1'
import type { RemoteWorkerSandboxProviderOptionsV1 } from './createRemoteWorkerProvider'

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
    const providerOptions = options.providerOptions
    if (
      !providerOptions
      || typeof providerOptions !== 'object'
      || typeof (providerOptions as RemoteWorkerSandboxProviderOptionsV1).capabilityIssuer?.issueCapability !== 'function'
      || typeof (providerOptions as RemoteWorkerSandboxProviderOptionsV1).bindingReceiptVerifier?.verifyBindingReceipt !== 'function'
      || typeof (providerOptions as RemoteWorkerSandboxProviderOptionsV1).transport?.request !== 'function'
    ) {
      throw new SandboxProviderError(
        REMOTE_WORKER_ERROR_CODES_V1.configInvalid,
        'remote-worker V1 provider options are required and must be complete',
      )
    }
    const { createRemoteWorkerSandboxProviderV1 } = await import('./createRemoteWorkerProvider')
    return createRemoteWorkerSandboxProviderV1(
      providerOptions as RemoteWorkerSandboxProviderOptionsV1,
    )
  },
} satisfies SandboxRuntimeModeDescriptorV1)
