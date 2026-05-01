import type { ComponentType, ReactNode } from "react"
import type {
  AgentTool,
  JSONSchema,
  ToolExecContext,
  ToolResult,
} from "../types/agent-tool"
import type { ExplorerAdapter, ExplorerRow } from "../types/explorer"
import type { CommandConfig, PaneProps, PanelConfig } from "../types/panel"
import type { SurfaceResolverConfig } from "../types/surface"

export type {
  AgentTool,
  JSONSchema,
  ToolExecContext,
  ToolResult,
} from "../types/agent-tool"

export type PluginBinding = ComponentType<unknown>

export interface PluginProviderProps {
  apiBaseUrl: string
  authHeaders?: Record<string, string>
  onAuthError?: (statusCode: number) => void
  apiTimeout?: number
  children: ReactNode
}

export type PluginProvider = ComponentType<PluginProviderProps>

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

export interface PanelOutput<T = any> {
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

export interface ProviderOutput {
  type: "provider"
  id: string
  component: PluginProvider
}

export interface SurfaceResolverOutput {
  type: "surface-resolver"
  resolver: SurfaceResolverConfig
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
  | ProviderOutput
  | SurfaceResolverOutput
  | AgentToolOutput

export type LeftTabComponent = ComponentType<PaneProps<LeftTabParams>>
