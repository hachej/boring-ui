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
  BoringFrontPanelRegistration,
  BoringFrontPanelCommandRegistration,
  BoringFrontLeftTabRegistration,
  BoringFrontSurfaceResolverRegistration,
  CapturedBoringFrontRegistrations,
  CapturingBoringFrontAPIHandle,
  WorkspaceFrontPluginInput,
} from "./shared/plugins/frontFactory"

export {
  validateBoringPluginManifest,
  isSafePluginRelativePath,
  isSafePluginRelativeGlob,
  isValidBoringPluginId,
  BORING_PLUGIN_MANIFEST_ERROR_CODES,
} from "./shared/plugins/manifest"
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
