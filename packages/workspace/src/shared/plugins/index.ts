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

// Hot-reloadable agent plugin authoring surface
export type {
  BoringPluginPanelRegistration,
  BoringPluginCommandRegistration,
  BoringPluginSurfaceResolverRegistration,
  BoringPluginContextProviderRegistration,
  BoringPluginSlotFillRegistration,
  BoringPluginSurfaceRequest,
  BoringPluginSurfaceResolution,
  BoringPluginAPI,
  PluginPanelComponentFactory,
  CapturingAPIHandle,
} from "./authoring"
export { createCapturingAPI } from "./authoring"

// Manifest validation
export {
  validateBoringPluginManifest,
  isSafePluginRelativePath,
  isSafePluginRelativeGlob,
  isValidBoringPluginId,
  BORING_PLUGIN_MANIFEST_ERROR_CODES,
} from "./manifest"
export type {
  BoringPluginRuntime,
  BoringPluginPermissions,
  BoringPluginManifest,
  BoringPluginManifestErrorCode,
  BoringPluginManifestIssue,
  BoringPluginManifestValidationResult,
  ValidateBoringPluginManifestOptions,
} from "./manifest"

// Hot-reload coordinator
export { PluginCoordinator } from "./coordinator"
export type {
  CoordinatorPanelRegistry,
  CoordinatorCommandRegistry,
  CoordinatorSurfaceResolverRegistry,
  CoordinatorProviderRegistry,
  CoordinatorSlotFillRegistry,
  CoordinatorRegistries,
  BoringPluginFactory,
  BoringPluginRuntimeRecord,
  CapturedRegistrations,
  DiagnosticKind,
  PluginDiagnostic,
  LoadPluginResult,
  UnloadPluginResult,
  PluginCoordinatorOptions,
} from "./coordinator"
