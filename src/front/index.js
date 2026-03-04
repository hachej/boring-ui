/**
 * boring-ui Public API
 *
 * This is the main entry point for the boring-ui library.
 * It re-exports the public API from registry, layout, config, hooks, and panels.
 *
 * @example
 * // Library usage
 * import { ConfigProvider, useConfig, ThemeProvider, useTheme } from 'boring-ui'
 * import 'boring-ui/style.css'
 *
 * @example
 * // Registry usage
 * import { paneRegistry, registerPane, PaneRegistry } from 'boring-ui'
 *
 * @example
 * // Layout usage
 * import { loadLayout, saveLayout, validateLayoutStructure } from 'boring-ui'
 */

// =============================================================================
// Registry - Pane registration and management
// =============================================================================
export {
  PaneRegistry,
  createDefaultRegistry,
  registerPane,
  getPane,
  listPanes,
  listPaneIds,
  essentialPanes,
  isEssential,
  hasPane,
  getComponents,
  getKnownComponents,
  paneRegistry,
} from './registry'

// =============================================================================
// Layout - Layout persistence and management
// =============================================================================
export {
  LAYOUT_VERSION,
  hashProjectRoot,
  getStorageKey,
  getSharedStorageKey,
  SIDEBAR_COLLAPSED_KEY,
  PANEL_SIZES_KEY,
  validateLayoutStructure,
  loadSavedTabs,
  saveTabs,
  loadLayout,
  saveLayout,
  loadLastKnownGoodLayout,
  clearLastKnownGoodLayout,
  loadCollapsedState,
  saveCollapsedState,
  loadPanelSizes,
  savePanelSizes,
  pruneEmptyGroups,
  checkForSavedLayout,
  getFileName,
  DEFAULT_CONSTRAINTS,
  getDefaultLayoutConfig,
} from './layout'

// =============================================================================
// Config - Application configuration
// =============================================================================
export {
  getConfig,
  getDefaultConfig,
  resetConfig,
  setConfig,
  ConfigProvider,
  useConfig,
  useConfigLoaded,
} from './config'

// =============================================================================
// Hooks - React hooks
// =============================================================================
export { ThemeProvider, useTheme } from './hooks/useTheme'

// =============================================================================
// Panels - Dockview panel components
// =============================================================================
export { default as FileTreePanel } from './panels/FileTreePanel'
export { default as EditorPanel } from './panels/EditorPanel'
export { default as TerminalPanel } from './panels/TerminalPanel'
export { default as ShellTerminalPanel } from './panels/ShellTerminalPanel'
export { default as EmptyPanel } from './panels/EmptyPanel'
export { default as ReviewPanel } from './panels/ReviewPanel'

// =============================================================================
// Components - UI components
// =============================================================================
export { default as ThemeToggle } from './components/ThemeToggle'
export {
  setPiAgentConfig,
  addPiAgentTools,
  resetPiAgentConfig,
} from './providers/pi/agentConfig'

// =============================================================================
// Main App
// =============================================================================
export { default as App } from './App'
