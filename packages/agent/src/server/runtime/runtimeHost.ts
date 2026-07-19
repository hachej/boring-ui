import type { BwrapArgsOptions } from '@hachej/boring-sandbox/providers/bwrap'
import type {
  BoringAgentRuntimePaths,
  CreateNodeWorkspaceOptions,
  WorkspacePythonEnvOptions,
} from '@hachej/boring-sandbox/providers/node-workspace'

import type { Workspace } from '../../shared/workspace'

/**
 * Host-owned values used by Agent's provider-neutral runtime composition.
 *
 * The concrete implementation lives outside packages/agent/src so Agent can
 * consume an injected Workspace + Sandbox pair without importing provider
 * runtime values.
 */
export interface AgentRuntimeHostOperations {
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
  buildBwrapArgs(workspaceRoot: string, options?: BwrapArgsOptions): string[]
  withWorkspacePythonEnv(input: WorkspacePythonEnvOptions): Record<string, string | undefined>
}
