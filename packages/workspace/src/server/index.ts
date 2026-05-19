/**
 * @hachej/boring-workspace/server — Node-only public API.
 *
 * Lower-level Node factories for advanced wiring. Hosts that want the
 * composed workspace + agent Fastify app should import
 * `createWorkspaceAgentServer` from `@hachej/boring-workspace/app/server`.
 *
 * Bundling: this entry MUST NOT be imported by browser code. The workspace
 * package's exports map keeps it under `./server`, and the front bundle's
 * tsconfig excludes `src/server/**`. The bundle isolation script at
 * `scripts/assert-bundle-isolation.mjs` fails the build if browser-side
 * code reaches in here.
 */
// Testing utilities (for tests that need custom bridge wiring)
export { createInMemoryBridge } from "./bridge/createInMemoryBridge"
export { uiRoutes } from "./ui-control/http/uiRoutes"
export type { UiRoutesOptions } from "./ui-control/http/uiRoutes"
export {
  createGetUiStateTool,
  createExecUiTool,
  createWorkspaceUiTools,
} from "./ui-control/tools/uiTools"
export type { UiBridge, UiState, UiCommand, CommandResult } from "../shared/ui-bridge"
export {
  ServerPluginError,
  bootstrapServer,
  defineServerPlugin,
  validateServerPlugin,
} from "./plugins/bootstrapServer"
export type {
  ServerBootstrapOptions,
  ServerBootstrapResult,
  WorkspacePiPackageSource,
  WorkspaceProvisioningContribution,
  WorkspaceRouteContribution,
  WorkspaceServerPlugin,
} from "./plugins/bootstrapServer"
// Boring plugin asset manager + reload-pluggability helpers.
export { buildBoringSystemPrompt } from "./boringSystemPrompt"
export { BoringPluginAssetManager } from "./agentPlugins/manager"
export { boringPluginRoutes, collectRestartWarnings } from "./agentPlugins/routes"
export type { PluginReloadRebuild, PluginRestartWarning } from "./agentPlugins/routes"
export { aggregatePluginPrompts } from "./agentPlugins/aggregatePluginPrompts"
export { preflightBoringPlugins, readBoringPlugins } from "./agentPlugins/scan"
export type {
  BoringPluginEvent,
  BoringPluginListEntry,
  BoringServerPluginManifest,
} from "./agentPlugins/types"

// dataCatalog factories moved to the standalone @hachej/boring-data-catalog
// package — import from there instead of re-exporting from /server.
