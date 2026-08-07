// App-server surface (host integration). Plugin author types live on
// /server, not here — keep this barrel scoped to orchestration.
// resolveDefaultAgentFleet moved to @hachej/boring-agent/server (gh-1106
// slice 3 fix round 1, M9/B2): one canonical fleet-composition helper shared
// by createWorkspaceAgentServer, createCoreWorkspaceAgentServer, and the CLI
// hub. Re-exported here for callers that already import it from this barrel.
export {
  resolveDefaultAgentFleet,
  type ResolveDefaultAgentFleetOptions,
} from "@hachej/boring-agent/server"
export {
  buildWorkspaceContextPrompt,
  collectWorkspaceAgentServerPlugins,
  createWorkspaceAgentServer,
  createWorkspacePiResourceDigestInput,
  digestWorkspacePiResourceInputs,
  omitPluginAuthoringProvisioning,
  projectAgentSpecPluginArtifacts,
  provisionWorkspaceAgentServer,
  resolveWorkspaceAgentServerPluginCollection,
  readWorkspacePluginPackagePiSnapshot,
  readWorkspacePluginPackageRuntimePlugins,
  resolveBoringPiSkillPaths,
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
