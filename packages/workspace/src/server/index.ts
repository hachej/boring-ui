/**
 * @boring/workspace/server — Node-only public API.
 *
 * Hosts call createWorkspaceAgentApp to boot a Fastify app that includes
 * both the agent's LLM harness AND the workspace UI bridge surface.
 * Direct factories (createInMemoryBridge, uiRoutes, createWorkspaceUiTools)
 * are exposed for advanced wiring — most consumers only need the wrapper.
 *
 * Bundling: this entry MUST NOT be imported by browser code. The workspace
 * package's exports map keeps it under `./server`, and the front bundle's
 * tsconfig excludes `src/server/**`. The bundle isolation script at
 * `scripts/assert-bundle-isolation.mjs` fails the build if browser-side
 * code reaches in here.
 */
export {
  createWorkspaceAgentApp,
  type CreateWorkspaceAgentAppOptions,
  type WorkspaceAgentDeps,
} from "./createWorkspaceAgentApp"
export { createInMemoryBridge } from "./ui-bridge/createInMemoryBridge"
export { uiRoutes } from "./http/uiRoutes"
export type { UiRoutesOptions } from "./http/uiRoutes"
export {
  createGetUiStateTool,
  createExecUiTool,
  createWorkspaceUiTools,
} from "./uiTools"
export type { UiBridge, UiState, UiCommand, CommandResult } from "../shared/ui-bridge"
