import { PROVIDER_CAPABILITIES } from '../../shared/providerMatrix'
import type { SandboxRuntimeModeDescriptorV1 } from '../../shared/runtimeDescriptor'

export const directRuntimeDescriptor = Object.freeze({
  id: 'direct',
  providerId: 'direct',
  pair: {
    workspaceProviderId: 'node-workspace',
    sandboxProviderId: 'direct',
  },
  capabilities: PROVIDER_CAPABILITIES.direct,
  errorCodeNamespace: 'DIRECT',
  adapter: {
    workspaceFsCapability: 'strong',
    bash: { kind: 'host', preserveHostHome: true },
    filesystem: { kind: 'host' },
    storageRoot: 'workspace-root',
    prepareWorkspaceTemplateOnHost: true,
    provisioning: 'host-direct',
  },
  host: {
    productionSafe: false,
    inferSiblingSessionRoot: false,
    allowPiExtensions: true,
    loadWorkspacePiResources: true,
    includePluginAuthoringProvisioning: false,
    resolveCompanyContextFromHostWorkspace: true,
    httpWorkspaceScope: 'default',
  },
  resolveRuntimeRoot(context) {
    return context.workspaceRoot
  },
  async createPairFactory(options) {
    const { createDirectSandboxProvider } = await import('./createDirectProvider')
    return createDirectSandboxProvider(options.providerOptions as never)
  },
} satisfies SandboxRuntimeModeDescriptorV1)
