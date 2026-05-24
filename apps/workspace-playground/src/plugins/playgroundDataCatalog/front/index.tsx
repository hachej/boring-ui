import {
  WORKSPACE_OPEN_PATH_SURFACE_KIND,
  emitUiEffect,
} from "@hachej/boring-workspace"
import type { BoringFrontFactoryWithId } from "@hachej/boring-workspace/plugin"
import {
  createDataCatalogPlugin,
  type CreateDataCatalogPluginOptions,
  type DataCatalogSelectContext,
} from "@hachej/boring-data-catalog/front"
import type { ExplorerDataSource, ExplorerItem } from "@hachej/boring-data-explorer/shared"
import { PLAYGROUND_DATA_PLUGIN_ID } from "../shared/constants"
import { PLAYGROUND_CSV_DATASETS } from "../shared/fixtures"

const rows: ExplorerItem[] = PLAYGROUND_CSV_DATASETS.map((dataset) => ({
  id: dataset.path,
  title: dataset.title,
  subtitle: dataset.description,
  group: "CSV",
  leading: { code: "CSV", tooltip: "CSV fixture" },
  meta: dataset.columns.join(", "),
}))

const adapter: ExplorerDataSource = {
  async search({ query, limit, offset, group }) {
    const q = query.trim().toLowerCase()
    let pool = rows
    if (group) {
      pool = pool.filter((row) => row.group === group.value)
    }
    if (q) {
      pool = pool.filter(
        (row) =>
          row.id.toLowerCase().includes(q) ||
          row.title.toLowerCase().includes(q) ||
          (row.subtitle?.toLowerCase().includes(q) ?? false) ||
          (row.meta?.toLowerCase().includes(q) ?? false),
      )
    }
    const items = pool.slice(offset, offset + limit)
    return {
      items,
      total: pool.length,
      hasMore: offset + items.length < pool.length,
    }
  },
  async fetchFacets() {
    return { type: [{ value: "CSV", count: rows.length }] }
  },
}

function openDataset(row: ExplorerItem, context: DataCatalogSelectContext): void {
  if (context.bridge) {
    void context.bridge.openFile(row.id, { mode: "edit" })
    return
  }

  emitUiEffect({
    kind: "openSurface",
    params: {
      kind: WORKSPACE_OPEN_PATH_SURFACE_KIND,
      target: row.id,
      meta: { row, catalogId: PLAYGROUND_DATA_PLUGIN_ID },
    },
  })
}

function createPlaygroundDataCatalogOptions(): CreateDataCatalogPluginOptions {
  return {
    pluginId: PLAYGROUND_DATA_PLUGIN_ID,
    id: PLAYGROUND_DATA_PLUGIN_ID,
    label: "Data",
    adapter,
    groupBy: "type",
    facets: [{ key: "type", label: "Type", order: ["CSV"] }],
    onSelect: openDataset,
    leftTabId: "playground-data",
    leftTabTitle: "Data",
    catalogId: PLAYGROUND_DATA_PLUGIN_ID,
    catalogLabel: "Playground Data",
    emptyState: "No datasets match",
    getDragPayload: (row) => ({ mimeType: "text/plain", value: row.id }),
  }
}

const playgroundDataCatalogPlugin: BoringFrontFactoryWithId =
  createDataCatalogPlugin(createPlaygroundDataCatalogOptions())

export default playgroundDataCatalogPlugin
