import type { FileSearch } from '../../shared/file-search'
import type { WorkspaceRuntimeContext } from '../../shared/runtime'
import type { Sandbox } from '../../shared/sandbox'
import type { Workspace } from '../../shared/workspace'
import { getNodeWorkspaceHostRoot } from '../workspace/createNodeWorkspace'

export type BuiltinRuntimeModeId = 'direct' | 'local' | 'vercel-sandbox'
export type RuntimeModeId = BuiltinRuntimeModeId | (string & {})

export interface RuntimeModeAdapter {
  readonly id: RuntimeModeId
  /**
   * Declares whether the workspace files are strongly available on the host
   * path before create() runs. Composition layers use this to decide whether
   * host-side fs checks/prompts are safe without hard-coding sandbox IDs.
   */
  readonly workspaceFsCapability?: Workspace['fsCapability']
  create(ctx: ModeContext): Promise<RuntimeBundle>
  dispose?(): Promise<void>
}

export interface ModeContext {
  workspaceRoot: string
  sessionId: string
  workspaceId?: string
  templatePath?: string
}

export interface RuntimeBundle {
  runtimeContext: WorkspaceRuntimeContext
  /**
   * Server-private host/storage root for host-side filesystem work. Do not use
   * this as the agent-visible cwd; Workspace.root remains the public runtime
   * namespace shown to tools/model.
   */
  storageRoot?: string
  workspace: Workspace
  sandbox: Sandbox
  fileSearch: FileSearch
}

export function getRuntimeBundleStorageRoot(bundle: RuntimeBundle): string {
  return bundle.storageRoot ?? getNodeWorkspaceHostRoot(bundle.workspace) ?? bundle.workspace.root
}
