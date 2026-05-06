import { definePanel, type PanelConfig } from "@boring/workspace"
import { MACRO_CHART_PANEL_ID, MACRO_DECK_PANEL_ID } from "../shared/constants"

export const chartCanvasPanel: PanelConfig = definePanel({
  id: MACRO_CHART_PANEL_ID,
  title: "Chart",
  component: () => import("./panels/ChartCanvasPane").then((m) => ({ default: m.ChartCanvasPane })),
  placement: "center",
  source: "app",
})

export const deckPanel: PanelConfig = definePanel({
  id: MACRO_DECK_PANEL_ID,
  title: "Deck",
  component: () => import("./panels/DeckPane").then((m) => ({ default: m.DeckPane })),
  placement: "center",
  source: "app",
})
