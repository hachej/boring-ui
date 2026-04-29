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

interface PanelConfigBase {
  id: string
  title: string
  icon?: ComponentType<{ className?: string }>
  placement?: "left" | "center" | "right" | "bottom" | "left-tab" | "right-tab"
  filePatterns?: string[]
  requiresCapabilities?: string[]
  essential?: boolean
  chromeless?: boolean
  source?: "builtin" | "app"
  pluginId?: string
}

export interface SyncPanelConfig<T = any> extends PanelConfigBase {
  component: ComponentType<PaneProps<T>>
  lazy?: false
}

export interface LazyPanelConfig<T = any> extends PanelConfigBase {
  component: () => Promise<{ default: ComponentType<PaneProps<T>> }>
  lazy: true
}

export type PanelConfig<T = any> = SyncPanelConfig<T> | LazyPanelConfig<T>

export type PanelRegistration<T = any> =
  | Omit<SyncPanelConfig<T>, "id">
  | Omit<LazyPanelConfig<T>, "id">

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
export function definePanel<T = unknown>(
  config: Omit<SyncPanelConfig<T>, "id"> & { id: string },
): SyncPanelConfig<T>
export function definePanel<T = unknown>(
  config: Omit<LazyPanelConfig<T>, "id"> & { id: string },
): LazyPanelConfig<T>
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

export type PanelRegistryType = import("./PanelRegistry").PanelRegistry
