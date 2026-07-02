import type { WorkspaceState, PanelState } from "../store/types"
import type { FilesystemId } from "../../shared/types/filesystem"

export interface CommandResult {
  seq: number
  status: "ok" | "error"
  error?: { code: string; message: string }
}

export interface UiCommand {
  v?: number
  seq?: number
  kind: string
  params: Record<string, unknown>
}

export interface BridgeEventMap {
  "panel:opened": { panelId: string; params: Record<string, unknown> }
  "panel:closed": { panelId: string }
  "panel:activated": { panelId: string; previousPanelId: string | null }
  "file:opened": { path: string; mode: "view" | "edit" | "diff"; filesystem?: FilesystemId }
  "file:saved": { path: string }
  "file:dirty": { path: string; dirty: boolean }
  "sidebar:toggled": { collapsed: boolean }
  "tree:expand": { path: string }
  "notification:shown": { message: string; level: "info" | "warn" | "error" }
  "pane:error": { panelId: string; error: string; stack?: string }
}

export type Unsubscribe = () => void

export interface DynamicPaneConfig {
  id: string
  component: string
  params?: Record<string, unknown>
  title?: string
}

export interface WorkspaceBridge {
  getOpenPanels(): PanelState[]
  getActiveFile(): string | null
  getDirtyFiles(): string[]
  getVisibleFiles(): string[]

  openFile(
    path: string,
    opts?: { mode?: "view" | "edit" | "diff"; filesystem?: FilesystemId },
  ): Promise<CommandResult>
  openPanel(config: DynamicPaneConfig): Promise<CommandResult>
  closePanel(id: string): Promise<CommandResult>
  closeWorkbenchLeftPane(): Promise<CommandResult>
  showNotification(
    msg: string,
    level?: "info" | "warn" | "error",
  ): Promise<CommandResult>
  navigateToLine(file: string, line: number): Promise<CommandResult>
  expandToFile(path: string): Promise<CommandResult>
  markDirty(path: string): void
  markClean(path: string): void

  subscribe<K extends keyof BridgeEventMap>(
    event: K,
    handler: (data: BridgeEventMap[K]) => void,
  ): Unsubscribe

  select<T>(
    selector: (state: WorkspaceState) => T,
    handler: (value: T) => void,
  ): Unsubscribe
}

/**
 * The minimal slice of {@link WorkspaceBridge} a file tree needs: click-to-open
 * (`openFile`), initial selection (`getActiveFile`), reactive reveal (`select`,
 * plus optional `subscribe`). Lives here (core bridge layer) — not in the
 * filesystem plugin — so core chrome (WorkbenchLeftPane) can forward a
 * surface-backed adapter without importing a plugin module.
 */
export type FileTreeBridge = Pick<WorkspaceBridge, "openFile" | "getActiveFile" | "select"> &
  Partial<Pick<WorkspaceBridge, "subscribe">>

export type CausedBy = "user" | "agent" | "restore"
