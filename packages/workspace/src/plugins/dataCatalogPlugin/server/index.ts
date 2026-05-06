/**
 * dataCatalogPlugin — server composition layer.
 *
 * Wraps the agent-side tool and skill prompt (defined in `../agent/`) with
 * `defineServerPlugin` so that workspace server bootstrapping can pick them up
 * automatically.  HTTP routes are intentionally absent: the data catalog does
 * not expose any server endpoints of its own.
 */
import {
  defineServerPlugin,
  type WorkspaceServerPlugin,
} from "../../../server/plugins/bootstrapServer"
import type { AgentTool } from "../../../shared/types/agent-tool"
import { DATA_CATALOG_PLUGIN_ID } from "../shared/constants"
import {
  createDataCatalogAgentTool,
  createDataCatalogSkillPrompt,
  type DataCatalogAgentPluginOptions,
} from "../agent"

export {
  createDataCatalogAgentTool,
  createDataCatalogSkillPrompt,
  formatDataCatalogSearchResult,
} from "../agent"
export type {
  DataCatalogAgentPluginOptions,
  DataCatalogAgentToolOptions,
  DataCatalogSkillOptions,
} from "../agent"

/**
 * @deprecated Use `DataCatalogAgentPluginOptions` — the name now correctly
 * reflects that this plugin has no server routes.
 */
export type DataCatalogServerPluginOptions = DataCatalogAgentPluginOptions

export function createDataCatalogServerPlugin(
  options: DataCatalogAgentPluginOptions,
): WorkspaceServerPlugin & { agentTools: AgentTool[]; systemPrompt: string } {
  const tool = createDataCatalogAgentTool(options)
  return defineServerPlugin({
    id: options.id ?? DATA_CATALOG_PLUGIN_ID,
    label: options.label ?? "Data Catalog",
    agentTools: [tool],
    systemPrompt: createDataCatalogSkillPrompt({
      label: options.label,
      toolName: tool.name,
      surfaceKind: options.surfaceKind,
      guidance: options.guidance,
    }),
  })
}
