export { cn } from "./lib/utils"
export * from "./registry"
export * from "./dock"
export * from "./layouts"
export * from "./data"
export * from "./hooks"
export * from "./panes"
export * from "./theme"
export * from "./bridge"
export * from "./components/ui"
export { CodeEditor } from "./components/CodeEditor"
export type { CodeEditorProps } from "./components/CodeEditor"
export {
  WorkspaceProvider,
  useTheme,
  useWorkspaceBridge,
  useDataProvider,
} from "./WorkspaceProvider"
export type {
  WorkspaceProviderProps,
  WorkspaceBridgeContextValue,
  DataProviderContextValue,
} from "./WorkspaceProvider"
export { createWorkspaceStore } from "./store"
export type { CreateWorkspaceStoreOptions } from "./store"
export {
  bindStore,
  useActiveFile,
  useActivePanel,
  useSidebarState,
  useOpenPanels,
  useDirtyFiles,
  useThemePreference,
  useHydrationComplete,
} from "./store/selectors"
export type {
  WorkspaceState,
  WorkspaceActions,
  WorkspaceStore,
  PanelState,
  Notification,
  SidebarState,
} from "./store/types"
