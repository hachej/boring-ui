import type { CreateExplorerPluginOptions, ExplorerRow } from "@boring/workspace"
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

export function createMacroSeriesExplorerOptions(
  onSelect: (row: ExplorerRow) => void,
): CreateExplorerPluginOptions {
  return {
    id: "macro-series",
    label: "Data",
    adapter: macroAdapter,
    facets: MACRO_FACETS,
    groupBy: "frequency",
    onActivate: onSelect,
    leftTab: { id: "macro-series", title: "Data" },
    catalog: { id: "macro-series", label: "Macro Series" },
    emptyState: "No series match",
    searchPlaceholder: "Search...",
    getDragPayload: (row) => ({ mimeType: "text/series-id", value: row.id }),
  }
}
