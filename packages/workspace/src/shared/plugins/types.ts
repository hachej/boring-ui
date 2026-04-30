import type { AgentTool } from "@boring/agent/shared"
import type { ExplorerAdapter, ExplorerRow } from "../types/explorer"
import type { PanelConfig, CommandConfig } from "../types/panel"

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
