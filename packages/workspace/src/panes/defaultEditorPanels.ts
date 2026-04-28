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
import { definePanel } from "../registry/types"

// Type inferred (not annotated): PanelConfig<unknown>[] would force a
// widening cast of each entry, since SyncPanelConfig is contravariant
// on T at the component prop. Apps spread this into a PanelConfig[]
// array at the call site, which is the variance-safe direction.
export const defaultEditorPanels = [
  definePanel<{ path: string }>({
    id: "code-editor",
    title: "Editor",
    component: CodeEditorPane,
    placement: "center",
    source: "app",
    filePatterns: ["*"],
  }),
  definePanel<{ path: string }>({
    id: "markdown-editor",
    title: "Markdown",
    component: MarkdownEditorPane,
    placement: "center",
    source: "app",
    filePatterns: ["*.md", "*.markdown"],
  }),
]
