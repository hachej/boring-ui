/**
 * @hachej/boring-workspace/plugin subpath
 *
 * Browser-safe authoring surface for package.json based plugins.
 * A package uses `pi` for agent/Pi contributions and `boring` for workspace/UI
 * contributions. Front entries default-export a BoringFrontFactory.
 */

export {
  createCapturingBoringFrontAPI,
  boringFrontFactoryToPlugin,
  definePlugin,
  toWorkspacePlugin,
} from "./shared/plugins/frontFactory"
export type {
  BoringFrontAPI,
  BoringFrontFactory,
  BoringFrontFactoryWithId,
  BoringFrontSetup,
  BoringFrontBindingRegistration,
  BoringFrontPanelRegistration,
  BoringFrontPanelCommandRegistration,
  BoringFrontLeftTabRegistration,
  BoringFrontProviderRegistration,
  BoringFrontSurfaceResolverRegistration,
  CapturedBoringFrontRegistrations,
  CapturingBoringFrontAPIHandle,
  DefinePluginConfig,
  WorkspaceFrontPluginInput,
} from "./shared/plugins/frontFactory"

export {
  validateBoringPluginManifest,
  isSafePluginRelativePath,
  isValidBoringPluginId,
} from "./shared/plugins/manifest"
export { WORKSPACE_OPEN_PATH_SURFACE_KIND } from "./shared/types/surface"
export type {
  BoringPackageBoringField,
  BoringPackagePiField,
  BoringPackagePiSource,
  BoringPackagePiSourceObject,
  BoringPluginManifestErrorCode,
  BoringPluginManifestIssue,
  BoringPluginManifestValidationResult,
  BoringPluginPackageJson,
} from "./shared/plugins/manifest"
export type { PaneProps } from "./shared/types/panel"
