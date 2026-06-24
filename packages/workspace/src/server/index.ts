/**
 * @hachej/boring-workspace/server — Node-only public API.
 *
 * Lower-level Node factories for advanced wiring. Hosts that want the
 * composed workspace + agent Fastify app should import
 * `createWorkspaceAgentServer` from `@hachej/boring-workspace/app/server`.
 *
 * Bundling: this entry MUST NOT be imported by browser code. The workspace
 * package's exports map keeps it under `./server`, and the front bundle's
 * tsconfig excludes `src/server/**`. The bundle isolation script at
 * `scripts/assert-bundle-isolation.mjs` fails the build if browser-side
 * code reaches in here.
 */
// Testing utilities (for tests that need custom bridge wiring)
export { createInMemoryBridge } from "./bridge/createInMemoryBridge"
export { uiRoutes } from "./ui-control/http/uiRoutes"
export type { UiRoutesOptions } from "./ui-control/http/uiRoutes"
export {
  createGetUiStateTool,
  createExecUiTool,
  createWorkspaceUiTools,
} from "./ui-control/tools/uiTools"
export type { UiBridge, WorkspaceBridge, UiState, UiCommand, CommandResult } from "../shared/ui-bridge"
export {
  WorkspaceBridgeErrorCode,
  createWorkspaceBridgeError,
} from "../shared/workspace-bridge-rpc"
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
} from "../shared/workspace-bridge-rpc"
export {
  WorkspaceBridgeRegistry,
  createWorkspaceBridgeRegistry,
  validateWorkspaceBridgeOperationDefinition,
} from "./workspaceBridge/registry"
export type {
  RegisterWorkspaceBridgeHandlerOptions,
  WorkspaceBridgeCallContext,
  WorkspaceBridgeHandler,
  WorkspaceBridgeHandlerArgs,
  WorkspaceBridgeRegistryCallOptions,
  WorkspaceBridgeRegistryLogger,
  WorkspaceBridgeRegistryOptions,
} from "./workspaceBridge/registry"
export {
  createBrowserBridgeAuthPolicy,
  createLocalCliBridgeAuthPolicy,
} from "./workspaceBridge/authPolicy"
export { workspaceBridgeHttpRoutes } from "./workspaceBridge/httpRoutes"
export type { WorkspaceBridgeHttpRoutesOptions } from "./workspaceBridge/httpRoutes"
export { InMemoryWorkspaceBridgeRuntimeRefreshTokenStore } from "./workspaceBridge/refreshTokenStore"
export type {
  WorkspaceBridgeRuntimeRefreshTokenStore,
  WorkspaceBridgeRuntimeRefreshTokenUseOptions,
  WorkspaceBridgeRuntimeRefreshTokenUseResult,
} from "./workspaceBridge/refreshTokenStore"
export {
  InMemoryWorkspaceBridgeIdempotencyStore,
  hashNormalizedInput,
  runWithWorkspaceBridgeIdempotency,
  stableStringify,
} from "./workspaceBridge/idempotency"
export type {
  BridgeAuthPolicy,
  BridgeAuthPolicyInput,
  BridgeAuthPolicyRequestLike,
  BridgeAuthResolution,
  BridgePrincipal,
  BridgeWorkspaceGrant,
  BrowserBridgeAuthPolicyOptions,
  LocalCliBridgeAuthPolicyOptions,
} from "./workspaceBridge/authPolicy"
export type {
  BeginIdempotencyOptions,
  CompleteIdempotencyOptions,
  IdempotencyBeginResult,
  IdempotencyRecordStatus,
  WorkspaceBridgeIdempotencyRecord,
  WorkspaceBridgeIdempotencyStore,
} from "./workspaceBridge/idempotency"
export {
  DEFAULT_WORKSPACE_BRIDGE_RUNTIME_REFRESH_TOKEN_TTL_MS,
  DEFAULT_WORKSPACE_BRIDGE_RUNTIME_TOKEN_TTL_MS,
  MAX_WORKSPACE_BRIDGE_RUNTIME_TOKEN_TTL_MS,
  WORKSPACE_BRIDGE_REFRESH_TOKEN_AUDIENCE,
  WORKSPACE_BRIDGE_TOKEN_AUDIENCE,
  clampWorkspaceBridgeRuntimeTokenTtlMs,
  mintWorkspaceBridgeRuntimeRefreshToken,
  mintWorkspaceBridgeRuntimeToken,
  runtimeClaimsToBridgeAuthContext,
  verifyWorkspaceBridgeRuntimeRefreshToken,
  verifyWorkspaceBridgeRuntimeToken,
} from "./workspaceBridge/runtimeToken"
export type {
  MintWorkspaceBridgeRuntimeRefreshTokenOptions,
  MintWorkspaceBridgeRuntimeTokenOptions,
  VerifiedWorkspaceBridgeRuntimeRefreshToken,
  VerifiedWorkspaceBridgeRuntimeToken,
  VerifyWorkspaceBridgeRuntimeRefreshTokenOptions,
  VerifyWorkspaceBridgeRuntimeTokenOptions,
  WorkspaceBridgeRuntimeRefreshTokenClaims,
  WorkspaceBridgeRuntimeTokenClaims,
} from "./workspaceBridge/runtimeToken"
export {
  createWorkspaceBridgeRuntimeEnvContribution,
  resolveBridgeCallUrl,
  resolveBridgeTokenUrl,
} from "./workspaceBridge/runtimeEnv"
export { defineTrustedDomainBridgeHandler } from "./workspaceBridge/trustedDomainHandler"
export type {
  CreateWorkspaceBridgeRuntimeEnvContributionOptions,
  WorkspaceBridgeRuntimeEnvDisabledReason,
  WorkspaceBridgeRuntimeEnvOptions,
  WorkspaceBridgeRuntimePlacement,
} from "./workspaceBridge/runtimeEnv"
export type {
  TrustedDomainBridgeHandlerOptions,
  TrustedDomainBridgeHandlerPolicy,
  TrustedDomainBridgeHandlerRegistration,
} from "./workspaceBridge/trustedDomainHandler"
export { createWorkspaceBridgeRuntimeCore } from "./workspaceBridge/runtimeCore"
export type { WorkspaceBridgeRuntimeCore, WorkspaceBridgeRuntimeCoreOptions } from "./workspaceBridge/runtimeCore"
export {
  bootstrapServer,
  definePluginAsset,
  defineServerPlugin,
  resolvePluginAssetPath,
  validateServerPlugin,
} from "./plugins/bootstrapServer"
export type {
  ServerBootstrapOptions,
  ServerBootstrapResult,
  WorkspaceBridgeHandlerContribution,
  WorkspacePiPackageSource,
  WorkspaceProvisioningContribution,
  WorkspaceRouteContribution,
  WorkspaceServerPlugin,
  WorkspaceServerPluginAsset,
} from "./plugins/bootstrapServer"
// Boring plugin asset manager + reload-pluggability helpers.
export { buildBoringSystemPrompt } from "./boringSystemPrompt"
export { BoringPluginAssetManager } from "./agentPlugins/manager"
export { boringPluginRoutes, collectRestartWarnings } from "./agentPlugins/routes"
export type { PluginRestartWarning } from "./agentPlugins/routes"
export { aggregatePluginPrompts } from "./agentPlugins/aggregatePluginPrompts"
export { preflightBoringPlugins, readBoringPlugins, scanBoringPlugins } from "./agentPlugins/scan"
export type { BoringPluginScanResult } from "./agentPlugins/scan"
// `clearPluginSignatureCache`, `PLUGIN_SIGNATURE_CACHE_FILE`, and the
// `PluginSignatureCachePayload` type are intentionally NOT re-exported —
// they are workspace-internal. External consumers (cli/verifyPlugin)
// only need to read the cache (`readPluginSignatureCache`) and compute
// signatures (`pluginFileSignature`); the workspace's own asset manager
// owns writing + clearing the sidecar. The cli test fixture writes via
// `writePluginSignatureCache` to seed cache state.
export {
  pluginFileSignature,
  readPluginSignatureCache,
  writePluginSignatureCache,
} from "./agentPlugins/signatureCache"
export {
  defineRuntimeServerPlugin,
  runtimeBackendGateway,
  RuntimeBackendError,
  RuntimeBackendRegistry,
  validateRuntimeServerPlugin,
} from "./runtimeBackend"
export type {
  RuntimeBackendDiagnostic,
  RuntimeBackendDispatchRequest,
  RuntimeBackendDispatchResponse,
  RuntimeBackendDispatcher,
  RuntimeBackendGatewayOptions,
  RuntimeBackendReloadResult,
  RuntimePluginContext,
  RuntimePluginHandler,
  RuntimePluginResponse,
  RuntimePluginRouter,
  RuntimeServerPlugin,
} from "./runtimeBackend"
export type {
  BoringPluginEvent,
  BoringPluginFrontTarget,
  BoringPluginFrontTargetResolver,
  BoringPluginFrontTargetResolverContext,
  BoringPluginNativeFrontTarget,
  BoringPluginNativeFrontTargetTrust,
  BoringPluginListEntry,
  BoringPluginSource,
  BoringPluginSourceInput,
  BoringPluginSourceKind,
  BoringServerPluginManifest,
} from "./agentPlugins/types"

// dataCatalog factories moved to the standalone @hachej/boring-data-catalog
// package — import from there instead of re-exporting from /server.
