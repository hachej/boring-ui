// Public front plugin authors should use `definePlugin({ ... })` from
// "@hachej/boring-workspace/plugin".
export { PluginError } from "./errors"
export type { PluginErrorKind } from "./errors"
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
} from "./types"
export { bootstrap } from "./bootstrap"
export type {
  BootstrapOptions,
  BootstrapResult,
  PanelRegistryLike,
  WorkspaceSourceRegistryLike,
  CommandRegistryLike,
  CatalogRegistryLike,
  SurfaceResolverRegistryLike,
} from "./bootstrap"

// frontFactory and manifest exports live on the "@hachej/boring-workspace/plugin"
// subpath. Internal callers import them directly from ./frontFactory or
// ./manifest — no barrel re-export needed here.
