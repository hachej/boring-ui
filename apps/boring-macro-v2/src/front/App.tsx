import { useMemo, useRef } from "react"
import {
  WorkspaceProvider,
  ChatCenteredShell,
  EmptyPane,
  defaultEditorPanels,
  definePanel,
  type ChatSuggestion,
  type DataPaneConfig,
  type PanelConfig,
  type SurfaceShellApi,
} from "@boring/workspace"
import {
  createLocalStorageSessions,
  useLocalStorageSessions,
} from "@boring/workspace/testing"
import { LineChart, Search, TrendingUp, Presentation } from "lucide-react"
import { createMacroSeriesAdapter } from "./macroSeriesAdapter"
import { FREQ_LABELS } from "./macroSeriesUi"
import { ChartCanvasPane } from "./panes/ChartCanvasPane"
import { DeckPane } from "./panes/DeckPane"

const MODEL_STORAGE_KEY = "boring-agent:composer:model"
const INFOMANIAK_TOOL_MODEL = {
  provider: "infomaniak",
  id: "Qwen/Qwen3.5-122B-A10B-FP8",
}

function preferInfomaniakDefaultModel(): void {
  try {
    const raw = localStorage.getItem(MODEL_STORAGE_KEY)
    if (!raw || raw.includes("anthropic") || raw.includes("moonshotai/Kimi-K2.6")) {
      localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(INFOMANIAK_TOOL_MODEL))
    }
  } catch { /* storage unavailable */ }
}

const sessionsStore = createLocalStorageSessions({ storageKey: "boring-macro:sessions" })

type MacroPanelConfig = PanelConfig<any>

const panels: MacroPanelConfig[] = [
  ...defaultEditorPanels,
  definePanel({
    id: "chart-canvas",
    title: "Chart",
    component: ChartCanvasPane,
    placement: "center",
    source: "app",
  }),
  definePanel({
    id: "deck",
    title: "Deck",
    component: DeckPane,
    placement: "center",
    source: "app",
    // Files under deck/ open as the slide viewer; other .md files still
    // route to the default markdown editor (suffixLen 9 > 3 wins).
    filePatterns: ["deck/*.md"],
  }),
  definePanel({
    id: "empty",
    title: "Welcome",
    component: EmptyPane,
    placement: "center",
    source: "app",
  }),
]

// Hoisted so its in-flight requests survive parent re-renders.
const macroAdapter = createMacroSeriesAdapter()

const macroChatSuggestions: ChatSuggestion[] = [
  {
    label: "Find a series",
    hint: "Search 87k+ FRED series.",
    icon: Search,
    prompt: "Search the FRED catalog for series related to US inflation. Show the top matches with their frequency and units.",
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
    prompt: "Compute the year-over-year growth of Real GDP and persist it as a derived series, then open the chart.",
  },
  {
    label: "Draft a briefing deck",
    hint: "Markdown under deck/.",
    icon: Presentation,
    prompt: "Draft a one-page briefing deck in deck/labor.md on the current state of the US labor market — embed UNRATE and PAYEMS as TimeSeries blocks.",
  },
]

function Shell() {
  preferInfomaniakDefaultModel()
  const { sessions, activeId } = useLocalStorageSessions(sessionsStore)

  // The catalog onActivate runs after dockview is ready, so a ref captured
  // via onSurfaceReady is sufficient — no React state needed.
  const surfaceRef = useRef<SurfaceShellApi | null>(null)

  const dataPaneConfig = useMemo<DataPaneConfig>(
    () => ({
      adapter: macroAdapter,
      groupBy: "frequency",
      facets: [
        {
          key: "frequency",
          label: "Frequency",
          order: ["D", "W", "M", "Q", "SA", "A"],
          formatValue: (v) => FREQ_LABELS[v] ?? v,
        },
        {
          key: "source",
          label: "Source",
          formatValue: (v) =>
            v === "fred" ? "FRED" : v === "derived" ? "Derived" : v,
        },
      ],
      onActivate: (row) => {
        surfaceRef.current?.openPanel({
          id: `chart:${row.id}`,
          component: "chart-canvas",
          title: row.id,
          params: { seriesId: row.id },
        })
      },
      getDragPayload: (row) => ({ mimeType: "text/series-id", value: row.id }),
      emptyState: "No series match",
    }),
    [],
  )

  return (
    <ChatCenteredShell
      appTitle="boring.macro"
      sessions={sessions}
      activeSessionId={activeId}
      onSwitchSession={sessionsStore.switchTo}
      onCreateSession={sessionsStore.create}
      onDeleteSession={sessionsStore.remove}
      data={dataPaneConfig}
      // code-editor + markdown-editor are in defaultAllowedPanels; only
      // list panels NOT covered by the default workbench allowlist.
      extraPanels={["chart-canvas", "deck"]}
      chatSuggestions={macroChatSuggestions}
      thinkingControl
      emptyTitle="What macro question are we tackling?"
      emptyDescription="Search FRED, plot a series, derive a transform, or draft a briefing deck."
      // App-namespaced so this app's drawer/surface widths + the file-tree
      // sidebar collapsed/width all live under one prefix. v3 resets stale
      // local state from earlier builds, which could persist the workbench
      // closed and make Files/Data appear empty.
      storageKey="boring-macro:shell:v3"
      surfaceDefaultOpen
      onSurfaceReady={(api) => {
        surfaceRef.current = api
      }}
    />
  )
}

export function App() {
  return (
    <div className="h-full bg-background text-foreground">
      <WorkspaceProvider
        panels={panels}
        apiBaseUrl=""
        apiTimeout={60000}
        persistenceEnabled
        storageKey="boring-macro:layout"
      >
        <Shell />
      </WorkspaceProvider>
    </div>
  )
}
