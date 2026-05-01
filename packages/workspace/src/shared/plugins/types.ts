import type { ComponentType, ReactNode } from "react"
import type { ExplorerAdapter, ExplorerRow } from "../types/explorer"
import type { CommandConfig, PaneProps, PanelConfig } from "../types/panel"
import type { SurfaceResolverConfig } from "../types/surface"

export type PluginBinding = ComponentType<unknown>

export type JSONSchema = Record<string, unknown>

export interface ToolExecContext {
  abortSignal: AbortSignal
  toolCallId: string
  onUpdate?: (partial: string) => void
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>
  isError?: boolean
  details?: unknown
}

/**
 * Structural tool contract accepted from plugins. Workspace keeps this local so
 * the shared plugin layer does not import the agent package; app shells can
 * adapt these tools into whichever agent runtime they compose with.
 */
export interface AgentTool {
  name: string
  description: string
  promptSnippet?: string
  parameters: JSONSchema
  execute(params: Record<string, unknown>, ctx: ToolExecContext): Promise<ToolResult>
}

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
