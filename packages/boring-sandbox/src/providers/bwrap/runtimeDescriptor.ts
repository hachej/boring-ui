import { PROVIDER_CAPABILITIES } from '../../shared/providerMatrix'
import type { SandboxRuntimeModeDescriptorV1 } from '../../shared/runtimeDescriptor'
import type { BwrapSandboxProviderOptions } from './createBwrapProvider'

export function createLocalRuntimeDescriptor(
  providerOptions: BwrapSandboxProviderOptions = {},
): SandboxRuntimeModeDescriptorV1 {
  return Object.freeze({
    id: 'local',
    providerId: 'bwrap',
    pair: {
      workspaceProviderId: 'node-workspace',
      sandboxProviderId: 'bwrap',
    },
    capabilities: PROVIDER_CAPABILITIES.bwrap,
    errorCodeNamespace: 'BWRAP',
    adapter: {
      workspaceFsCapability: 'strong',
      bash: { kind: 'local-sandbox', sandboxRoot: '/workspace' },
      filesystem: { kind: 'host' },
      storageRoot: 'workspace-root',
      prepareWorkspaceTemplateOnHost: true,
      provisioning: 'host-local',
      requiredPlatform: {
        platform: 'linux',
        message: 'local mode requires Linux with bubblewrap',
      },
    },
    host: {
      productionSafe: false,
      inferSiblingSessionRoot: false,
      allowPiExtensions: true,
      loadWorkspacePiResources: true,
      includePluginAuthoringProvisioning: true,
      resolveCompanyContextFromHostWorkspace: true,
      httpWorkspaceScope: 'default',
    },
    resolveRuntimeRoot() {
      return '/workspace'
    },
    async createPairFactory() {
      const { createBwrapSandboxProvider } = await import('./createBwrapProvider')
      return createBwrapSandboxProvider(providerOptions)
    },
  } satisfies SandboxRuntimeModeDescriptorV1)
}

export const localRuntimeDescriptor = createLocalRuntimeDescriptor()
