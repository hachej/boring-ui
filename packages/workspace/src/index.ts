// ---------------------------------------------------------------------------
// @boring/workspace — Public API
//
// Every export here is deliberate. useWorkspaceStore is NOT exported.
// Consumers should NEVER need deep imports.
// ---------------------------------------------------------------------------

// Utility
export { cn } from "./lib/utils"

// Registry & panel management
export { PanelRegistry } from "./registry/PanelRegistry"
export { CommandRegistry } from "./registry/CommandRegistry"
export { RegistryProvider, useRegistry, useCommandRegistry } from "./registry"
export { getFileIcon } from "./registry"
export type {
  PanelConfig,
  PanelRegistration,
  SyncPanelConfig,
  LazyPanelConfig,
  CommandConfig,
  PaneProps,
  PanelRegistryType,
} from "./registry"

// Dock / layout runtime
export { DockviewShell, useDockviewApi } from "./dock"
export type {
  LayoutConfig,
  GroupConfig,
  DockviewShellProps,
  DockviewShellApi,
  PanelLifecycleApi,
  SerializedLayout,
} from "./dock"

// Layout presets
export { IdeLayout, buildIdeLayout, ChatLayout, buildChatLayout } from "./layouts"
export type { IdeLayoutProps, ChatLayoutProps } from "./layouts"

// Data layer
export { DataProvider, useDataClient, useApiBaseUrl } from "./data"
export { FetchClient, FetchError } from "./data"
export {
  useFileContent,
  useFileData,
  useFileList,
  useStat,
  useFileSearch,
  useFileWrite,
  useCreateDir,
  useMoveFile,
  useDeleteFile,
} from "./data"
export type { FileEntry, FileContent, FileStat, FetchClientOptions } from "./data"

// Hooks
export {
  useEditorLifecycle,
  type EditorLifecycleAdapter,
  type UseEditorLifecycleOptions,
  type UseEditorLifecycleReturn,
} from "./hooks"
export { useViewportBreakpoint } from "./hooks"
export {
  useResponsiveSidebarCollapse,
  type UseResponsiveSidebarCollapseOptions,
} from "./hooks"
export {
  useArtifactPanels,
  type ArtifactPanel,
  type UseArtifactPanelsReturn,
} from "./hooks"
export {
  useArtifactRouting,
  type UseArtifactRoutingOptions,
  type UseArtifactRoutingReturn,
} from "./hooks"
export {
  useKeyboardShortcuts,
  formatShortcut,
  type ShortcutBinding,
  type UseKeyboardShortcutsOptions,
} from "./hooks"

// Command Palette
export { CommandPalette } from "./components/CommandPalette"
export type { CommandPaletteProps } from "./components/CommandPalette"

// Panes (dockview wrappers — require WorkspaceProvider)
export { ArtifactSurfacePane } from "./panes"
export type { ArtifactSurfacePaneProps } from "./panes"
export { EmptyPane } from "./panes"
export type { EmptyPaneProps } from "./panes"
export { DataCatalogPane } from "./panes"
export type { DataCatalogPaneProps } from "./panes"
export { CodeEditorPane } from "./panes"
export type { CodeEditorPaneProps } from "./panes"
export { FileTreePane } from "./panes"
export type { FileTreePaneProps } from "./panes"
export { MarkdownEditorPane } from "./panes"
export type { MarkdownEditorPaneProps } from "./panes"

// Theme
export { createShadcnTheme, useShadcnTheme } from "./theme"

// Bridge
export { createBridge } from "./bridge"
export { createBridgeClient } from "./bridge"
export type { BridgeClient, BridgeClientOptions, UIStatePut } from "./bridge"
export type {
  WorkspaceBridge,
  BridgeEventMap,
  CommandResult,
  DynamicPaneConfig,
  Unsubscribe,
  CausedBy,
} from "./bridge"
export {
  openFileSchema,
  openPanelSchema,
  closePanelSchema,
  notificationSchema,
  navigateToLineSchema,
  expandToFileSchema,
  MAX_PANELS,
} from "./bridge"

// shadcn UI primitives
export * from "./components/ui"

// Error handling
export { PanelErrorBoundary } from "./components/PanelErrorBoundary"
export type { PanelErrorBoundaryProps } from "./components/PanelErrorBoundary"

// Standalone components (usable WITHOUT WorkspaceProvider)
export { CodeEditor } from "./components/CodeEditor"
export type { CodeEditorProps } from "./components/CodeEditor"
export { FileTree } from "./components/FileTree"
export type { FileTreeProps, FileTreeNode } from "./components/FileTree"
export { MarkdownEditor } from "./components/MarkdownEditor"
export type { MarkdownEditorProps } from "./components/MarkdownEditor"
export { DataCatalog } from "./components/DataCatalog"
export type { DataCatalogProps, DataSource } from "./components/DataCatalog"
export { SessionList } from "./components/SessionList"
export type { SessionListProps, SessionItem } from "./components/SessionList"

// Chat-centered layout
export {
  SessionBrowser,
  ChatStagePlaceholder,
  SurfaceShell,
  WorkbenchLeftPane,
  ChatCenteredShell,
  ChatTopBar,
  useChatShell,
} from "./components/chat"
export type {
  SessionBrowserProps,
  ChatStagePlaceholderProps,
  ChatStageHandle,
  SurfaceShellProps,
  WorkbenchLeftPaneProps,
  WorkbenchLeftTab,
  ChatCenteredShellProps,
  ChatTopBarProps,
  ChatShellContextValue,
} from "./components/chat"

// Provider
export {
  WorkspaceProvider,
  ThemeProvider,
  useTheme,
  useWorkspaceBridge,
  useDataProvider,
} from "./WorkspaceProvider"
export type {
  WorkspaceProviderProps,
  ThemeProviderProps,
  WorkspaceBridgeContextValue,
  DataProviderContextValue,
} from "./WorkspaceProvider"

// Store (selectors only — store itself is NOT exported)
export { createWorkspaceStore } from "./store"
export type { CreateWorkspaceStoreOptions } from "./store"
export {
  bindStore,
  useActiveFile,
  useActivePanel,
  useSidebarState,
  useSetSidebar,
  useOpenPanels,
  useDirtyFiles,
  useThemePreference,
  useHydrationComplete,
  useResetLayout,
} from "./store/selectors"
export type {
  WorkspaceState,
  WorkspaceActions,
  WorkspaceStore,
  PanelState,
  Notification,
  SidebarState,
} from "./store/types"
