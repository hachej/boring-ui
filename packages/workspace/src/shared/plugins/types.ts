import type { AgentTool } from "@boring/agent/shared"
import type { ComponentType } from "react"
import type { ExplorerAdapter, ExplorerRow } from "../types/explorer"
import type { CommandConfig, PaneProps, PanelConfig } from "../types/panel"

export type PluginBinding = ComponentType<unknown>

export interface CatalogConfig {
  id: string
  label: string
  adapter: ExplorerAdapter
  onSelect: (row: ExplorerRow) => void
  pluginId?: string
}

export interface LeftTabParams {
  rootDir?: string
  query?: string
  searchQuery?: string
  bridge?: unknown
  chromeless?: boolean
}

export interface LeftTabOutput<T = LeftTabParams> {
  type: "left-tab"
  id: string
  title: string
  icon?: PanelConfig<T>["icon"]
  component: PanelConfig<T>["component"]
  lazy?: PanelConfig<T>["lazy"]
  requiresCapabilities?: PanelConfig<T>["requiresCapabilities"]
  source?: PanelConfig<T>["source"]
  chromeless?: PanelConfig<T>["chromeless"]
}

export interface PanelOutput<T = unknown> {
  type: "panel"
  panel: PanelConfig<T>
}

export interface CommandOutput {
  type: "command"
  command: CommandConfig
}

export interface CatalogOutput {
  type: "catalog"
  catalog: CatalogConfig
}

export interface BindingOutput {
  type: "binding"
  id: string
  component: PluginBinding
}

export interface AgentToolOutput {
  type: "agent-tool"
  id: string
  tool: AgentTool
}

export type PluginOutput =
  | LeftTabOutput
  | PanelOutput
  | CommandOutput
  | CatalogOutput
  | BindingOutput
  | AgentToolOutput

export type LeftTabComponent = ComponentType<PaneProps<LeftTabParams>>

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
  bindings?: PluginBinding[]
  agentTools?: AgentTool[]
  outputs?: PluginOutput[]
}
