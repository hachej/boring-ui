// App-server surface (host integration). Plugin author types live on
// /server, not here — keep this barrel scoped to orchestration.
export {
  buildWorkspaceContextPrompt,
  collectWorkspaceAgentServerPlugins,
  createWorkspaceAgentServer,
  provisionWorkspaceAgentServer,
  type CollectWorkspaceAgentServerPluginsOptions,
  type CreateWorkspaceAgentServerOptions,
  type WorkspaceAgentPiOptions,
  type WorkspaceAgentServerPluginCollection,
  type WorkspaceAgentServerPluginContext,
} from "./createWorkspaceAgentServer"
export type {
  WorkspacePiPackageSource,
  WorkspaceProvisioningContribution,
  WorkspaceRouteContribution,
} from "../../server/plugins/bootstrapServer"
