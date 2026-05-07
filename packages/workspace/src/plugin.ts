/**
 * @boring/workspace/plugin subpath
 *
 * Browser-safe authoring surface for agent-authored plugins.
 * Exports manifest utilities, the BoringPluginAPI types, and the hot-reload
 * coordinator. Does NOT export defineFrontPlugin, composePlugins, or any
 * internal workspace types.
 */

// Authoring types + capturing API
export type {
  BoringPluginAPI,
  BoringPluginPanelRegistration,
  BoringPluginCommandRegistration,
  BoringPluginSurfaceResolverRegistration,
  BoringPluginContextProviderRegistration,
  BoringPluginSlotFillRegistration,
  BoringPluginSurfaceRequest,
  BoringPluginSurfaceResolution,
  PluginPanelComponentFactory,
  CapturingAPIHandle,
} from "./shared/plugins/authoring"
export { createCapturingAPI } from "./shared/plugins/authoring"
export {
  createCapturingBoringFrontAPI,
  boringFrontFactoryToPlugin,
} from "./shared/plugins/frontFactory"
export type {
  BoringFrontAPI,
  BoringFrontFactory,
  BoringFrontPanelRegistration,
  BoringFrontPanelCommandRegistration,
  BoringFrontLeftTabRegistration,
  BoringFrontSurfaceResolverRegistration,
  CapturedBoringFrontRegistrations,
  CapturingBoringFrontAPIHandle,
} from "./shared/plugins/frontFactory"

// Manifest utilities
export {
  validateBoringPluginManifest,
  isSafePluginRelativePath,
  isSafePluginRelativeGlob,
  isValidBoringPluginId,
  BORING_PLUGIN_MANIFEST_ERROR_CODES,
} from "./shared/plugins/manifest"
export type {
  BoringPluginRuntime,
  BoringPluginPermissions,
  BoringPluginManifest,
  BoringPluginManifestErrorCode,
  BoringPluginManifestIssue,
  BoringPluginManifestValidationResult,
  ValidateBoringPluginManifestOptions,
} from "./shared/plugins/manifest"

// Hot-reload coordinator
export { BoringPluginReloadCoordinator, PluginCoordinator } from "./shared/plugins/coordinator"
export type {
  BoringPluginReloadCoordinatorOptions,
  BoringPluginContributionRegistries,
  HotReloadPanelRegistryLike,
  HotReloadCommandRegistryLike,
  HotReloadSurfaceResolverRegistryLike,
  BoringPluginFactory,
  BoringPluginRuntimeRecord,
  BoringPluginReloadResult,
  BoringPluginReloadDiagnostic,
  CapturedRegistrations,
  DiagnosticKind,
  PluginDiagnostic,
  LoadPluginResult,
  UnloadPluginResult,
  PluginCoordinatorOptions,
  CoordinatorRegistries,
} from "./shared/plugins/coordinator"
