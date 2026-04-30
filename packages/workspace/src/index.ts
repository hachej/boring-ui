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
} from "./shared/plugins"
export type { PluginErrorKind, BootstrapOptions, BootstrapResult, AgentToolRegistry } from "./shared/plugins"
export type {
  Plugin,
  PluginBinding,
  CatalogConfig,
  PluginOutput,
  LeftTabOutput,
  LeftTabParams,
  LeftTabComponent,
  PanelOutput,
  CommandOutput,
  CatalogOutput,
  BindingOutput,
  AgentToolOutput,
} from "./shared/plugins"
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
export { cn } from "./front/lib/utils"

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
  CommandConfig,
  PaneProps,
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
export { DataProvider, useDataClient, useApiBaseUrl } from "./front/data"
export { FetchClient, FetchError } from "./front/data"
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
} from "./front/data"
export type { FileEntry, FileContent, FileStat, FetchClientOptions } from "./front/data"

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
export { WorkspaceLoadingState } from "./front/components/WorkspaceLoadingState"
export type { WorkspaceLoadingStateProps } from "./front/components/WorkspaceLoadingState"

// Panes (dockview wrappers — require WorkspaceProvider)
export { ArtifactSurfacePane } from "./front/chrome/artifact-surface/ArtifactSurfacePane"
export type { ArtifactSurfacePaneProps } from "./front/chrome/artifact-surface/ArtifactSurfacePane"
export { EmptyPane } from "./front/chrome/empty-pane/EmptyPane"
export type { EmptyPaneProps } from "./front/chrome/empty-pane/EmptyPane"
export { DataCatalogPane } from "./front/components/data-catalog/DataCatalogPane"
export type { DataCatalogPaneProps } from "./front/components/data-catalog/DataCatalogPane"
export { CodeEditorPane } from "./plugins/filesystemPlugin/code-editor/CodeEditorPane"
export type { CodeEditorPaneProps } from "./plugins/filesystemPlugin/code-editor/CodeEditorPane"
export { FileTreePane, FileTreeView } from "./plugins/filesystemPlugin/file-tree/FileTreeView"
export type { FileTreePaneProps, FileTreeViewProps } from "./plugins/filesystemPlugin/file-tree/FileTreeView"
export { MarkdownEditorPane } from "./plugins/filesystemPlugin/markdown-editor/MarkdownEditorPane"
export type { MarkdownEditorPaneProps } from "./plugins/filesystemPlugin/markdown-editor/MarkdownEditorPane"
export { definePanel } from "./front/registry/types"

// Theme
export { createShadcnTheme } from "./front/theme"

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
export { toast, Toaster, dismissToast } from "./front/toast"
export type {
  ToastApi,
  ToastInput,
  ToastRecord,
  ToastVariant,
  ToasterProps,
} from "./front/toast"

// Bridge
export { createBridge } from "./front/bridge"
export { createBridgeClient } from "./front/bridge"
export { postUiCommand } from "./front/bridge"
export type { BridgeClient, BridgeClientOptions, UIStatePut } from "./front/bridge"
export type {
  DispatchContext,
  UiCommand,
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
export { CodeEditor } from "./plugins/filesystemPlugin/code-editor/CodeEditor"
export type { CodeEditorProps } from "./plugins/filesystemPlugin/code-editor/CodeEditor"
export { FileTree } from "./plugins/filesystemPlugin/file-tree/FileTree"
export type { FileTreeProps, FileTreeNode } from "./plugins/filesystemPlugin/file-tree/FileTree"
export { MarkdownEditor } from "./plugins/filesystemPlugin/markdown-editor/MarkdownEditor"
export type { MarkdownEditorProps } from "./plugins/filesystemPlugin/markdown-editor/MarkdownEditor"
export { DataCatalog } from "./front/components/data-catalog/DataCatalog"
export type { DataCatalogProps, DataSource } from "./front/components/data-catalog/DataCatalog"
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

// Declarative chat/workbench chrome
export { SessionBrowser } from "./front/chrome/session-list/SessionBrowser"
export { SurfaceShell } from "./front/chrome/artifact-surface/SurfaceShell"
export { WorkbenchLeftPane } from "./front/chrome/workbench-left/WorkbenchLeftPane"
export type { SessionBrowserProps } from "./front/chrome/session-list/SessionBrowser"
export type {
  SurfaceShellProps,
  SurfaceShellApi,
  SurfaceShellSnapshot,
  SurfaceShellTab,
  OpenPanelConfig,
} from "./front/chrome/artifact-surface/SurfaceShell"
export type {
  WorkbenchLeftPaneProps,
  WorkbenchLeftTab,
  DataPaneConfig,
} from "./front/chrome/workbench-left/WorkbenchLeftPane"

// Provider
export {
  WorkspaceProvider,
  ThemeProvider,
  useTheme,
  useWorkspaceBridge,
  useWorkspaceContext,
  useWorkspaceChatPanel,
} from "./front/provider"
export type {
  WorkspaceProviderProps,
  ThemeProviderProps,
  WorkspaceBridgeContextValue,
  WorkspaceContextValue,
} from "./front/provider"

// Store (selectors only — store itself is NOT exported)
export { createWorkspaceStore } from "./front/store"
export type { CreateWorkspaceStoreOptions } from "./front/store"
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
} from "./front/store/selectors"
export type {
  WorkspaceState,
  WorkspaceActions,
  WorkspaceStore,
  PanelState,
  Notification,
  SidebarState,
} from "./front/store/types"
