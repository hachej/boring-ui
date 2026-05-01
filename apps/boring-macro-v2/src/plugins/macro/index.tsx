"use client"
import type { ComponentType } from "react"
import {
  composePlugins,
  createExplorerPlugin,
  defineFrontPlugin,
  type ExplorerRow,
  type WorkspaceFrontPlugin,
} from "@boring/workspace"
import { LineChart, Search, TrendingUp, Presentation } from "lucide-react"
import { chartCanvasPanel, deckPanel } from "./panels"
import { createMacroSeriesExplorerOptions } from "./catalogs"
import { macroSurfaceOutputs } from "./surfaceResolver"
import { MACRO_PLUGIN_ID } from "./constants"
import { openSeriesPane } from "./data/macroSeriesUi"
export { MacroStandaloneDeckRoute } from "./routes/StandaloneDeckRoute"

interface MacroChatSuggestion {
  label: string
  hint?: string
  icon?: ComponentType<{ className?: string }>
  prompt?: string
}

export const macroChatSuggestions: MacroChatSuggestion[] = [
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

export const macroShellOptions = {
  workspaceId: "boring-macro",
  appTitle: "boring.macro",
  sessionStorageKey: "boring-macro:sessions",
  surfaceStorageKey: "boring-macro:shell:surface",
  providerStorageKey: "boring-macro:layout",
  apiBaseUrl: "",
  apiTimeout: 10000,
  persistenceEnabled: true,
  chatParams: {
    suggestions: macroChatSuggestions,
    emptyTitle: "What macro question are we tackling?",
    emptyDescription: "Search FRED, plot a series, derive a transform, or draft a briefing deck.",
  },
} as const

export function makeMacroClientPlugin(
  onSeriesSelect: (row: ExplorerRow) => void = (row) => openSeriesPane(row.id),
): WorkspaceFrontPlugin {
  const macroPanelsPlugin = defineFrontPlugin({
    id: `${MACRO_PLUGIN_ID}:panels`,
    outputs: [
      { type: "panel", panel: chartCanvasPanel },
      { type: "panel", panel: deckPanel },
    ],
  })

  const macroSurfacesPlugin = defineFrontPlugin({
    id: `${MACRO_PLUGIN_ID}:surfaces`,
    outputs: macroSurfaceOutputs,
  })

  const macroSeriesCatalogPlugin = createExplorerPlugin(
    createMacroSeriesExplorerOptions(onSeriesSelect),
  )

  return composePlugins({
    id: MACRO_PLUGIN_ID,
    label: "Macro",
    plugins: [macroPanelsPlugin, macroSurfacesPlugin, macroSeriesCatalogPlugin],
  })
}

export const macroPlugin = makeMacroClientPlugin()
