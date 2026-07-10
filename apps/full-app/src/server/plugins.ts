import type { CoreWorkspaceAgentServerPlugin } from '@hachej/boring-core/app/server'
import { createFullAppBoringMcpServerPlugins } from './boringMcp.js'

export function createFullAppServerPlugins(extra: CoreWorkspaceAgentServerPlugin[] = []): CoreWorkspaceAgentServerPlugin[] {
  return [
    ...createFullAppBoringMcpServerPlugins(),
    ...extra,
  ]
}

export const serverPlugins = createFullAppServerPlugins()
