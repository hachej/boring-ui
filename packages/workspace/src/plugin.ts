/**
 * @hachej/boring-workspace/plugin subpath
 *
 * Browser-safe authoring surface for package.json based plugins.
 * A package uses `pi` for agent/Pi contributions and `boring` for workspace/UI
 * contributions. Front entries default-export a BoringFrontFactory.
 */

export {
  captureFrontPlugin,
  createCapturingBoringFrontAPI,
  definePlugin,
} from "./shared/plugins/frontFactory"
export type {
  BoringFrontAPI,
  BoringFrontFactory,
  BoringFrontFactoryWithId,
  BoringFrontSetup,
  BoringFrontBindingRegistration,
  BoringFrontPanelRegistration,
  BoringFrontPanelCommandRegistration,
  BoringFrontAppLeftActionRegistration,
  BoringFrontAppLeftOverlayProps,
  BoringFrontWorkspaceSourceRegistration,
  BoringFrontProviderRegistration,
  BoringFrontSurfaceResolverRegistration,
  CapturedBoringFrontRegistrations,
  CapturingBoringFrontAPIHandle,
  DefinePluginConfig,
  CapturedFrontPlugin,
} from "./shared/plugins/frontFactory"

export {
  validateBoringPluginManifest,
  isSafePluginRelativePath,
  isValidBoringPluginId,
} from "./shared/plugins/manifest"
export { WORKSPACE_OPEN_PATH_SURFACE_KIND } from "./shared/types/surface"
export { useAppLeftOverlayChrome } from "./shared/plugins/appLeftOverlayChrome"
export {
  WORKSPACE_OPEN_APP_LEFT_OVERLAY_EVENT,
  appLeftOverlayIdFromEvent,
  requestAppLeftOverlay,
} from "./shared/plugins/appLeftOverlay"
export type { AppLeftOverlayChromeValue } from "./shared/plugins/appLeftOverlayChrome"
export { useWorkspaceShellCapabilities } from "./shared/plugins/workspaceShellCapabilities"
export type {
  WorkspaceShellAnchorRect,
  WorkspaceShellArtifactTarget,
  WorkspaceShellCapabilityResult,
  WorkspaceShellCapabilities,
} from "./shared/plugins/workspaceShellCapabilities"

// In-process UI bridge access for plugin Pi slash commands. Lets a command
// open panels / show notifications directly (no BORING_UI_URL, no fetch).
export {
  execWorkspaceUi,
  getWorkspaceUiBridge,
  notify,
  openPanel,
  NoWorkspaceUiBridgeError,
} from "./shared/plugins/uiBridgeRegistry"
export type { OpenPanelArgs } from "./shared/plugins/uiBridgeRegistry"
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
export type { PaneProps, WorkspaceSourceProps, WorkspaceSourceOpenPanelConfig } from "./shared/types/panel"
