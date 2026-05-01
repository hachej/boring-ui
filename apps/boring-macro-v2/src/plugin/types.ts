/**
 * Macro Plugin types
 */

import type { AgentTool } from '@boring/agent/shared'
import type { PanelConfig, CommandConfig, CatalogConfig, PluginOutput } from '@boring/workspace'

export interface MacroConfig {
  clickhouse: {
    host: string
    port: number
    username: string
    password: string
    database: string
  } | null
}

export interface MacroServerPlugin {
  id: string
  label?: string
  agentTools: AgentTool[]
  systemPrompt?: string
}

export interface MacroFrontendPlugin {
  id: string
  label?: string
  panels: PanelConfig[]
  commands?: CommandConfig[]
  catalogs?: CatalogConfig[]
  outputs?: PluginOutput[]
}
