import type { ComponentType } from "react"

interface PanelConfigBase {
  id: string
  title: string
  icon?: ComponentType<{ className?: string }>
  placement?: "left" | "center" | "right" | "bottom"
  filePatterns?: string[]
  requiresCapabilities?: string[]
  essential?: boolean
  source?: "builtin" | "app"
}

export interface SyncPanelConfig extends PanelConfigBase {
  component: ComponentType<unknown>
  lazy?: false
}

export interface LazyPanelConfig extends PanelConfigBase {
  component: () => Promise<{ default: ComponentType<unknown> }>
  lazy: true
}

export type PanelConfig = SyncPanelConfig | LazyPanelConfig

export type PanelRegistration =
  | Omit<SyncPanelConfig, "id">
  | Omit<LazyPanelConfig, "id">

export interface CommandConfig {
  id: string
  title: string
  run: () => void
  shortcut?: string
  when?: () => boolean
}

export interface PaneProps {
  panelApi?: import("dockview-react").DockviewPanelApi
  bridge?: import("../bridge/types").WorkspaceBridge
  className?: string
}

export type PanelRegistryType = import("./PanelRegistry").PanelRegistry
