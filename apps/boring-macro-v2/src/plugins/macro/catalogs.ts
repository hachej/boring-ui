import type { CreateDataCatalogOutputsOptions, ExplorerRow } from "@boring/workspace"
import { createMacroSeriesAdapter } from "./data/macroSeriesAdapter"
import { FREQ_LABELS } from "./data/macroSeriesUi"

const macroAdapter = createMacroSeriesAdapter()

export const MACRO_FACETS = [
  {
    key: "frequency" as const,
    label: "Frequency",
    order: ["D", "W", "M", "Q", "SA", "A"],
    formatValue: (v: string) => FREQ_LABELS[v] ?? v,
  },
  {
    key: "source" as const,
    label: "Source",
    formatValue: (v: string) =>
      v === "fred" ? "FRED" : v === "derived" ? "Derived" : v,
  },
]

export function createMacroSeriesDataCatalogOptions(
  onSelect: (row: ExplorerRow) => void,
): CreateDataCatalogOutputsOptions {
  return {
    id: "macro-series",
    label: "Data",
    adapter: macroAdapter,
    facets: MACRO_FACETS,
    groupBy: "frequency",
    onSelect,
    leftTabId: "macro-series",
    leftTabTitle: "Data",
    catalogId: "macro-series",
    catalogLabel: "Macro Series",
    includeVisualizationPanel: false,
    emptyState: "No series match",
    searchPlaceholder: "Search...",
    getDragPayload: (row) => ({ mimeType: "text/series-id", value: row.id }),
  }
}
