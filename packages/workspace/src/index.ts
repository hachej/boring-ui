// ---------------------------------------------------------------------------
// @boring/workspace — Public API
//
// Every export here is deliberate. useWorkspaceStore is NOT exported.
// Consumers should NEVER need deep imports.
// ---------------------------------------------------------------------------

// Plugin model
export { definePlugin, PluginError } from "./plugin"
export type { PluginErrorKind } from "./plugin"
export type { Plugin, CatalogConfig } from "./plugin"

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
export {
  useAutoOpenAgentFiles,
  type UseAutoOpenAgentFilesOptions,
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
export { FileTreePane, FileTreeView } from "./components/FileTreeView"
export type { FileTreePaneProps, FileTreeViewProps } from "./components/FileTreeView"
export { MarkdownEditorPane } from "./panes"
export type { MarkdownEditorPaneProps } from "./panes"
export { defaultEditorPanels } from "./panes"
export { definePanel } from "./registry/types"

// Theme
export { createShadcnTheme, useShadcnTheme } from "./theme"

// Unified event bus — typed pubsub for cross-cutting signals
// (filesystem mutations, panel/editor/query lifecycle). See
// docs/plans/UNIFIED_EVENT_BUS.md.
export {
  events,
  useEvent,
  userMeta,
  agentMeta,
  emitAgentFileChange,
} from "./events"
export type {
  Origin,
  EventMeta,
  WorkspaceEventMap,
  WorkspaceEventName,
} from "./events"

// Toast notifications (app-global; mounted automatically by WorkspaceProvider)
export { toast, Toaster, dismissToast } from "./toast"
export type {
  ToastApi,
  ToastInput,
  ToastRecord,
  ToastVariant,
  ToasterProps,
} from "./toast"

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
export { DataExplorer, useExplorerState } from "./components/DataExplorer"
export type {
  DataExplorerProps,
  UseExplorerStateOptions,
  UseExplorerStateReturn,
  ExplorerRow,
  ExplorerAdapter,
  Badge,
  FacetConfig,
  FacetValue,
  Facets,
  SearchArgs,
  SearchResult,
  FacetsArgs,
  DragPayload,
} from "./components/DataExplorer"
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
  useChatSurface,
} from "./components/chat"
export type {
  SessionBrowserProps,
  ChatStagePlaceholderProps,
  ChatStageHandle,
  SurfaceShellProps,
  SurfaceShellApi,
  SurfaceShellSnapshot,
  SurfaceShellTab,
  OpenPanelConfig,
  WorkbenchLeftPaneProps,
  WorkbenchLeftTab,
  DataPaneConfig,
  ChatCenteredShellProps,
  ChatTopBarProps,
  ChatShellContextValue,
} from "./components/chat"
export type { ChatSuggestion } from "@boring/agent/ui-shadcn"

// Provider
export {
  WorkspaceProvider,
  ThemeProvider,
  useTheme,
  useWorkspaceBridge,
} from "./WorkspaceProvider"
export type {
  WorkspaceProviderProps,
  ThemeProviderProps,
  WorkspaceBridgeContextValue,
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
