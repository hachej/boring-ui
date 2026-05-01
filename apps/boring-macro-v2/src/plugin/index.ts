"use client"
import type { ChatSuggestion } from "@boring/agent"
import { appendDataCatalogOutputs, definePlugin, type Plugin } from "@boring/workspace"
import { LineChart, Search, TrendingUp, Presentation } from "lucide-react"
import { chartCanvasPanel, deckPanel } from "./panels"
import { createMacroSeriesDataCatalogOptions } from "./catalogs"
import { macroSurfaceOutputs } from "./surfaceResolver"
import { MACRO_PLUGIN_ID } from "./constants"
import type { ExplorerRow } from "@boring/workspace"

export const macroChatSuggestions: ChatSuggestion[] = [
  {
    label: "Find a series",
    hint: "Search 87k+ FRED series.",
    icon: Search,
    prompt:
      "Search the FRED catalog for series related to US inflation. Show the top matches with their frequency and units.",
  },
  {
    label: "Plot Real GDP",
    hint: "Open a chart in the canvas.",
    icon: LineChart,
    prompt: "Open a chart of Real GDP (GDPC1) over the last 20 years.",
  },
  {
    label: "Compute YoY growth",
    hint: "Persist a derived series.",
    icon: TrendingUp,
    prompt:
      "Compute the year-over-year growth of Real GDP and persist it as a derived series, then open the chart.",
  },
  {
    label: "Draft a briefing deck",
    hint: "Markdown under deck/.",
    icon: Presentation,
    prompt:
      "Draft a one-page briefing deck in deck/labor.md on the current state of the US labor market — embed UNRATE and PAYEMS as TimeSeries blocks.",
  },
]

export function makeMacroClientPlugin(onSeriesSelect: (row: ExplorerRow) => void): Plugin {
  const plugin = definePlugin({
    id: MACRO_PLUGIN_ID,
    label: "Macro",
    outputs: [
      { type: "panel", panel: chartCanvasPanel },
      { type: "panel", panel: deckPanel },
      ...macroSurfaceOutputs,
    ],
  })

  return appendDataCatalogOutputs(plugin, createMacroSeriesDataCatalogOptions(onSeriesSelect))
}
