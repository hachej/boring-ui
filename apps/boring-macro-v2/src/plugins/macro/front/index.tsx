"use client"
import type { ComponentType } from "react"
import type { BoringFrontFactory } from "@boring/workspace/plugin"
import {
  composePlugins,
  createExplorerOutputs,
  createExplorerPlugin,
  defineFrontPlugin,
  type ExplorerRow,
  type WorkspaceFrontPlugin,
} from "@boring/workspace"
import { LineChart, Search, TrendingUp, Presentation } from "lucide-react"
import { chartCanvasPanel, deckPanel } from "./panels"
import { createMacroSeriesExplorerOptions } from "./catalogs"
import { macroSurfaceOutputs } from "./surfaceResolver"
import {
  MACRO_CHART_PANEL_ID,
  MACRO_DECK_PANEL_ID,
  MACRO_PLUGIN_ID,
  MACRO_OPEN_SERIES_SURFACE_KIND,
} from "../shared/constants"
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
  surfaceStorageKey: "boring-macro:shell:v2:surface",
  defaultSurfaceOpen: true,
  defaultWorkbenchLeftTab: "macro-series",
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

const macroFront: BoringFrontFactory = (api) => {
  api.registerPanel({
    id: MACRO_CHART_PANEL_ID,
    label: "Chart",
    component: chartCanvasPanel.component,
    lazy: chartCanvasPanel.lazy,
    chromeless: chartCanvasPanel.chromeless,
  })
  api.registerPanel({
    id: MACRO_DECK_PANEL_ID,
    label: "Deck",
    component: deckPanel.component,
    lazy: deckPanel.lazy,
    chromeless: deckPanel.chromeless,
  })
  for (const output of createExplorerOutputs(createMacroSeriesExplorerOptions((row) => openSeriesPane(row.id)))) {
    if (output.type === "left-tab") {
      api.registerLeftTab({
        id: output.id,
        title: output.title,
        panelId: output.id,
        component: output.component,
        icon: output.icon,
        chromeless: output.chromeless,
        source: output.source,
      })
    } else if (output.type === "catalog") {
      api.registerCatalog(output.catalog)
    }
  }

  api.registerSurfaceResolver({
    id: "boring-macro-series",
    kind: MACRO_OPEN_SERIES_SURFACE_KIND,
    resolve(request) {
      const seriesId = request.target.trim()
      if (!seriesId) return null
      const meta = request.meta as { title?: string } | undefined
      return {
        id: `chart:${seriesId}`,
        component: MACRO_CHART_PANEL_ID,
        title: meta?.title || seriesId,
        params: { seriesId },
        score: 0,
      }
    },
  })
  api.registerSurfaceResolver({
    id: "boring-macro-deck-path",
    kind: "workspace.open.path",
    resolve(request) {
      const path = request.target.trim().replace(/\\/g, "/").replace(/^\.\//, "")
      if (!path.startsWith("deck/") || !path.endsWith(".md")) return null
      const rest = path.slice("deck/".length)
      if (!rest || rest.includes("/")) return null
      return {
        id: `file:${path}`,
        component: MACRO_DECK_PANEL_ID,
        title: path.split("/").pop() ?? path,
        params: { path },
        score: 10,
      }
    },
  })
}

export default macroFront
