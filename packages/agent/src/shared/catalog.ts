import type { FileSearch } from './file-search'
import type { Sandbox } from './sandbox'
import type { AgentTool } from './tool'
import type { Workspace } from './workspace'

export interface CatalogDeps {
  workspace: Workspace
  sandbox: Sandbox
  fileSearch?: FileSearch
}

export type ToolCatalog = (deps: CatalogDeps) => AgentTool[]
