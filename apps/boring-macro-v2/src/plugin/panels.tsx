import { definePanel, type PanelConfig } from "@boring/workspace"
import { ChartCanvasPane } from "../front/panes/ChartCanvasPane"
import { DeckPane } from "../front/panes/DeckPane"
import { MACRO_CHART_PANEL_ID, MACRO_DECK_PANEL_ID } from "./constants"

export const chartCanvasPanel: PanelConfig = definePanel({
  id: MACRO_CHART_PANEL_ID,
  title: "Chart",
  component: ChartCanvasPane,
  placement: "center",
  source: "app",
})

export const deckPanel: PanelConfig = definePanel({
  id: MACRO_DECK_PANEL_ID,
  title: "Deck",
  component: DeckPane,
  placement: "center",
  source: "app",
})
