import {
  WORKSPACE_OPEN_PATH_SURFACE_KIND,
  appendDataCatalogOutputs,
  defineFrontPlugin,
  postUiCommand,
  type CreateDataCatalogOutputsOptions,
  type ExplorerAdapter,
  type ExplorerRow,
  type WorkspaceFrontPlugin,
} from "@boring/workspace"
import { PLAYGROUND_DATA_PLUGIN_ID } from "../shared/constants"
import { PLAYGROUND_CSV_DATASETS } from "../shared/fixtures"

const rows: ExplorerRow[] = PLAYGROUND_CSV_DATASETS.map((dataset) => ({
  id: dataset.path,
  title: dataset.title,
  subtitle: dataset.description,
  group: "CSV",
  leading: { code: "CSV", tooltip: "CSV fixture" },
  meta: dataset.columns.join(", "),
}))

const adapter: ExplorerAdapter = {
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

function openDataset(row: ExplorerRow): void {
  postUiCommand({
    kind: "openSurface",
    params: {
      kind: WORKSPACE_OPEN_PATH_SURFACE_KIND,
      target: row.id,
      meta: { row, catalogId: PLAYGROUND_DATA_PLUGIN_ID },
    },
  })
}

function createPlaygroundDataCatalogOptions(): CreateDataCatalogOutputsOptions {
  return {
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

export const playgroundDataCatalogPlugin: WorkspaceFrontPlugin = appendDataCatalogOutputs(
  defineFrontPlugin({
    id: PLAYGROUND_DATA_PLUGIN_ID,
    label: "Playground Data",
  }),
  createPlaygroundDataCatalogOptions(),
)
