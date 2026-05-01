import {
  createDataCatalogPlugin,
  type ExplorerAdapter,
  type ExplorerRow,
  type Facets,
  type FacetConfig,
  type SearchArgs,
} from "@boring/workspace"
import {
  PLAYGROUND_DATA_PLUGIN_ID,
  PLAYGROUND_DATA_VISUALIZATION_PANEL_ID,
} from "./constants"
import { PLAYGROUND_CSV_DATASETS, type PlaygroundCsvDataset } from "./fixtures"

const FORMAT_LABELS: Record<string, string> = {
  csv: "CSV",
}

function toRow(item: PlaygroundCsvDataset): ExplorerRow {
  return {
    id: item.id,
    title: item.title,
    subtitle: `${item.description} Table ${item.table} from ${item.path}; columns ${item.columns.join(", ")}.`,
    group: "csv",
    leading: {
      code: "CSV",
      tooltip: item.path,
    },
    trailing: [{ code: "SQL", tooltip: `Queryable as ${item.table}` }],
    meta: `${item.rows} rows`,
  }
}

function matchesQuery(item: PlaygroundCsvDataset, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return [
    item.id,
    item.path,
    item.table,
    item.title,
    item.description,
    item.source,
    ...item.columns,
  ].some((value) => value.toLowerCase().includes(q))
}

function matchesFilters(item: PlaygroundCsvDataset, filters: SearchArgs["filters"]): boolean {
  for (const [key, values] of Object.entries(filters)) {
    if (values.length === 0) continue
    if (key === "format" && !values.includes("csv")) return false
    if (key === "table" && !values.includes(item.table)) return false
  }
  return true
}

function countFacet(
  key: "format" | "table",
  pool: PlaygroundCsvDataset[],
): Facets[string] {
  const counts = new Map<string, number>()
  for (const item of pool) {
    const value = key === "format" ? "csv" : item.table
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts.entries()].map(([value, count]) => ({ value, count }))
}

const adapter: ExplorerAdapter = {
  async search(args) {
    const pool = PLAYGROUND_CSV_DATASETS.filter((item) => {
      if (args.group) {
        if (args.group.key !== "format" || args.group.value !== "csv") {
          return false
        }
      }
      return matchesQuery(item, args.query) && matchesFilters(item, args.filters)
    })
    const items = pool.slice(args.offset, args.offset + args.limit).map(toRow)
    return {
      items,
      total: pool.length,
      hasMore: args.offset + items.length < pool.length,
    }
  },
  async fetchFacets(args) {
    const pool = PLAYGROUND_CSV_DATASETS.filter((item) => matchesFilters(item, args.filters))
    return {
      format: countFacet("format", pool),
      table: countFacet("table", pool),
    }
  },
}

const facets: FacetConfig[] = [
  {
    key: "format",
    label: "Format",
    order: ["csv"],
    formatValue: (value) => FORMAT_LABELS[value] ?? value,
  },
  {
    key: "table",
    label: "Table",
  },
]

export const playgroundDataCatalogPlugin = createDataCatalogPlugin({
  id: PLAYGROUND_DATA_PLUGIN_ID,
  label: "Data",
  adapter,
  facets,
  leftTabId: PLAYGROUND_DATA_PLUGIN_ID,
  catalogId: PLAYGROUND_DATA_PLUGIN_ID,
  catalogLabel: "Playground Data",
  visualizationPanelId: PLAYGROUND_DATA_VISUALIZATION_PANEL_ID,
  visualizationTitle: "Data Preview",
  emptyState: "No demo CSV datasets match",
  getDragPayload: (row) => ({ mimeType: "text/csv-path", value: row.id }),
})
