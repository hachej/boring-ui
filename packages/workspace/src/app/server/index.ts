// App-server surface (host integration). Plugin author types live on
// /server, not here — keep this barrel scoped to orchestration.
export {
  buildWorkspaceContextPrompt,
  collectWorkspaceAgentServerPlugins,
  createWorkspaceAgentServer,
  omitPluginAuthoringProvisioning,
  projectAgentSpecPluginArtifacts,
  provisionWorkspaceAgentServer,
  resolveWorkspaceAgentServerPluginCollection,
  readWorkspacePluginPackagePiSnapshot,
  readWorkspacePluginPackageRuntimePlugins,
  PLUGIN_AUTHORING_PROVISIONING_IDS,
  AGENT_SPEC_PLUGIN_PROJECTION_ERROR_CODE,
  AgentSpecPluginProjectionError,
  type AgentSpecPluginArtifactProjection,
  type CollectWorkspaceAgentServerPluginsOptions,
  type CreateWorkspaceAgentServerOptions,
  type WorkspaceAgentPiOptions,
  type WorkspaceAgentServerPluginCollection,
  type WorkspaceAgentServerPluginContext,
  type WorkspacePluginPackagePiSnapshot,
  type WorkspacePluginEntry,
  type WorkspaceRuntimeProvisioningInput,
  type ResolveWorkspaceAgentServerPluginCollectionOptions,
  type ResolvedWorkspacePluginArtifact,
} from "./createWorkspaceAgentServer"
export {
  resolveDefaultWorkspacePluginPackagePaths,
  type ResolveDefaultWorkspacePluginPackagePathsOptions,
} from "./defaultPluginPackages"
export {
  createSandboxRuntimeModeAdapter,
  sandboxRuntimeHostOperations,
  type SandboxRuntimeModeOptions,
} from './sandboxRuntimeHost'
export {
  assertWorkspaceBridgeHandlersTrusted,
  hasDirServerPlugin,
  isTrustedWorkspaceBridgeHandlerEntry,
  resolveOnePluginEntry,
  type DirPluginEntry,
  type PluginResolveContext,
} from "./pluginEntryResolver"
export type {
  WorkspacePiPackageSource,
  WorkspaceProvisioningContribution,
  WorkspaceRouteContribution,
  WorkspaceRuntimeProvisioningInput as ServerWorkspaceRuntimeProvisioningInput,
} from "../../server/plugins/bootstrapServer"
