// @hachej/boring-agent — server (Node-only) public API
export { createDirectSandbox } from './sandbox/direct/createDirectSandbox'
export { createBwrapSandbox } from './sandbox/bwrap/createBwrapSandbox'
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
// Exposed so consumers (and integration tests in dependent packages) can
// mount the file-routes plugin onto a standalone Fastify without booting
// the whole agent app. Used by workspace's FetchClient ↔ server contract tests.
export { fileRoutes } from './http/routes/file'
export {
  provisionRuntimeWorkspace,
  type ProvisionRuntimeWorkspaceOptions,
  type RuntimeWorkspaceProvisioningResult,
} from './workspace/provisionRuntime'
export { createVercelSandboxWorkspace } from './workspace/createVercelSandboxWorkspace'
export {
  createVercelProvisioningAdapter,
  VERCEL_PROVISIONING_CACHE_ROOT,
} from './sandbox/vercel-sandbox/provisioningAdapter'
export type {
  CreateVercelProvisioningAdapterOptions,
  VercelProvisioningArtifactRequest,
} from './sandbox/vercel-sandbox/provisioningAdapter'
export { provisionWorkspaceRuntime } from './workspace/provisioning'
export type {
  PluginSkillSource,
  ProvisionWorkspaceRuntimeOptions,
  RuntimeNodePackageSpec,
  RuntimeProvisioningContribution,
  RuntimePythonSpec,
  RuntimeTemplateContribution,
  WorkspaceProvisioningAdapter,
  WorkspaceProvisioningResult,
} from './workspace/provisioning'
export { autoDetectMode, hasBwrap, resolveMode } from './runtime/resolveMode'
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
export { createLogger } from './logging'
export type { Logger, LogFields } from './logging'
export type {
  BuiltinRuntimeModeId,
  ModeContext,
  RuntimeBundle,
  RuntimeModeAdapter,
  RuntimeModeId,
} from './runtime/mode'
