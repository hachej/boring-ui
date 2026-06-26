export interface PanelState {
  id: string
  component: string
  params?: Record<string, unknown>
  groupId?: string
  essential?: boolean
}

export interface Notification {
  id: string
  message: string
  type: "info" | "warning" | "error"
  timestamp: number
}

export interface SidebarState {
  collapsed: boolean
  width: number
}

export interface WorkspaceState {
  hydrationComplete: boolean
  layout: unknown | null
  sidebar: SidebarState
  panelSizes: Record<string, number>
  preferences: { theme: "light" | "dark" }

  panels: PanelState[]
  activePanel: string | null
  activeFile: string | null
  visibleFiles: string[]
  dirtyFiles: Record<string, { panelId: string; savedAt: number | null }>
  notifications: Notification[]
}

export interface WorkspaceActions {
  setHydrationComplete: (complete: boolean) => void
  setLayout: (layout: unknown) => void
  setSidebar: (sidebar: Partial<SidebarState>) => void
  setPanelSize: (panelId: string, size: number) => void
  setTheme: (theme: "light" | "dark") => void

  openPanel: (panel: PanelState) => void
  closePanel: (panelId: string) => void
  activatePanel: (panelId: string) => void
  openFile: (file: string, panelId?: string) => void
  markDirty: (file: string, panelId: string) => void
  markClean: (file: string) => void
  showNotification: (notification: Omit<Notification, "id" | "timestamp">) => void
  dismissNotification: (id: string) => void
  navigateToLine: (file: string, line: number) => void
  resetLayout: () => void
}

export type WorkspaceStore = WorkspaceState & WorkspaceActions
