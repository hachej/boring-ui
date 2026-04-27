import type { FileSearch } from '../../shared/file-search'
import type { Sandbox } from '../../shared/sandbox'
import type { Workspace } from '../../shared/workspace'

export type RuntimeModeId = 'direct' | 'local' | 'vercel-sandbox'

export interface RuntimeModeAdapter {
  readonly id: RuntimeModeId
  create(ctx: ModeContext): Promise<RuntimeBundle>
}

export interface ModeContext {
  workspaceRoot: string
  sessionId: string
  templatePath?: string
}

export interface RuntimeBundle {
  workspace: Workspace
  sandbox: Sandbox
  fileSearch: FileSearch
}
