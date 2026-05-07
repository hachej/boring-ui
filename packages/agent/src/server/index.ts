// @boring/agent — server (Node-only) public API
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
export {
  provisionRuntimeWorkspace,
  type ProvisionRuntimeWorkspaceOptions,
  type RuntimeWorkspaceProvisioningResult,
  type RuntimeProvisioningContribution,
  type RuntimeTemplateContribution,
  type RuntimePythonSpec,
  type RuntimeNodePackageSpec,
} from './workspace/provisionRuntime'
export { createVercelSandboxWorkspace } from './workspace/createVercelSandboxWorkspace'
export { autoDetectMode, hasBwrap, resolveMode } from './runtime/resolveMode'
export { createAgentApp } from './createAgentApp'
export type { CreateAgentAppOptions } from './createAgentApp'
export type {
  PiPackageSource,
  PiResourceLoaderOptions,
} from './harness/pi-coding-agent/createHarness'
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
  ModeContext,
  RuntimeBundle,
  RuntimeModeAdapter,
  RuntimeModeId,
} from './runtime/mode'
