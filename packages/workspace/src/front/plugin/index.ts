// `CatalogRegistry` is layer-agnostic (no React/browser APIs) and lives
// under `shared/plugins/`. Re-exported here for backwards-compatible
// import paths.
export { CatalogRegistry } from "../../shared/plugins/CatalogRegistry"
export type { CatalogRegistryOptions } from "../../shared/plugins/CatalogRegistry"
export { useCommands } from "./useCommands"
export { useActivePanels } from "./useActivePanels"
export { useCatalogs } from "./useCatalogs"
export { PluginErrorBoundary } from "./PluginErrorBoundary"
export { PluginErrorProvider, usePluginErrors } from "./PluginErrorContext"
export type { PluginError } from "./PluginErrorContext"
export { PluginInspector } from "./PluginInspector"
export type { PluginMeta } from "./PluginInspector"
