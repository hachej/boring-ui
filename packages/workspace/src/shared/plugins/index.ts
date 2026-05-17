// `defineFrontPlugin` and `WorkspaceFrontPlugin` are INTERNAL bootstrap
// IR. They are deliberately NOT re-exported here — public consumers
// should use `definePlugin` from "@hachej/boring-workspace/plugin". The
// rare internal callers (the bootstrap pipeline, tests) import them
// directly from `./defineFrontPlugin`.
export { PluginError } from "./defineFrontPlugin"
export type { PluginErrorKind } from "./defineFrontPlugin"
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
} from "./types"
export { bootstrap } from "./bootstrap"
export type {
  BootstrapOptions,
  BootstrapResult,
  PanelRegistryLike,
  CommandRegistryLike,
  CatalogRegistryLike,
  SurfaceResolverRegistryLike,
} from "./bootstrap"

export {
  createCapturingBoringFrontAPI,
  boringFrontFactoryToPlugin,
  definePlugin,
  toWorkspacePlugin,
} from "./frontFactory"
export type {
  BoringFrontAPI,
  BoringFrontFactory,
  BoringFrontFactoryWithId,
  BoringFrontPanelRegistration,
  BoringFrontPanelCommandRegistration,
  BoringFrontLeftTabRegistration,
  BoringFrontSurfaceResolverRegistration,
  CapturedBoringFrontRegistrations,
  CapturingBoringFrontAPIHandle,
  WorkspaceFrontPluginInput,
} from "./frontFactory"

export {
  validateBoringPluginManifest,
  validateBoringPluginPackageJson,
  isSafePluginRelativePath,
  isSafePluginRelativeGlob,
  isValidBoringPluginId,
  BORING_PLUGIN_MANIFEST_ERROR_CODES,
} from "./manifest"
export type {
  BoringPackageBoringField,
  BoringPackagePiField,
  BoringPackagePiSource,
  BoringPackagePiSourceObject,
  BoringPluginManifestErrorCode,
  BoringPluginManifestIssue,
  BoringPluginManifestValidationResult,
  BoringPluginPackageJson,
  BoringPluginPackageJsonValidationResult,
} from "./manifest"
