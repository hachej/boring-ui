import { mkdir } from 'node:fs/promises'

import type { SandboxProviderV1 } from '@hachej/boring-sandbox/shared'

import { copyTemplate } from '../../workspace/provision'
import type { AgentRuntimeHostOperations } from '../runtimeHost'
import { createDirectProvisioningAdapter } from './provisioningAdapter'
import { createProviderRuntimeModeAdapter } from './providerAdapter'

export function createDirectModeAdapter(options: {
  provider: SandboxProviderV1
  runtimeHost: AgentRuntimeHostOperations
}) {
  return createProviderRuntimeModeAdapter({
    id: 'direct',
    provider: options.provider,
    runtimeHost: options.runtimeHost,
    workspaceFsCapability: 'strong',
    bash: { kind: 'host', preserveHostHome: true },
    filesystem: { kind: 'host' },
    storageRoot: (context) => context.workspaceRoot,
    prepare: async (context) => {
      await mkdir(context.workspaceRoot, { recursive: true })
      await copyTemplate(context.templatePath, context.workspaceRoot)
    },
    provisioningAdapter: (context) => createDirectProvisioningAdapter(
      options.runtimeHost.getBoringAgentRuntimePaths(context.workspaceRoot),
      options.runtimeHost,
    ),
  })
}
