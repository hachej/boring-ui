// ---------------------------------------------------------------------------
// @hachej/boring-workspace — Public API
//
// Every export here is deliberate. useWorkspaceStore is NOT exported.
// Consumers should NEVER need deep imports.
// ---------------------------------------------------------------------------

// Plugin model. The single public way to author a plugin is
// `definePlugin` from "@hachej/boring-workspace/plugin". Plugin composition
// is just calling multiple factories with the same api (see docs).
export {
  bootstrap,
  PluginError,
} from "./shared/plugins"
export type {
  PluginErrorKind,
  BootstrapOptions,
  BootstrapResult,
  PanelRegistryLike,
  CommandRegistryLike,
  CatalogRegistryLike,
  SurfaceResolverRegistryLike,
} from "./shared/plugins"
export type {
  PluginBinding,
  CatalogAdapter,
  CatalogBadge,
  CatalogConfig,
  CatalogFacets,
  CatalogFacetsArgs,
  CatalogFacetConfig,
  CatalogFacetValue,
  CatalogRow,
  CatalogSearchArgs,
  CatalogSearchResult,
  LeftTabParams,
  LeftTabComponent,
  PluginProvider,
  PluginProviderProps,
  AgentTool,
  JSONSchema,
  ToolExecContext,
  ToolResult,
} from "./shared/plugins"
export { CatalogRegistry } from "./shared/plugins/CatalogRegistry"
export type { CatalogRegistryOptions } from "./shared/plugins/CatalogRegistry"
export {
  useCommands,
  useActivePanels,
  useCatalogs,
  PluginErrorBoundary,
  PluginErrorProvider,
  usePluginErrors,
} from "./front/plugin"
export type { PluginError as PluginContributionError } from "./front/plugin"
export {
  filesystemPlugin,
  emitFilesystemAgentFileChange,
  useAutoOpenAgentFiles,
  onFilesystemChanged,
} from "./plugins/filesystemPlugin/front"
export type { UseAutoOpenAgentFilesOptions } from "./plugins/filesystemPlugin/front"
export { filesystemEvents } from "./plugins/filesystemPlugin/shared/events"
export type { FilesystemEventMap, FilesystemEventMeta } from "./plugins/filesystemPlugin/shared/events"
// Utility
export { cn } from "./front/lib/utils"

// Registry & panel management
export { PanelRegistry } from "./front/registry/PanelRegistry"
export { CommandRegistry } from "./shared/plugins/CommandRegistry"
export { SurfaceResolverRegistry } from "./shared/plugins/SurfaceResolverRegistry"
export {
  RegistryProvider,
  useRegistry,
  useCommandRegistry,
  useCatalogRegistry,
  useSurfaceResolverRegistry,
  WORKSPACE_OPEN_PATH_SURFACE_KIND,
} from "./front/registry"
export { getFileIcon } from "./front/registry"
export type {
  PanelConfig,
  PanelRegistration,
  CommandConfig,
  PaneProps,
  SurfaceOpenRequest,
  SurfacePanelResolution,
  SurfaceResolverConfig,
  SurfaceResolverRegistration,
} from "./front/registry"

// Dock / layout runtime
export { DockviewShell, PanelChrome, useDockviewApi } from "./front/dock"
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
export { CodeEditorPane } from "./plugins/filesystemPlugin/front/code-editor/CodeEditorPane"
export type { CodeEditorPaneProps } from "./plugins/filesystemPlugin/front/code-editor/CodeEditorPane"
export {
  FileTreePane,
  FileTreeView,
} from "./plugins/filesystemPlugin/front/file-tree/FileTreeView"
export type {
  FileTreePaneProps,
  FileTreeViewProps,
} from "./plugins/filesystemPlugin/front/file-tree/FileTreeView"
export { MarkdownEditorPane } from "./plugins/filesystemPlugin/front/markdown-editor/MarkdownEditorPane"
export type { MarkdownEditorPaneProps } from "./plugins/filesystemPlugin/front/markdown-editor/MarkdownEditorPane"
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
  emitAgentData,
} from "./front/events"
export type {
  Origin,
  EventMeta,
  WorkspacePluginEventMap,
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
export { postUiCommand, UI_COMMAND_EVENT } from "./front/bridge"
export type {
  BridgeClient,
  BridgeClientOptions,
  UIStatePut,
} from "./front/bridge"
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

// Error handling
export { PanelErrorBoundary } from "./front/components/PanelErrorBoundary"
export type { PanelErrorBoundaryProps } from "./front/components/PanelErrorBoundary"

// Standalone components (usable WITHOUT WorkspaceProvider)
export { CodeEditor } from "./plugins/filesystemPlugin/front/code-editor/CodeEditor"
export type { CodeEditorProps } from "./plugins/filesystemPlugin/front/code-editor/CodeEditor"
export { FileTree } from "./plugins/filesystemPlugin/front/file-tree/FileTree"
export type {
  FileTreeProps,
  FileTreeNode,
} from "./plugins/filesystemPlugin/front/file-tree/FileTree"
export { MarkdownEditor } from "./plugins/filesystemPlugin/front/markdown-editor/MarkdownEditor"
export type { MarkdownEditorProps } from "./plugins/filesystemPlugin/front/markdown-editor/MarkdownEditor"
export { SessionList } from "./front/components/SessionList"
export type {
  SessionListProps,
  SessionItem,
} from "./front/components/SessionList"

// Declarative chat/workbench chrome
export { SessionBrowser } from "./front/chrome/session-list/SessionBrowser"
export { SurfaceShell } from "./front/chrome/artifact-surface/SurfaceShell"
export { WorkbenchLeftPane } from "./front/chrome/workbench-left/WorkbenchLeftPane"
export type { SessionBrowserProps } from "./front/chrome/session-list/SessionBrowser"
export type {
  OpenArtifactHandler,
  WorkspaceChatPanelComponent,
  WorkspaceChatPanelProps,
} from "./front/chrome/chat/types"
export type {
  SurfaceShellProps,
  SurfaceShellApi,
  SurfaceShellSnapshot,
  SurfaceShellTab,
  OpenPanelConfig,
} from "./front/chrome/artifact-surface/SurfaceShell"
export type {
  WorkbenchLeftPaneProps,
  WorkbenchLeftTabId,
} from "./front/chrome/workbench-left/WorkbenchLeftPane"

// Provider
export {
  WorkspaceProvider,
  ThemeProvider,
  useTheme,
  useWorkspaceBridge,
  useWorkspaceContext,
  useWorkspaceContextOptional,
  useWorkspaceChatPanel,
  useWorkspaceAttention,
} from "./front/provider"
export type {
  WorkspaceProviderProps,
  FrontPluginHotReloadMode,
  ThemeProviderProps,
  WorkspaceBridgeContextValue,
  WorkspaceContextValue,
  WorkspaceAttentionBlocker,
  WorkspaceAttentionContextValue,
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
