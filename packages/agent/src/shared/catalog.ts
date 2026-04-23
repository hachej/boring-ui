import type { FileSearch } from './file-search'
import type { Sandbox } from './sandbox'
import type { AgentTool } from './tool'
import type { Workspace } from './workspace'

export interface UiBridge {}

export interface CatalogDeps {
  workspace: Workspace
  sandbox: Sandbox
  uiBridge?: UiBridge
  fileSearch?: FileSearch
}

export type ToolCatalog = (deps: CatalogDeps) => AgentTool[]
