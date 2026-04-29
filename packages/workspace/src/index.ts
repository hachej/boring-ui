// ---------------------------------------------------------------------------
// @boring/workspace — Public API
//
// Every export here is deliberate. useWorkspaceStore is NOT exported.
// Consumers should NEVER need deep imports.
// ---------------------------------------------------------------------------

// Plugin model
export {
  definePlugin,
  bootstrap,
  PluginError,
} from "./shared/plugin"
export type { PluginErrorKind, BootstrapOptions, BootstrapResult, AgentToolRegistry } from "./shared/plugin"
export type { Plugin, CatalogConfig } from "./shared/plugin"
export {
  CatalogRegistry,
  useCommands,
  useActivePanels,
  useCatalogs,
  PluginErrorBoundary,
  PluginErrorProvider,
  usePluginErrors,
} from "./front/plugin"
export type { CatalogRegistryOptions, PluginError as PluginContributionError } from "./front/plugin"
export { filesystemPlugin } from "./plugins/filesystemPlugin"
export { makeStaticDataPlugin } from "./plugins/factories/makeStaticDataPlugin"
export type { StaticDataPluginOpts } from "./plugins/factories/makeStaticDataPlugin"

// Utility
export { cn } from "./lib/utils"

// Registry & panel management
export { PanelRegistry } from "./front/registry/PanelRegistry"
export { CommandRegistry } from "./front/registry/CommandRegistry"
export {
  RegistryProvider,
  useRegistry,
  useCommandRegistry,
  useCatalogRegistry,
} from "./front/registry"
export { getFileIcon } from "./front/registry"
export type {
  PanelConfig,
  PanelRegistration,
  SyncPanelConfig,
  LazyPanelConfig,
  CommandConfig,
  PaneProps,
  PanelRegistryType,
} from "./front/registry"

// Dock / layout runtime
export { DockviewShell, useDockviewApi } from "./front/dock"
export type {
  LayoutConfig,
  GroupConfig,
  DockviewShellProps,
  DockviewShellApi,
  PanelLifecycleApi,
  SerializedLayout,
} from "./front/dock"

// Layout presets
export {
  IdeLayout,
  buildIdeLayout,
  ChatLayout,
  buildChatLayout,
  TopBar,
  ResponsiveDockviewShell,
} from "./front/layout"
export type {
  IdeLayoutProps,
  ChatLayoutProps,
  TopBarProps,
  ResponsiveDockviewShellProps,
} from "./front/layout"

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
} from "./front/hooks"
export { useViewportBreakpoint } from "./front/hooks"
export {
  useResponsiveSidebarCollapse,
  type UseResponsiveSidebarCollapseOptions,
} from "./front/hooks"
export {
  useArtifactPanels,
  type ArtifactPanel,
  type UseArtifactPanelsReturn,
} from "./front/hooks"
export {
  useArtifactRouting,
  type UseArtifactRoutingOptions,
  type UseArtifactRoutingReturn,
} from "./front/hooks"
export {
  useKeyboardShortcuts,
  formatShortcut,
  type ShortcutBinding,
  type UseKeyboardShortcutsOptions,
} from "./front/hooks"
export {
  useAutoOpenAgentFiles,
  type UseAutoOpenAgentFilesOptions,
} from "./front/hooks"

// Command Palette
export { CommandPalette } from "./front/components/CommandPalette"
export type { CommandPaletteProps } from "./front/components/CommandPalette"

// Panes (dockview wrappers — require WorkspaceProvider)
export { ArtifactSurfacePane } from "./panes"
export type { ArtifactSurfacePaneProps } from "./panes"
export { EmptyPane } from "./panes"
export type { EmptyPaneProps } from "./panes"
export { DataCatalogPane } from "./panes"
export type { DataCatalogPaneProps } from "./panes"
export { CodeEditorPane } from "./panes"
export type { CodeEditorPaneProps } from "./panes"
export { FileTreePane, FileTreeView } from "./panes/file-tree/FileTreeView"
export type { FileTreePaneProps, FileTreeViewProps } from "./panes/file-tree/FileTreeView"
export { MarkdownEditorPane } from "./panes"
export type { MarkdownEditorPaneProps } from "./panes"
export { defaultEditorPanels } from "./panes"
export { definePanel } from "./front/registry/types"

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
} from "./front/events"
export type {
  Origin,
  EventMeta,
  WorkspaceEventMap,
  WorkspaceEventName,
} from "./front/events"

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
export { createBridge } from "./front/bridge"
export { createBridgeClient } from "./front/bridge"
export type { BridgeClient, BridgeClientOptions, UIStatePut } from "./front/bridge"
export type {
  WorkspaceBridge,
  BridgeEventMap,
  CommandResult,
  DynamicPaneConfig,
  Unsubscribe,
  CausedBy,
} from "./front/bridge"
export {
  openFileSchema,
  openPanelSchema,
  closePanelSchema,
  notificationSchema,
  navigateToLineSchema,
  expandToFileSchema,
  MAX_PANELS,
} from "./front/bridge"

// shadcn UI primitives
export * from "./front/components/ui"

// Error handling
export { PanelErrorBoundary } from "./front/components/PanelErrorBoundary"
export type { PanelErrorBoundaryProps } from "./front/components/PanelErrorBoundary"

// Standalone components (usable WITHOUT WorkspaceProvider)
export { CodeEditor } from "./panes/code-editor/CodeEditor"
export type { CodeEditorProps } from "./panes/code-editor/CodeEditor"
export { FileTree } from "./panes/file-tree/FileTree"
export type { FileTreeProps, FileTreeNode } from "./panes/file-tree/FileTree"
export { MarkdownEditor } from "./panes/markdown-editor/MarkdownEditor"
export type { MarkdownEditorProps } from "./panes/markdown-editor/MarkdownEditor"
export { DataCatalog } from "./panes/data-catalog/DataCatalog"
export type { DataCatalogProps, DataSource } from "./panes/data-catalog/DataCatalog"
export { DataExplorer, useExplorerState } from "./front/components/DataExplorer"
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
  FacetsArgs,
  SearchArgs,
  SearchResult,
  DragPayload,
} from "./front/components/DataExplorer"
export { SessionList } from "./front/components/SessionList"
export type { SessionListProps, SessionItem } from "./front/components/SessionList"

// Chat-centered layout
export {
  ChatShellContext,
  SessionBrowser,
  ChatStagePlaceholder,
  SurfaceShell,
  WorkbenchLeftPane,
  ChatCenteredShell,
  useChatShell,
  useChatSurface,
} from "./front/components/chat"
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
  ChatShellContextValue,
} from "./front/components/chat"
export type { ChatSuggestion } from "./front/chrome/chat-stage-placeholder/ChatStagePlaceholder"

// Provider
export {
  WorkspaceProvider,
  ThemeProvider,
  useTheme,
  useWorkspaceBridge,
  useWorkspaceContext,
  useWorkspaceChatPanel,
} from "./front/WorkspaceProvider"
export type {
  WorkspaceProviderProps,
  ThemeProviderProps,
  WorkspaceBridgeContextValue,
  WorkspaceContextValue,
} from "./front/WorkspaceProvider"

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
