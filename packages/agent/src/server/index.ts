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
export type { AgentRuntimeHostOperations } from './runtime/runtimeHost'
export { createAgent } from './createAgent'
export {
  AgentDirectoryCompilerError,
  compileAgentDirectory,
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
export { createAgentApp } from './createAgentApp'
export type { CreateAgentAppOptions } from './createAgentApp'
export type { AgentHarnessFactory, AgentHarnessFactoryInput } from '../shared/harness'
export { applyCspHeaders } from './http/csp'
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
export { registerAgentRoutes } from './registerAgentRoutes'
export type { RegisterAgentRoutesOptions } from './registerAgentRoutes'
export type { AgentShutdownParticipant } from './shutdown'
export type {
  WorkspaceAgentDispatcherBinding,
  WorkspaceAgentDispatcherResolver,
  WorkspaceAgentDispatcherResolveOptions,
} from './workspaceAgentDispatcher'
export type { RuntimeEnvContribution, RuntimeEnvContributionContext } from './runtimeEnvContributions'
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
