/**
 * @boring/workspace/server — Node-only public API.
 *
 * Lower-level Node factories for advanced wiring. Hosts that want the
 * composed workspace + agent Fastify app should import
 * `createWorkspaceAgentServer` from `@boring/workspace/app/server`.
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
  composeServerPlugins,
  defineServerPlugin,
  validateServerPlugin,
} from "./plugins/bootstrapServer"
export type {
  ComposeServerPluginsOptions,
  ServerBootstrapOptions,
  ServerBootstrapResult,
  WorkspacePiPackageSource,
  WorkspaceProvisioningContribution,
  WorkspaceRouteContribution,
  WorkspaceServerPlugin,
} from "./plugins/bootstrapServer"
export {
  createDataCatalogAgentTool,
  createDataCatalogServerPlugin,
  createDataCatalogSkillPrompt,
  formatDataCatalogSearchResult,
} from "../plugins/dataCatalogPlugin/server"
export type {
  DataCatalogAgentToolOptions,
  DataCatalogServerPluginOptions,
  DataCatalogSkillOptions,
} from "../plugins/dataCatalogPlugin/server"
