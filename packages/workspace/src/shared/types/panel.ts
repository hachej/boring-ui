/**
 * Shared panel and command types — no runtime deps beyond React/dockview.
 *
 * Importable from BOTH front and server bundles without dragging in
 * platform-specific code.
 */
import type { ComponentType } from "react"
import type { DockviewApi, DockviewPanelApi } from "dockview-react"

/**
 * Unified prop shape for panel components rendered inside DockviewShell.
 *
 * Structurally mirrors dockview's `IDockviewPanelProps<T>` so dockview
 * can render registered components directly — no wrapper, no field
 * renaming, no `as` casts. We re-state the shape (rather than re-export
 * dockview's type) so the workspace package owns its public contract:
 * if dockview's type ever drifts, only the wiring inside DockviewShell
 * needs to change.
 *
 * Use {@link definePanel} for type-safe registration.
 *
 * @typeParam T - Shape of the panel-specific `params` payload. Defaults
 *   to `unknown` because layouts restored from JSON are inherently
 *   un-typed at runtime; use a generic param when you control the
 *   addPanel call site, otherwise read defensively.
 */
export interface PaneProps<T = unknown> {
  /** App-supplied data for this panel instance (e.g. `{ path: string }`). */
  params: T
  /** Per-panel control surface (close, setActive, setTitle, …). */
  api: DockviewPanelApi
  /** Top-level dockview API (groups, addPanel, removePanel, fromJSON, …). */
  containerApi: DockviewApi
  /** Optional className forwarded to the pane's root element. */
  className?: string
}

export interface WorkspaceSourceOpenPanelConfig {
  id: string
  component: string
  title?: string
  params?: Record<string, unknown>
}

/**
 * Props for workspace source panes hosted in the left workspace rail.
 * These are not Dockview panels: they receive only source-pane params and
 * the explicit actions that the source host supports.
 */
export interface WorkspaceSourceProps<T = unknown> {
  params: T
  className?: string
  openPanel?: (config: WorkspaceSourceOpenPanelConfig) => void
}

export type PanelPlacement =
  | "left"
  | "center"
  | "right"
  | "bottom"
  | "shared-dockview"
  | "workspace-page"
  /** @deprecated Use registerWorkspaceSource instead. */
  | "workspace-source"
  /** @deprecated Use registerWorkspaceSource instead. */
  | "left-tab"
  | "right-tab"

export function isSharedDockviewPlacement(placement: string | undefined): boolean {
  return placement === undefined || placement === "center" || placement === "shared-dockview" || placement === "workspace-page"
}

export function isWorkspacePagePlacement(placement: string | undefined): boolean {
  return placement === "workspace-page"
}

export function isWorkspaceSourcePlacement(placement: string | undefined): boolean {
  return placement === "workspace-source" || placement === "left-tab"
}

export interface PanelConfig<T = any> {
  id: string
  title: string
  icon?: ComponentType<{ className?: string }>
  /** Placement hint. Public plugin placements: "workspace-page" | "shared-dockview". */
  placement?: PanelPlacement | string
  requiresCapabilities?: string[]
  essential?: boolean
  chromeless?: boolean
  supportsFullPage?: boolean
  /** @deprecated Only honored for legacy workspace-source/left-tab panels. Use WorkspaceSourceConfig.defaultPanelId. */
  defaultPanelId?: string
  /** Source: "builtin" | "app" */
  source?: string
  pluginId?: string
  /** Revision emitted by the runtime plugin asset manager for hot-loaded panels. */
  pluginRevision?: number
  /**
   * Whether to wrap the component with React.lazy + Suspense. Omit to let
   * the registry auto-detect: zero-arg functions (factories) are treated as
   * lazy; components that accept a props argument are treated as eager.
   */
  lazy?: boolean
  component: ComponentType<PaneProps<T>> | (() => Promise<{ default: ComponentType<PaneProps<T>> }>)
}

export type PanelRegistration<T = any> = Omit<PanelConfig<T>, 'id'>

export interface WorkspaceSourceConfig<T = any> {
  id: string
  title: string
  icon?: ComponentType<{ className?: string }>
  component: ComponentType<WorkspaceSourceProps<T>> | (() => Promise<{ default: ComponentType<WorkspaceSourceProps<T>> }>)
  requiresCapabilities?: string[]
  chromeless?: boolean
  /** Panel id opened in the main workspace when this source is selected. */
  defaultPanelId?: string
  /** Source: "builtin" | "app" */
  source?: string
  pluginId?: string
  /** Revision emitted by the runtime plugin asset manager for hot-loaded sources. */
  pluginRevision?: number
  lazy?: boolean
}

export type WorkspaceSourceRegistration<T = any> = Omit<WorkspaceSourceConfig<T>, 'id'>

/**
 * Identity helper for type-safe panel registration. Pure runtime
 * passthrough — the value of this is forcing TypeScript to verify that
 * the registered component accepts the params shape declared on the
 * config. Without it, apps tend to widen `component` to
 * `ComponentType<PaneProps<unknown>>` and lose the link.
 *
 * ```ts
 * const editorPanel = definePanel<{ path: string }>({
 *   id: "code-editor",
 *   title: "Editor",
 *   component: CodeEditorPane, // typechecked against PaneProps<{ path: string }>
 *   placement: "center",
 * })
 * ```
 */
export function definePanel<T = unknown>(config: PanelConfig<T>): PanelConfig<T> {
  return config
}

export interface CommandConfig {
  id: string
  title: string
  run: () => void
  keywords?: string[]
  shortcut?: string
  when?: () => boolean
  pluginId?: string
}
