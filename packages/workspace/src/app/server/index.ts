// App-server surface (host integration). Plugin author types live on
// /server, not here — keep this barrel scoped to orchestration.
export {
  buildWorkspaceContextPrompt,
  collectWorkspaceAgentServerPlugins,
  createWorkspaceAgentServer,
  omitPluginAuthoringProvisioning,
  provisionWorkspaceAgentServer,
  readWorkspacePluginPackagePiSnapshot,
  readWorkspacePluginPackageRuntimePlugins,
  PLUGIN_AUTHORING_PROVISIONING_IDS,
  type CollectWorkspaceAgentServerPluginsOptions,
  type CreateWorkspaceAgentServerOptions,
  type WorkspaceAgentPiOptions,
  type WorkspaceAgentServerPluginCollection,
  type WorkspaceAgentServerPluginContext,
  type WorkspacePluginPackagePiSnapshot,
  type WorkspacePluginEntry,
  type WorkspaceRuntimeProvisioningInput,
} from "./createWorkspaceAgentServer"
export {
  resolveDefaultWorkspacePluginPackagePaths,
  type ResolveDefaultWorkspacePluginPackagePathsOptions,
} from "./defaultPluginPackages"
export {
  hasDirServerPlugin,
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
