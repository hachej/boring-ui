// @hachej/boring-agent — server (Node-only) public API
export {
  buildDeploymentSnapshotRecipe,
  prepareDeploymentSnapshot,
  UV_SETUP_COMMANDS,
} from './sandbox/snapshots/deploymentSnapshot'
export type {
  DeploymentSnapshotProvider,
  DeploymentSnapshotRecipe,
  DeploymentSnapshotResult,
  DeploymentSnapshotStatus,
} from './sandbox/snapshots/deploymentSnapshot'
export { resolveWorkspaceRoot } from './config/workspaceRoot'
export { createRemoteWorkerModeAdapter } from './runtime/modes/remote-worker'
export type { RemoteWorkerModeAdapterOptions } from './runtime/modes/remote-worker'
export { createRemoteWorkerWorkspace } from './workspace/createRemoteWorkerWorkspace'
export { createRemoteWorkerSandbox } from './sandbox/remote-worker/createRemoteWorkerSandbox'
export {
  RemoteWorkerClient,
  RemoteWorkerClientError,
  constantTimeTokenEqual,
  decodeBytesFromWorker,
  encodeBytesForWorker,
} from './sandbox/remote-worker/workerClient'
export type { RemoteWorkerClientOptions } from './sandbox/remote-worker/workerClient'
export {
  REMOTE_WORKER_PROVIDER,
  REMOTE_WORKER_RUNTIME_CWD,
  WORKER_INTERNAL_TOKEN_HEADER,
  WORKER_REQUEST_ID_HEADER,
  WORKER_WORKSPACE_ID_HEADER,
}
  from './sandbox/remote-worker/protocol'
