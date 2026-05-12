import { definePanel, type PanelConfig } from "@boring/workspace"
import { MACRO_CHART_PANEL_ID, MACRO_DECK_PANEL_ID } from "../shared/constants"

const isViteDev = (): boolean =>
  Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV)

// Keep a stable URL for a given evaluated panels module. React.lazy may call
// an importer more than once while Suspense retries; using Date.now() per call
// creates a fresh module identity every retry and can leave the pane stuck in
// Loading. Reloaded front factories get a fresh module evaluation/revision.
const panelImportToken = Date.now()
const cacheBust = (): string => `t=${panelImportToken}`

async function loadChartCanvasPane() {
  if (isViteDev()) {
    return await import(/* @vite-ignore */ `./panels/ChartCanvasPane.tsx?${cacheBust()}`)
      .then((m) => ({ default: m.ChartCanvasPane }))
  }
  return await import("./panels/ChartCanvasPane").then((m) => ({ default: m.ChartCanvasPane }))
}

async function loadDeckPane() {
  if (isViteDev()) {
    return await import(/* @vite-ignore */ `./panels/DeckPane.tsx?${cacheBust()}`)
      .then((m) => ({ default: m.DeckPane }))
  }
  return await import("./panels/DeckPane").then((m) => ({ default: m.DeckPane }))
}

export const chartCanvasPanel: PanelConfig = definePanel({
  id: MACRO_CHART_PANEL_ID,
  title: "Chart",
  component: loadChartCanvasPane,
  lazy: true,
  placement: "center",
  source: "app",
})

export const deckPanel: PanelConfig = definePanel({
  id: MACRO_DECK_PANEL_ID,
  title: "Deck",
  component: loadDeckPane,
  lazy: true,
  placement: "center",
  source: "app",
})
