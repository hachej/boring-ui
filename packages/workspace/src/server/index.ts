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
export type { WorkspaceBridge, UiState, UiCommand, CommandResult } from "../shared/ui-bridge"
export {
  WorkspaceBridgeErrorCode,
  createWorkspaceBridgeError,
} from "../shared/workspace-bridge-rpc"
export type {
  BridgeActorAttribution,
  BridgeActorKind,
  BridgeAuditCategory,
  BridgeAuthContext,
  BridgeCallerClass,
  BridgeIdempotencyPolicy,
  BridgeRedactedActorRef,
  WorkspaceBridgeAuditContext,
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
} from "./workspaceBridge/registry"
export type {
  RegisterWorkspaceBridgeHandlerOptions,
  WorkspaceBridgeCallContext,
  WorkspaceBridgeHandler,
  WorkspaceBridgeHandlerArgs,
  WorkspaceBridgeRegistryLogger,
  WorkspaceBridgeRegistryOptions,
} from "./workspaceBridge/registry"
export {
  InMemoryWorkspaceBridgeAuditSink,
  SimpleWorkspaceBridgeRateLimitPolicy,
  auditOutcomeForError,
  createWorkspaceBridgeRateLimitKey,
  redactValue,
  redactWorkspaceBridgeAuditEvent,
} from "./workspaceBridge/audit"
export {
  createBrowserBridgeAuthPolicy,
  createLocalCliBridgeAuthPolicy,
  createTrustedServerBridgeAuthPolicy,
} from "./workspaceBridge/authPolicy"
export { workspaceBridgeHttpRoutes } from "./workspaceBridge/httpRoutes"
export type { WorkspaceBridgeHttpRoutesOptions } from "./workspaceBridge/httpRoutes"
export {
  FileWorkspaceBridgeIdempotencyStore,
  InMemoryWorkspaceBridgeIdempotencyStore,
  hashNormalizedInput,
  runWithWorkspaceBridgeIdempotency,
  stableStringify,
} from "./workspaceBridge/idempotency"
export type {
  RateLimitDecision,
  RateLimitPolicy,
  WorkspaceBridgeAuditEvent,
  WorkspaceBridgeAuditOutcome,
  WorkspaceBridgeAuditSink,
  WorkspaceBridgeRateLimitInput,
} from "./workspaceBridge/audit"
export type {
  BridgeAuthPolicy,
  BridgeAuthPolicyInput,
  BridgeAuthPolicyRequestLike,
  BridgeAuthResolution,
  BridgePrincipal,
  BridgeWorkspaceGrant,
  BrowserBridgeAuthPolicyOptions,
  LocalCliBridgeAuthPolicyOptions,
  TrustedServerBridgeAuthPolicyOptions,
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
  WORKSPACE_BRIDGE_TOKEN_AUDIENCE,
  mintWorkspaceBridgeRuntimeToken,
  runtimeClaimsToBridgeAuthContext,
  verifyWorkspaceBridgeRuntimeToken,
} from "./workspaceBridge/runtimeToken"
export type {
  MintWorkspaceBridgeRuntimeTokenOptions,
  VerifiedWorkspaceBridgeRuntimeToken,
  VerifyWorkspaceBridgeRuntimeTokenOptions,
  WorkspaceBridgeRuntimeTokenClaims,
} from "./workspaceBridge/runtimeToken"
export {
  createWorkspaceBridgeRuntimeEnvContribution,
  resolveBridgeCallUrl,
} from "./workspaceBridge/runtimeEnv"
export { defineTrustedDomainBridgeHandler } from "./workspaceBridge/trustedDomainHandler"
export type {
  CreateWorkspaceBridgeRuntimeEnvContributionOptions,
  WorkspaceBridgeRuntimeEnvDisabledReason,
  WorkspaceBridgeRuntimeEnvOptions,
} from "./workspaceBridge/runtimeEnv"
export type {
  TrustedDomainBridgeHandlerOptions,
  TrustedDomainBridgeHandlerPolicy,
  TrustedDomainBridgeHandlerRegistration,
} from "./workspaceBridge/trustedDomainHandler"
export { PendingQuestionRuntime } from "./humanInput/pendingQuestionRuntime"
export { InMemoryPendingQuestionStore, PendingQuestionStoreError, PENDING_QUESTION_ERROR_CODES } from "./humanInput/pendingQuestionStore"
export type {
  PendingQuestionAnswer,
  PendingQuestionCancelReason,
  PendingQuestionRecord,
  PendingQuestionStatus,
  PendingQuestionStore,
  PendingQuestionTranscriptEvent,
} from "./humanInput/pendingQuestionStore"
export {
  bootstrapServer,
  defineServerPlugin,
  validateServerPlugin,
} from "./plugins/bootstrapServer"
export type {
  ServerBootstrapOptions,
  ServerBootstrapResult,
  WorkspacePiPackageSource,
  WorkspaceProvisioningContribution,
  WorkspaceRouteContribution,
  WorkspaceServerPlugin,
} from "./plugins/bootstrapServer"
// Boring plugin asset manager + reload-pluggability helpers.
export { buildBoringSystemPrompt } from "./boringSystemPrompt"
export { BoringPluginAssetManager } from "./agentPlugins/manager"
export { boringPluginRoutes, collectRestartWarnings } from "./agentPlugins/routes"
export type { PluginReloadRebuild, PluginRestartWarning } from "./agentPlugins/routes"
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
export type {
  BoringPluginEvent,
  BoringPluginListEntry,
  BoringServerPluginManifest,
} from "./agentPlugins/types"

// dataCatalog factories moved to the standalone @hachej/boring-data-catalog
// package — import from there instead of re-exporting from /server.
