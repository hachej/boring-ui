import type { RuntimeHostOperations } from '@hachej/boring-bash/agent'
import type {
  BoringAgentRuntimePaths,
  CreateNodeWorkspaceOptions,
} from '@hachej/boring-sandbox/providers/node-workspace'

import type { Workspace } from '../../shared/workspace'

/**
 * Host-owned values used by Agent's provider-neutral runtime composition.
 *
 * Built-in concrete operations live in `sandboxRuntimeHost.ts`; custom hosts
 * may inject an equivalent implementation with their Workspace + Sandbox pair.
 */
export interface AgentRuntimeHostOperations extends RuntimeHostOperations {
  createNodeWorkspace(root: string, options?: CreateNodeWorkspaceOptions): Workspace
  getNodeWorkspaceHostRoot(workspace: Workspace): string | undefined
  getBoringAgentRuntimePaths(workspaceRoot: string): BoringAgentRuntimePaths
  getBoringAgentRuntimeEnv(
    paths: BoringAgentRuntimePaths,
    cacheRoot?: string,
  ): Record<string, string>
  getBoringAgentPathEntries(paths: BoringAgentRuntimePaths): string[]
  readonly runtimeLayout: Readonly<{
    agentDir: string
    runtimeDirNames: readonly string[]
    gitignoreContent: string
  }>
  validatePath(root: string, requestedPath: string): string
  assertRealPathWithinWorkspace(root: string, targetPath: string): Promise<void>
  isIgnoredDirName(name: string): boolean
}
