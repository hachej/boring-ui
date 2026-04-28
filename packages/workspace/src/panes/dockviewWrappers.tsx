/**
 * Default panel registrations for the built-in editors.
 *
 * Panes (CodeEditorPane, MarkdownEditorPane) accept dockview's native
 * `PaneProps` envelope directly — no adapter wrappers needed. This
 * module just exposes a ready-to-spread registry slice for apps that
 * want "open files in the workbench" without restating every panel
 * config.
 *
 * ```ts
 * const panels: PanelConfig[] = [
 *   ...defaultEditorPanels,
 *   definePanel<{ id: string }>({ id: "chart-canvas", component: ChartCanvasPane, ... }),
 * ]
 * ```
 */
import { CodeEditorPane } from "./CodeEditorPane"
import { MarkdownEditorPane } from "./MarkdownEditorPane"
import { definePanel, type PanelConfig } from "../registry/types"

/**
 * @deprecated Panes now accept dockview's envelope natively — register
 * `CodeEditorPane` directly via `definePanel<{ path: string }>(...)`.
 * Kept as an alias so existing imports keep working.
 */
export { CodeEditorPane as CodeEditorPaneAdapter }

/**
 * @deprecated See {@link CodeEditorPaneAdapter}. Use `MarkdownEditorPane` directly.
 */
export { MarkdownEditorPane as MarkdownEditorPaneAdapter }

export const defaultEditorPanels: PanelConfig[] = [
  definePanel<{ path: string }>({
    id: "code-editor",
    title: "Editor",
    component: CodeEditorPane,
    placement: "center",
    source: "app",
    chromeless: true,
    filePatterns: ["*"],
  }),
  definePanel<{ path: string }>({
    id: "markdown-editor",
    title: "Markdown",
    component: MarkdownEditorPane,
    placement: "center",
    source: "app",
    chromeless: true,
    filePatterns: ["*.md", "*.markdown"],
  }),
]
