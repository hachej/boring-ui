import type { ComponentType } from "react"
import type { AgentTool } from "@boring/agent/shared"
import type { ExplorerAdapter, ExplorerRow } from "../../front/components/DataExplorer/types"
import type { PanelConfig } from "../../front/registry/types"
import type { CommandConfig } from "../../front/registry/types"

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
  /**
   * Context prepended to the agent's system prompt at boot. Concatenated
   * across all registered plugins (in registration order) and joined with
   * double-newlines. Plain Markdown. ~200-500 chars recommended.
   */
  systemPrompt?: string
  panels?: PanelConfig[]
  commands?: CommandConfig[]
  catalogs?: CatalogConfig[]
  agentTools?: AgentTool[]
}
