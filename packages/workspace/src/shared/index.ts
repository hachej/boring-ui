/**
 * @hachej/boring-workspace/shared — shared contract layer.
 *
 * Code (types + runtime) that BOTH front and server bundles import.
 * This is the workspace's public SDK surface for plugin authors and
 * app shells that wire things together manually.
 *
 * Isolation rule: no imports from ../front/** or ../server/**.
 *
 * Sub-folders:
 * - `types/` — pure type definitions, zero runtime
 * - `plugins/` — shared plugin internals used by the public `/plugin` subpath and bootstrap
 */
export type {
  WorkspaceBridge,
  UiState,
  UiCommand,
  SequencedUiCommand,
  CommandResult,
} from "./ui-bridge"
export * from "./artifacts"
export {
  WorkspaceBridgeErrorCode,
  createWorkspaceBridgeError,
} from "./workspace-bridge-rpc"
export type {
  BridgeActorAttribution,
  BridgeActorKind,
  BridgeAuthContext,
  BridgeCallerClass,
  BridgeIdempotencyPolicy,
  BridgeRedactedActorRef,
  WorkspaceBridgeCallFailure,
  WorkspaceBridgeCallRequest,
  WorkspaceBridgeCallResponse,
  WorkspaceBridgeCallSuccess,
  WorkspaceBridgeError,
  WorkspaceBridgeFileAssetPointer,
  WorkspaceBridgeJsonValue,
  WorkspaceBridgeOperationDefinition,
} from "./workspace-bridge-rpc"
export type { PanelConfig, CommandConfig, PaneProps, PanelRegistration } from "./types/panel"
export type {
  FilesystemId,
  UiFileResource,
  UiFileResourceInput,
} from "./types/filesystem"
export {
  USER_FILESYSTEM_ID,
  normalizeUiFileResource,
  normalizeUiFilesystem,
  uiFileResourceKey,
  withUiFileResource,
} from "./types/filesystem"
export type {
  SurfaceOpenRequest,
  SurfacePanelResolution,
  SurfaceResolverConfig,
  SurfaceResolverRegistration,
} from "./types/surface"
export { WORKSPACE_OPEN_PATH_SURFACE_KIND } from "./types/surface"
export { definePanel } from "./types/panel"
export type { UrlPanePolicy, UrlPanePaneParams, UrlPaneResolution, UrlPaneRejectionReason } from "./urlPane"
export {
  DEFAULT_URL_PANE_ORIGINS,
  URL_PANE_PANEL_ID,
  URL_PANE_PLUGIN_ID,
  defaultUrlPanePolicy,
  originMatchesPattern,
  parseUrlPaneOrigins,
  resolveUrlPaneTarget,
} from "./urlPane"
export type { AgentTool, JSONSchema, ToolExecContext, ToolResult } from "./types/agent-tool"
export type { TelemetryEvent, TelemetrySink } from "./telemetry"
export { noopTelemetry, safeCapture } from "./telemetry"
