/**
 * Macro Plugin types
 */

import type {
  CatalogConfig,
  CommandConfig,
  PanelConfig,
  PluginOutput,
} from "@boring/workspace"
import type { WorkspaceServerPlugin } from "@boring/workspace/app/server"

export interface MacroConfig {
  clickhouse: {
    host: string
    port: number
    username: string
    password: string
    database: string
  } | null
}

export type MacroServerPlugin = WorkspaceServerPlugin

export interface MacroFrontendPlugin {
  id: string
  label?: string
  panels: PanelConfig[]
  commands?: CommandConfig[]
  catalogs?: CatalogConfig[]
  outputs?: PluginOutput[]
}
