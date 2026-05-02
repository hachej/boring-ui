export { composePlugins } from "./composePlugins"
export type { ComposePluginsOptions } from "./composePlugins"
export { defineFrontPlugin, PluginError } from "./defineFrontPlugin"
export type { PluginErrorKind, WorkspaceFrontPlugin } from "./defineFrontPlugin"
export type {
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
  ProviderOutput,
  SurfaceResolverOutput,
  PluginProvider,
  PluginProviderProps,
  AgentTool,
  JSONSchema,
  ToolExecContext,
  ToolResult,
  AgentToolOutput,
} from "./types"
export { bootstrap } from "./bootstrap"
export type {
  BootstrapOptions,
  BootstrapResult,
  AgentToolRegistry,
  PanelRegistryLike,
  CommandRegistryLike,
  CatalogRegistryLike,
  SurfaceResolverRegistryLike,
} from "./bootstrap"
