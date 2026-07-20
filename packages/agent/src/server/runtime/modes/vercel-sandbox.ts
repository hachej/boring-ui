import type { SandboxProviderV1 } from '@hachej/boring-sandbox/shared'

import type { RuntimeRemoteWorkspacePathOptions } from '../mode'
import type { AgentRuntimeHostOperations } from '../runtimeHost'
import { createProviderRuntimeModeAdapter } from './providerAdapter'

const VERCEL_BINDING_HEALTHCHECK_INTERVAL_MS = 15_000
const VERCEL_SAFE_DEFAULT_PATH = '/vercel/runtimes/node24/bin:/vercel/runtimes/node22/bin:/usr/local/bin:/usr/bin:/bin'

function vercelRemoteWorkspacePathOptions(options: {
  remoteRoot: string
  workspaceRoot: string
}): RuntimeRemoteWorkspacePathOptions {
  const { remoteRoot, workspaceRoot } = options
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

export function createVercelSandboxModeAdapter(options: {
  provider: SandboxProviderV1
  runtimeHost: AgentRuntimeHostOperations
  remoteRoot: string
  workspaceRoot: string
}) {
  return createProviderRuntimeModeAdapter({
    id: 'vercel-sandbox',
    provider: options.provider,
    runtimeHost: options.runtimeHost,
    workspaceFsCapability: 'best-effort',
    bash: { kind: 'remote', defaultPath: VERCEL_SAFE_DEFAULT_PATH },
    filesystem: {
      kind: 'remote-workspace',
      pathOptions: vercelRemoteWorkspacePathOptions(options),
    },
    healthCheckIntervalMs: VERCEL_BINDING_HEALTHCHECK_INTERVAL_MS,
    readiness: {
      initialSandboxReady: false,
      initialWorkspaceReadiness: { state: 'preparing' },
      onTrackerCreated: (tracker) => { queueMicrotask(() => tracker.markSandboxReady()) },
    },
  })
}
