import { mkdir } from 'node:fs/promises'

import type { SandboxProviderV1 } from '@hachej/boring-sandbox/shared'

import { copyTemplate } from '../../workspace/provision'
import type { AgentRuntimeHostOperations } from '../runtimeHost'
import { createLocalProvisioningAdapter } from './provisioningAdapter'
import { createProviderRuntimeModeAdapter } from './providerAdapter'

export function createLocalModeAdapter(options: {
  provider: SandboxProviderV1
  runtimeHost: AgentRuntimeHostOperations
}) {
  return createProviderRuntimeModeAdapter({
    id: 'local',
    provider: options.provider,
    runtimeHost: options.runtimeHost,
    workspaceFsCapability: 'strong',
    bash: { kind: 'local-sandbox', sandboxRoot: '/workspace' },
    filesystem: { kind: 'host' },
    storageRoot: (context) => context.workspaceRoot,
    preflight: () => {
      if (process.platform !== 'linux') {
        throw new Error('local mode requires Linux with bubblewrap')
      }
    },
    prepare: async (context) => {
      await mkdir(context.workspaceRoot, { recursive: true })
      await copyTemplate(context.templatePath, context.workspaceRoot)
    },
    provisioningAdapter: (context) => createLocalProvisioningAdapter(
      options.runtimeHost.getBoringAgentRuntimePaths(context.workspaceRoot),
      options.runtimeHost,
    ),
  })
}
