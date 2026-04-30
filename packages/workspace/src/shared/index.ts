/**
 * @boring/workspace/shared — shared contract layer.
 *
 * Code (types + runtime) that BOTH front and server bundles import.
 * This is the workspace's public SDK surface for plugin authors and
 * app shells that wire things together manually.
 *
 * Isolation rule: no imports from ../front/** or ../server/**.
 *
 * Sub-folders:
 * - `types/` — pure type definitions, zero runtime
 * - `plugins/` — runtime plugin factories (definePlugin, bootstrap)
 */
export type { UiBridge, UiState, UiCommand, CommandResult } from "./ui-bridge"
export type { PanelConfig, CommandConfig, PaneProps, PanelRegistration } from "./types/panel"
export { definePanel } from "./types/panel"
export type { ExplorerAdapter, ExplorerRow, SearchResult } from "./types/explorer"
