// @hachej/boring-agent — server (Node-only) public API
export { createDirectSandbox } from './sandbox/direct/createDirectSandbox'
export { createBwrapSandbox } from './sandbox/bwrap/createBwrapSandbox'
export type { BwrapResourceLimits, CreateBwrapSandboxOptions } from './sandbox/bwrap/createBwrapSandbox'
export { FileHandleStore } from './sandbox/vercel-sandbox/FileHandleStore'
export { resolveSandboxHandle } from './sandbox/vercel-sandbox/resolveSandboxHandle'
export { bakeSnapshotIfNeeded, buildPackageHash, buildSnapshotRecipeHash } from './sandbox/vercel-sandbox/bake'
export type {
  SnapshotBakeOptions,
  SnapshotBakeResult,
  VercelBakeClient,
  VercelBakeSandbox,
} from './sandbox/vercel-sandbox/bake'
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
export {
  createVercelDeploymentSnapshotProvider,
  prepareVercelDeploymentSnapshot,
  VERCEL_UV_SETUP_COMMANDS,
} from './sandbox/vercel-sandbox/deploymentSnapshot'
export type { VercelDeploymentSnapshotOptions } from './sandbox/vercel-sandbox/deploymentSnapshot'
export { createNodeWorkspace } from './workspace/createNodeWorkspace'
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
// Exposed so consumers (and integration tests in dependent packages) can
// mount the file-routes plugin onto a standalone Fastify without booting
// the whole agent app. Used by workspace's FetchClient ↔ server contract tests.
export { fileRoutes } from './http/routes/file'
export {
  provisionRuntimeWorkspace,
  type ProvisionRuntimeWorkspaceOptions,
  type RuntimeWorkspaceProvisioningResult,
} from './workspace/provisionRuntime'
export {
  getBoringAgentRuntimePaths,
  getBoringAgentRuntimeEnv,
  getBoringAgentPathEntries,
} from './workspace/runtimeLayout'
export type { BoringAgentRuntimePaths } from './workspace/runtimeLayout'
export {
  createVercelSandboxWorkspace,
  VERCEL_SANDBOX_WORKSPACE_ROOT,
} from './workspace/createVercelSandboxWorkspace'
export {
  createVercelProvisioningAdapter,
  VERCEL_PROVISIONING_CACHE_ROOT,
} from './sandbox/vercel-sandbox/provisioningAdapter'
export type { CreateVercelProvisioningAdapterOptions } from './sandbox/vercel-sandbox/provisioningAdapter'
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
  resolveAgentDeployment,
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
} from './mcp'
export type {
  ManagedAgentArtifact,
  ManagedAgentArtifactCandidate,
  ManagedAgentArtifactRef,
  ManagedAgentCollectArtifactsInput,
  ManagedAgentDelegateInput,
  ManagedAgentDelegateProgress,
  ManagedAgentDelegateRequestContext,
  ManagedAgentDelegateResult,
  ManagedAgentDelegateStatus,
  ManagedAgentDelegateStatusResult,
  ManagedAgentMcpDelegateOptions,
  ManagedAgentMcpHttpHandlerOptions,
  ManagedAgentMcpServerOptions,
  ManagedAgentSafeError,
  ManagedAgentWorkspaceResolutionInput,
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
export type {
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
export { createLogger } from './logging'
export type { Logger, LogFields } from './logging'
export type {
  BuiltinRuntimeModeId,
  ModeContext,
  RuntimeBundle,
  RuntimeFilesystemBinding,
  RuntimeFilesystemBindingOperations,
  RuntimeModeAdapter,
  RuntimeModeId,
} from './runtime/mode'
