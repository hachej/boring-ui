// App-server surface (host integration). Plugin author types live on
// /server, not here — keep this barrel scoped to orchestration.
export {
  buildWorkspaceContextPrompt,
  collectWorkspaceAgentServerPlugins,
  createWorkspaceAgentServer,
  provisionWorkspaceAgentServer,
  readWorkspacePluginPackagePiSnapshot,
  type CollectWorkspaceAgentServerPluginsOptions,
  type CreateWorkspaceAgentServerOptions,
  type WorkspaceAgentPiOptions,
  type WorkspaceAgentServerPluginCollection,
  type WorkspaceAgentServerPluginContext,
  type WorkspacePluginPackagePiSnapshot,
  type WorkspacePluginEntry,
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
} from "../../server/plugins/bootstrapServer"
