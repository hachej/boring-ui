import {
  definePanel,
  DataExplorer,
  type PanelConfig,
  type PaneProps,
  type ExplorerRow,
} from "@boring/workspace"
import { ChartCanvasPane } from "../front/panes/ChartCanvasPane"
import { DeckPane } from "../front/panes/DeckPane"
import { createMacroSeriesAdapter } from "../front/macroSeriesAdapter"
import { openSeriesPane, FREQ_LABELS } from "../front/macroSeriesUi"

export const chartCanvasPanel: PanelConfig = definePanel({
  id: "chart-canvas",
  title: "Chart",
  component: ChartCanvasPane,
  placement: "center",
  source: "app",
})

export const deckPanel: PanelConfig = definePanel({
  id: "deck",
  title: "Deck",
  component: DeckPane,
  placement: "center",
  source: "app",
  filePatterns: ["deck/*.md"],
})

const macroAdapter = createMacroSeriesAdapter()

const macroSeriesFacets = [
  {
    key: "frequency",
    label: "Frequency",
    order: ["D", "W", "M", "Q", "SA", "A"],
    formatValue: (v: string) => FREQ_LABELS[v] ?? v,
  },
  {
    key: "source",
    label: "Source",
    formatValue: (v: string) =>
      v === "fred" ? "FRED" : v === "derived" ? "Derived" : v,
  },
]

function MacroSeriesPane(_props: PaneProps) {
  return (
    <DataExplorer
      adapter={macroAdapter}
      groupBy="frequency"
      facets={macroSeriesFacets}
      onActivate={(row: ExplorerRow) => openSeriesPane(row.id)}
      getDragPayload={(row: ExplorerRow) => ({ mimeType: "text/series-id", value: row.id })}
      emptyState="No series match"
    />
  )
}

export const macroSeriesPanel: PanelConfig = definePanel({
  id: "macro-series",
  title: "Data",
  component: MacroSeriesPane,
  placement: "left-tab",
  source: "app",
})