export type {
  RemoteWorkerErrorPayload,
  RemoteWorkerExecRequest,
  RemoteWorkerExecResponse,
  RemoteWorkerFsEventEnvelope,
  RemoteWorkerWorkspaceOp,
  RemoteWorkerWorkspaceResult,
} from './sandbox/remote-worker/protocol'
export {
  provisionRuntimeWorkspace,
  type ProvisionRuntimeWorkspaceOptions,
  type RuntimeWorkspaceProvisioningResult,
} from './workspace/provisionRuntime'
export type { ProvisioningArtifactRequest } from './workspace/provisioning/packArtifact'
export { provisionWorkspaceRuntime } from './workspace/provisioning'
export type {
  PluginSkillSource,
  ProvisionWorkspaceRuntimeOptions,
  RuntimeNodePackageSpec,
  RuntimeProvisioningContribution,
  RuntimePythonSpec,
  RuntimeTemplateContribution,
  WorkspaceProvisioningAdapter,
  WorkspaceProvisioningExecResult,
  WorkspaceProvisioningResult,
} from './workspace/provisioning'
export { autoDetectMode, hasBwrap, resolveMode } from './runtime/resolveMode'
export { createDirectModeAdapter } from './runtime/modes/direct'
export { createLocalModeAdapter } from './runtime/modes/local'
export { createVercelSandboxModeAdapter } from './runtime/modes/vercel-sandbox'
export { createProviderRuntimeModeAdapter } from './runtime/modes/providerAdapter'
export {
  createSandboxRuntimeModeAdapter,
  resolveBuiltinRuntimeLayoutRoot,
  sandboxRuntimeHostOperations,
} from './runtime/sandboxRuntimeHost'
export type { SandboxRuntimeModeOptions } from './runtime/sandboxRuntimeHost'
export type { AgentRuntimeHostOperations } from './runtime/runtimeHost'
export {
  AgentDirectoryCompilerError,
  compileAgentDirectory,
  compilePersonaPackageDirectory,
} from './agentDefinition/compileAgentDirectory'
export type {
  AgentDirectoryCompilerErrorCode,
  AgentDirectoryCompilerPublicErrorCode,
} from './agentDefinition/compileAgentDirectory'
export {
  AuthoredAgentMaterializationError,
  materializeAgentDirectory,
} from './agentDefinition/materializeAgentDirectory'
export type {
  AuthoredAgentMaterializationErrorCode,
  AuthoredAgentSourceV1,
  MaterializeAgentDirectoryInput,
} from './agentDefinition/materializeAgentDirectory'
export {
  createConfiguredAgentHostAgentSpec,
  TrustedAgentCompositionError,
} from './agentDefinition/createConfiguredAgentHostAgentSpec'
export type {
  CreateConfiguredAgentHostAgentSpecInput,
  TrustedAgentInstructionAppendix,
  TrustedAuthoredAgentPolicy,
} from './agentDefinition/createConfiguredAgentHostAgentSpec'
export {
  FleetConfigError,
  loadConfiguredAgentFleet,
  MODEL_TIER_CANDIDATES,
} from './agentDefinition/loadConfiguredAgentFleet'
export type {
  FleetConfigErrorCode,
  FleetLoaderDiagnostic,
  FleetLoaderDiagnosticCode,
  FleetSeatBinding,
  FleetSkillBinding,
  LoadConfiguredAgentFleetOptions,
  LoadConfiguredAgentFleetResult,
  ModelTierCandidate,
} from './agentDefinition/loadConfiguredAgentFleet'
export {
  LEGACY_DEFAULT_AGENT_FLEET,
  resolveDefaultAgentFleet,
} from './agentDefinition/resolveDefaultAgentFleet'
export type {
  ResolveDefaultAgentFleetOptions,
} from './agentDefinition/resolveDefaultAgentFleet'
export {
  createResolvedAgentDigest,
  resolveAgentDeployment,
  type ResolvedAgentDigestInput,
  type ResolvedAgent,
} from './agentDefinition/resolveAgentDeployment'
export type { AgentConfig } from '../shared/events'
export {
  createManagedAgentMcpDelegateController,
  createManagedAgentMcpHttpHandler,
  createManagedAgentMcpServer,
  MANAGED_AGENT_MCP_DELIVERY_RULE,
  MANAGED_AGENT_MCP_ORIGIN_SURFACE,
  ManagedAgentMcpDelegateController,
  ManagedAgentMcpError,
  registerShareEntryResources,
  shareResourceUri,
} from './mcp'
export type {
  ManagedAgentArtifact,
  ManagedAgentArtifactCandidate,
  ManagedAgentArtifactRef,
  ManagedAgentBoundRunnerWorkspace,
  ManagedAgentCollectArtifactsInput,
  ManagedAgentDelegateInput,
  ManagedAgentDelegateProgress,
  ManagedAgentDelegateRequestContext,
  ManagedAgentDelegateResult,
  ManagedAgentDelegateRunner,
  ManagedAgentDelegateRunInput,
  ManagedAgentDelegateStatus,
  ManagedAgentDelegateStatusResult,
  ManagedAgentMcpDelegateOptions,
  ManagedAgentMcpHttpHandlerOptions,
  ManagedAgentMcpServerOptions,
  ManagedAgentSafeError,
  ManagedAgentWorkspaceResolutionInput,
  ShareEntryMcpResourceOptions,
} from './mcp'
export { createStandaloneAgentHostApp } from './createStandaloneAgentHostApp'
export type { CreateStandaloneAgentHostAppOptions } from './createStandaloneAgentHostApp'
export { registerAgentHostEnvironmentRoutes } from './agent-host/environmentHttpProjection'
export type { AgentHostEnvironmentHttpProjectionOptions } from './agent-host/environmentHttpProjection'
export { createAuthMiddleware as createAgentAuthMiddleware } from './http/middleware'
export { createAgentHost } from './agent-host/createAgentHost'
export { SqliteAgentRequestLedger } from './agent-host/sqliteRequestLedger'
export {
  AgentFleetCompilationError,
  AgentFleetCompilationErrorCode,
  createValidatingAgentFleetCompiler,
} from './agent-host/fleetCompiler'
export type {
  AgentFleetPluginBindingContract,
  CreateValidatingAgentFleetCompilerOptions,
} from './agent-host/fleetCompiler'
export { EmbeddedAgentGateway } from './agent-host/embeddedGateway'
export { InMemoryAgentRequestLedger } from './agent-host/requestLedger'
export {
  createEnvironmentProvisioningFingerprint,
  createResolvedRuntimeScopeIdentity,
} from './agent-host/runtimeScopeIdentity'
export type {
  AgentEffectAdmission,
  AgentFleetCompiler,
  AgentGatewayEffect,
  AgentHostAgentSpec,
  AgentHostDirectProjectionOptions,
  AgentHostDescription,
  AgentHostDispatcherRunInput,
  AgentHostEnvironmentLease,
  AgentHostEnvironmentScope,
  AgentHostHandle,
  AgentRequestKey,
  AgentRequestLedger,
  AgentRequestLedgerPrepareResult,
  AgentRequestLedgerRecord,
  CompiledAgentHostAgentSpec,
  ConfiguredAgentHostAgentSpec,
  CreateAgentHostOptions,
  CreatedAgentHost,
  AuthorizedEnvironmentIntent,
  LegacyDefaultAgentHostSpec,
  ResolvedAgentRuntimeScope,
  ResolvedEnvironmentScope,
} from './agent-host/types'
export type { LeaseBoundWorkspaceAgent } from '../shared/workspaceAgentDispatcher'
export type {
  AuthorizedAgentScope,
  VerifiedAgentScopeClaim,
} from '../shared/gateway/types'
export type { AgentHarnessFactory, AgentHarnessFactoryInput } from '../shared/harness'
export { applyCspHeaders } from './http/csp'
export { deepLinkRoutes } from './http/routes/deepLink'
export type {
  PiExtensionFactory,
  PiHarnessOptions,
  PiPackageSource,
} from './harness/pi-coding-agent/createHarness'
export { createResourceSettingsManager } from './harness/pi-coding-agent/createHarness'
export {
  compactPiPackages,
  mergePiPackageSources,
  piPackageSourceKey,
  PI_PACKAGE_RESOURCE_FILTERS,
} from './piPackages'
export {
  DEFAULT_PI_RESOURCE_DIGEST_LIMITS,
  createPiResourceDigestFence,
  createPiResourceDigestInput,
  digestPiResourceInputs,
} from './piResourceDigest'
export type {
  PiResourceDigestInput,
  PiResourceDigestLimits,
  PiResourceSet,
} from './piResourceDigest'
export type {
  WorkspaceAgentDispatcherBinding,
  WorkspaceAgentDispatcherResolver,
  WorkspaceAgentDispatcherResolveOptions,
} from './workspaceAgentDispatcher'
export {
  withRuntimeEnvContributions,
  type RuntimeEnvContribution,
  type RuntimeEnvContributionContext,
} from './runtimeEnvContributions'
export { createBoundWorkspaceAgentDispatcher } from './workspaceAgentDispatcher'
export { projectAuthorizedSessionRunDetails, type AuthorizedSessionRunDetails } from './sessionRunDetails'
export { createPluginDiagnosticsTool } from './tools/pluginDiagnostics'
export type {
  AgentMeteringSink,
  MeteringErrorLogger,
  MeteringReleaseInput,
  MeteringReleaseReason,
  MeteringReservationResult,
  MeteringReserveInput,
  MeteringRunKind,
  MeteringRunScope,
  MeteringRunStatus,
  MeteringSettleInput,
  MeteringUsage,
  MeteringUsageInput,
} from './pi-chat/metering'
export { normalizeMeteringUsage } from './pi-chat/metering'
export type {
  BuiltinRuntimeModeId,
  ModeContext,
  RuntimeBundle,
  RuntimeFilesystemBinding,
  RuntimeFilesystemBindingOperations,
  RuntimeModeAdapter,
  RuntimeModeId,
} from './runtime/mode'
export {
  createFakeAuthorityVerifierV1,
  createHostSideCredentialResolverV1,
  createInMemoryCredentialBackendV1,
  withResolvedCredential,
} from './credentials'
export type {
  CredentialStoreBackendV1,
  FakeAuthorityVerifierGrantV1,
  HostSideCredentialResolverOptionsV1,
  InMemoryCredentialBackendEntryV1,
} from './credentials'
