import type { CatalogConfig, ExplorerRow } from "@boring/workspace"
import { createMacroSeriesAdapter } from "../front/macroSeriesAdapter"
import { FREQ_LABELS } from "../front/macroSeriesUi"

const macroAdapter = createMacroSeriesAdapter()

export function createSeriesCatalog(onSelect: (row: ExplorerRow) => void): CatalogConfig {
  return {
    id: "macro-series",
    label: "Macro Series",
    adapter: macroAdapter,
    onSelect,
  }
}

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
