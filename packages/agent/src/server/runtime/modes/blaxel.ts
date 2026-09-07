import type { SandboxProviderV1 } from '@hachej/boring-sandbox/shared'

import type { AgentRuntimeHostOperations } from '../runtimeHost'
import { createProviderRuntimeModeAdapter } from './providerAdapter'

export function createBlaxelSandboxModeAdapter(options: {
  provider: SandboxProviderV1
  runtimeHost: AgentRuntimeHostOperations
}) {
  return createProviderRuntimeModeAdapter({
    id: 'blaxel',
    provider: options.provider,
    runtimeHost: options.runtimeHost,
    workspaceFsCapability: 'best-effort',
    bash: { kind: 'remote' },
    filesystem: { kind: 'remote-workspace' },
    readiness: {
      initialSandboxReady: false,
      initialWorkspaceReadiness: { state: 'preparing' },
      onTrackerCreated: (tracker) => { queueMicrotask(() => tracker.markSandboxReady()) },
    },
  })
}
