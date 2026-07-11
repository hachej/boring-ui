export { FileHandleStore } from './FileHandleStore'
export type { FileHandleStoreOptions } from './FileHandleStore'
export {
  bakeSnapshotIfNeeded,
  buildPackageHash,
  buildSnapshotRecipeHash,
} from './bake'
export type {
  BakeLogger,
  SnapshotBakeOptions,
  SnapshotBakeResult,
  VercelBakeClient,
  VercelBakeSandbox,
} from './bake'
export {
  CircuitBreaker,
  CircuitOpenError,
} from './circuitBreaker'
export type {
  CircuitBreakerOptions,
  CircuitBreakerState,
} from './circuitBreaker'
export { createDefaultVercelClient } from './client'
export type { VercelAuthConfig } from './client'
export { createVercelSandboxExec } from './createVercelSandboxExec'
export {
  createVercelSandboxWorkspace,
  invalidateVercelSandboxWorkspaceMetadataCache,
  VERCEL_SANDBOX_REMOTE_ROOT,
  VERCEL_SANDBOX_RUNTIME_CONTEXT,
  VERCEL_SANDBOX_WORKSPACE_ROOT,
} from './createVercelSandboxWorkspace'
export type {
  VercelSandboxWorkspace,
  VercelSandboxWorkspaceOptions,
} from './createVercelSandboxWorkspace'
export {
  createVercelDeploymentSnapshotProvider,
  prepareVercelDeploymentSnapshot,
  VERCEL_UV_SETUP_COMMANDS,
} from './deploymentSnapshot'
export type { VercelDeploymentSnapshotOptions } from './deploymentSnapshot'
export {
  extractHttpStatus,
  isOidcAuthError,
  OidcRefreshFailedError,
  OidcTokenRefresher,
} from './oidcRefresh'
export type {
  OidcTokenPayload,
  OidcTokenRefresherOptions,
} from './oidcRefresh'
export {
  clearTemplateCacheForTests,
  collectFiles,
  computeTemplateHash,
  packageTemplate,
} from './packageTemplate'
export type {
  PackageTemplateOptions,
  TemplateFile,
  TemplatePackageResult,
} from './packageTemplate'
export {
  applySnapshotRetention,
  createPeriodicSnapshotScheduler,
} from './periodicSnapshot'
export type {
  PeriodicSnapshotScheduler,
  PeriodicSnapshotSchedulerOptions,
  SnapshotHandle,
  SnapshotSchedulerSandbox,
} from './periodicSnapshot'
export {
  createVercelProvisioningAdapter,
  resolveVercelArtifactInstallSource,
  VERCEL_PROVISIONING_CACHE_ROOT,
} from './provisioningAdapter'
export type {
  CreateVercelProvisioningAdapterOptions,
  ProvisioningArtifactRequest,
  ResolveVercelInstallSourceArgs,
  ResolveVercelInstallSourceOptions,
  VercelProvisioningAdapter,
  VercelProvisioningArtifactKind,
  VercelProvisioningExecResult,
  VercelProvisioningRuntimeLayout,
  VercelProvisioningWorkspaceFs,
} from './provisioningAdapter'
export {
  evictSandboxHandleCacheForWorkspace,
  resetSandboxHandleCacheForTests,
  resolveSandboxHandle,
  SandboxHandleUnavailableError,
} from './resolveSandboxHandle'
export type {
  ExpiredSandboxPolicy,
  ResolveSandboxCreateParams,
  ResolveSandboxHandleOptions,
  VercelSandboxClient,
  VercelSandboxHandle,
} from './resolveSandboxHandle'
export type {
  SandboxHandleRecord,
  SandboxHandleStore,
} from './sandboxHandleStore'
export {
  buildDeploymentSnapshotRecipe,
  isNodeFamilyRuntime,
  NODE_UV_SETUP_COMMANDS,
  prepareDeploymentSnapshot,
  UV_SETUP_COMMANDS,
  uvSetupCommandsForRuntime,
  VERCEL_UV_BIN,
  VERCEL_UV_BIN_DIR,
} from './snapshotRecipe'
export type {
  BuildDeploymentSnapshotRecipeOptions,
  DeploymentSnapshotProvider,
  DeploymentSnapshotRecipe,
  DeploymentSnapshotResult,
  DeploymentSnapshotStatus,
} from './snapshotRecipe'
