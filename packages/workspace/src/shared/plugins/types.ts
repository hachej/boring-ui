import type { ComponentType, ReactNode } from "react"
import type {
  AgentTool,
  JSONSchema,
  ToolExecContext,
  ToolResult,
} from "../types/agent-tool"
import type { CommandConfig, PaneProps, PanelConfig } from "../types/panel"
import type { SurfaceResolverConfig } from "../types/surface"

export type {
  AgentTool,
  JSONSchema,
  ToolExecContext,
  ToolResult,
} from "../types/agent-tool"


export type CatalogBadge = {
  /** 1–4 char mono code rendered as a chip. */
  code: string
  tooltip?: string
}

export type CatalogRow = {
  id: string
  title: string
  subtitle?: string
  group?: string
  leading?: CatalogBadge
  trailing?: CatalogBadge[]
  meta?: string
}

export type CatalogFacetValue = { value: string; count: number }
export type CatalogFacets = Record<string, CatalogFacetValue[]>

export type CatalogFacetConfig = {
  key: string
  label: string
  order?: string[]
  formatValue?: (value: string) => string
}

export type CatalogSearchArgs = {
  query: string
  filters: Record<string, string[]>
  group?: { key: string; value: string }
  limit: number
  offset: number
  signal?: AbortSignal
}

export type CatalogSearchResult = {
  items: CatalogRow[]
  total: number
  hasMore: boolean
}

export type CatalogFacetsArgs = {
  filters: Record<string, string[]>
  signal?: AbortSignal
}

export type CatalogAdapter = {
  search(args: CatalogSearchArgs): Promise<CatalogSearchResult>
  fetchFacets?(args: CatalogFacetsArgs): Promise<CatalogFacets>
}

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
  adapter: CatalogAdapter
  onSelect: (row: CatalogRow) => void
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

export type PluginOutput =
  | LeftTabOutput
  | PanelOutput
  | CommandOutput
  | CatalogOutput
  | BindingOutput
  | ProviderOutput
  | SurfaceResolverOutput

export type LeftTabComponent = ComponentType<PaneProps<LeftTabParams>>
