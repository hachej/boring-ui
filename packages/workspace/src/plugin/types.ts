import type { ComponentType } from "react"
import type { AgentTool } from "@boring/agent/shared"
import type { ExplorerAdapter, ExplorerRow } from "../components/DataExplorer/types"
import type { PanelConfig } from "../registry/types"
import type { CommandConfig } from "../registry/types"

export interface CatalogConfig {
  id: string
  label: string
  adapter: ExplorerAdapter
  onSelect: (row: ExplorerRow) => void
  pluginId?: string
}

export interface Plugin {
  id: string
  label?: string
  panels?: PanelConfig[]
  commands?: CommandConfig[]
  catalogs?: CatalogConfig[]
  agentTools?: AgentTool[]
}
