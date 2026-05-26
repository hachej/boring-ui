import type { FileSearch } from '../../shared/file-search'
import type { Sandbox } from '../../shared/sandbox'
import type { TelemetrySink } from '../../shared/telemetry'
import type { Workspace } from '../../shared/workspace'
import type { BoringAgentRuntimePaths } from '../workspace/runtimeLayout'
import type { WorkspaceProvisioningAdapter } from '../workspace/provisioning'

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
  createProvisioningAdapter?(runtimeLayout: BoringAgentRuntimePaths, ctx?: ModeContext): WorkspaceProvisioningAdapter
  dispose?(): Promise<void>
}

export interface ModeContext {
  workspaceRoot: string
  sessionId: string
  workspaceId?: string
  templatePath?: string
  requestId?: string
  telemetry?: TelemetrySink
}

export interface RuntimeBundle {
  workspace: Workspace
  sandbox: Sandbox
  fileSearch: FileSearch
}
