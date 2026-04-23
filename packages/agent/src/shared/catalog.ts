import type { Sandbox } from './sandbox'
import type { AgentTool } from './tool'
import type { Workspace } from './workspace'

// Dedicated UiBridge and FileSearch contracts land in their own interface beads.
// Keep them opaque here so CatalogDeps can be locked without cross-bead coupling.
export interface UiBridge {}

export interface FileSearch {}

export interface CatalogDeps {
  workspace: Workspace
  sandbox: Sandbox
  uiBridge?: UiBridge
  fileSearch?: FileSearch
}

export type ToolCatalog = (deps: CatalogDeps) => AgentTool[]

export const standardCatalog: ToolCatalog = ({ workspace, sandbox }) => {
  void workspace
  void sandbox

  return []
}
