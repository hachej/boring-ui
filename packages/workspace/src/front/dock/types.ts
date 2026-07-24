import type { DockviewApi } from "dockview-react"

export interface LayoutConfig {
  version: string
  groups: GroupConfig[]
}

export interface GroupConfig {
  id: string
  position: "left" | "center" | "right" | "bottom"
  panel?: string
  params?: Record<string, unknown>
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
  /** Called before the current Dockview instance is disposed or replaced. */
  onUnavailable?: (api: DockviewApi) => void
  onLayoutChange?: (layout: SerializedLayout) => void
  storageKey?: string
  allowedPanels?: string[]
  className?: string
  /** Component rendered in the tab strip BEFORE the tabs. Useful for inline controls. */
  prefixHeaderActions?: React.FunctionComponent<unknown>
  /** Component rendered in the tab strip on the far right. */
  rightHeaderActions?: React.FunctionComponent<unknown>
  /** Component used as the empty-state watermark when a group has no panels. */
  watermarkComponent?: React.FunctionComponent<unknown>
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
  updatePanelParams(panelId: string, params: Record<string, unknown>): void
  setPanelTitle(panelId: string, title: string): void
  findPanelsByParam(key: string, value: unknown): string[]
  getActivePanel(): string | null
  toJSON(): SerializedLayout
}
