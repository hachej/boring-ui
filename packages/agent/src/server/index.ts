// @hachej/boring-agent — server (Node-only) public API
export { createRemoteWorkerModeAdapter } from './runtime/modes/remote-worker'
export type { RemoteWorkerModeAdapterOptions } from './runtime/modes/remote-worker'
// Exposed so consumers (and integration tests in dependent packages) can
// mount the file-routes plugin onto a standalone Fastify without booting
// the whole agent app. Used by workspace's FetchClient ↔ server contract tests.
export { fileRoutes } from './http/routes/file'
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
export { createAgent } from './createAgent'
export {
  AgentDirectoryCompilerError,
  compileAgentDirectory,
} from './agentDefinition/compileAgentDirectory'
export type {
  AgentDirectoryCompilerErrorCode,
  AgentDirectoryCompilerPublicErrorCode,
} from './agentDefinition/compileAgentDirectory'
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
