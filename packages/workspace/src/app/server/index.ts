// App-server surface (host integration). Plugin author types live on
// /server, not here — keep this barrel scoped to orchestration.
export {
  buildWorkspaceContextPrompt,
  collectWorkspaceAgentServerPlugins,
  createWorkspaceAgentServer,
  provisionWorkspaceAgentServer,
  readWorkspacePluginPackagePiSnapshot,
  resolveDefaultWorkspacePluginPackagePaths,
  type CollectWorkspaceAgentServerPluginsOptions,
  type CreateWorkspaceAgentServerOptions,
  type ResolveDefaultWorkspacePluginPackagePathsOptions,
  type WorkspaceAgentPiOptions,
  type WorkspaceAgentServerPluginCollection,
  type WorkspaceAgentServerPluginContext,
  type WorkspacePluginPackagePiSnapshot,
  type WorkspacePluginEntry,
} from "./createWorkspaceAgentServer"
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
