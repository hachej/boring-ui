import type {
  RuntimeFilesystemBinding,
  RuntimeHostOperations,
} from '@hachej/boring-bash/agent'
import type { BwrapArgsOptions } from '@hachej/boring-sandbox/providers/bwrap'
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
  /**
   * Agent legally depends on the provider package, so the injected builder is
   * typed with the canonical options here rather than the narrowed slice
   * boring-bash declares.
   */
  buildBwrapArgs(workspaceRoot: string, options?: BwrapArgsOptions): string[]
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
  resolveRealWorkspacePath(root: string, targetPath: string): Promise<string>
  isIgnoredDirName(name: string): boolean
  /** Host-owned confined projection for package resources outside the workspace. */
  createAgentResourceFilesystemBinding(
    filesystem: string,
    mounts: readonly { readonly logicalRoot: string; readonly sourceRoot: string }[],
  ): Promise<RuntimeFilesystemBinding>
}
