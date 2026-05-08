/**
 * dataCatalogPlugin — server composition layer.
 *
 * Wraps the agent-side pi extension factory (defined in `../agent/`) with
 * `defineServerPlugin` so that workspace server bootstrapping can pick it up
 * automatically.  HTTP routes are intentionally absent: the data catalog does
 * not expose any server endpoints of its own.
 */
import {
  defineServerPlugin,
  type WorkspaceServerPlugin,
} from "../../../server/plugins/bootstrapServer"
import { DATA_CATALOG_PLUGIN_ID } from "../shared/constants"
import {
  createDataCatalogPiExtension,
  type DataCatalogAgentPluginOptions,
} from "../agent"

export {
  createDataCatalogAgentTool,
  createDataCatalogPiExtension,
  createDataCatalogPiTool,
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
): WorkspaceServerPlugin {
  return defineServerPlugin({
    id: options.id ?? DATA_CATALOG_PLUGIN_ID,
    label: options.label ?? "Data Catalog",
    extensionFactories: [createDataCatalogPiExtension(options)],
  })
}
