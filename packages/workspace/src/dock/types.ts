import type { DockviewApi } from "dockview-react"

export interface LayoutConfig {
  version: string
  groups: GroupConfig[]
}

export interface GroupConfig {
  id: string
  position: "left" | "center" | "right" | "bottom"
  panel?: string
  locked?: boolean
  hideHeader?: boolean
  dynamic?: boolean
  placeholder?: string
  collapsible?: boolean
  collapsedWidth?: number
  constraints?: {
    minWidth?: number
    maxWidth?: number
    maxWidthViewportRatio?: number
    minHeight?: number
    maxHeight?: number
  }
}

export interface DockviewShellProps {
  layout: LayoutConfig
  persistedLayout?: SerializedLayout
  onReady?: (api: DockviewApi) => void
  onLayoutChange?: (layout: SerializedLayout) => void
  storageKey?: string
  allowedPanels?: string[]
  className?: string
}

export type SerializedLayout = Parameters<DockviewApi["fromJSON"]>[0]

export interface PanelLifecycleApi {
  panelId: string
  title: string
  setTitle(title: string): void
  close(): void
  focus(): void
  isActive: boolean
}

export interface DockviewShellApi {
  addPanel(
    groupId: string,
    config: {
      id: string
      component: string
      title?: string
      params?: Record<string, unknown>
    },
  ): void
  removePanel(panelId: string): void
  activatePanel(panelId: string): void
  movePanel(
    panelId: string,
    target:
      | { groupId: string }
      | {
          direction: "left" | "right" | "above" | "below"
          referencePanelId: string
        },
  ): void
  getActivePanel(): string | null
  toJSON(): SerializedLayout
}
