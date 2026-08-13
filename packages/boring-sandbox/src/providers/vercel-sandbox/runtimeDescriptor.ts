import { PROVIDER_CAPABILITIES } from '../../shared/providerMatrix'
import type {
  SandboxRuntimeModeDescriptorV1,
  SandboxRuntimeRemotePathOptionsV1,
} from '../../shared/runtimeDescriptor'

const VERCEL_BINDING_HEALTHCHECK_INTERVAL_MS = 15_000
const VERCEL_SAFE_DEFAULT_PATH = '/vercel/runtimes/node24/bin:/vercel/runtimes/node22/bin:/usr/local/bin:/usr/bin:/bin'
const VERCEL_SANDBOX_REMOTE_ROOT = '/vercel/sandbox'
const VERCEL_SANDBOX_WORKSPACE_ROOT = '/workspace'

function vercelRemoteWorkspacePathOptions(): SandboxRuntimeRemotePathOptionsV1 {
  const remoteRoot = VERCEL_SANDBOX_REMOTE_ROOT
  const workspaceRoot = VERCEL_SANDBOX_WORKSPACE_ROOT
  return {
    rootAliases: [remoteRoot, '/vercel/sandbox'],
    toRemotePath(value) {
      if (value === workspaceRoot) return remoteRoot
      if (value.startsWith(`${workspaceRoot}/`)) {
        return `${remoteRoot}${value.slice(workspaceRoot.length)}`
      }
      if (value === '/vercel/sandbox') return remoteRoot
      if (value.startsWith('/vercel/sandbox/')) {
        return `${remoteRoot}${value.slice('/vercel/sandbox'.length)}`
      }
      return value
    },
    toRuntimePath(value) {
      if (value === remoteRoot) return workspaceRoot
      if (value.startsWith(`${remoteRoot}/`)) {
        return `${workspaceRoot}${value.slice(remoteRoot.length)}`
      }
      if (value === '/vercel/sandbox') return workspaceRoot
      if (value.startsWith('/vercel/sandbox/')) {
        return `${workspaceRoot}${value.slice('/vercel/sandbox'.length)}`
      }
      return value
    },
    sanitizeErrorText(value) {
      return value.replaceAll('/vercel/sandbox', workspaceRoot)
    },
  }
}

export const vercelSandboxRuntimeDescriptor = Object.freeze({
  id: 'vercel-sandbox',
  providerId: 'vercel-sandbox',
  pair: {
    workspaceProviderId: 'vercel-sandbox',
    sandboxProviderId: 'vercel-sandbox',
  },
  capabilities: PROVIDER_CAPABILITIES['vercel-sandbox'],
  errorCodeNamespace: 'VERCEL',
  adapter: {
    workspaceFsCapability: 'best-effort',
    bash: { kind: 'remote', defaultPath: VERCEL_SAFE_DEFAULT_PATH },
    filesystem: {
      kind: 'remote-workspace',
      pathOptions: vercelRemoteWorkspacePathOptions(),
    },
    storageRoot: 'none',
    provisioning: 'pair',
    healthCheckIntervalMs: VERCEL_BINDING_HEALTHCHECK_INTERVAL_MS,
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
    resolveCompanyContextFromHostWorkspace: false,
    httpWorkspaceScope: 'default',
    sandboxHandle: {
      provider: 'vercel',
      defaultPersistenceMode: 'ephemeral',
    },
  },
  resolveRuntimeRoot() {
    return VERCEL_SANDBOX_WORKSPACE_ROOT
  },
  async createPairFactory(options) {
    const { createVercelSandboxProvider } = await import('./createVercelSandboxProvider')
    const providerOptions = options.providerOptions as Record<string, unknown> | undefined
    return createVercelSandboxProvider({
      ...providerOptions,
      ...(options.sandboxHandleStore
        ? { store: options.sandboxHandleStore, orphanGuardMaxIdleMs: null }
        : {}),
    })
  },
} satisfies SandboxRuntimeModeDescriptorV1)
