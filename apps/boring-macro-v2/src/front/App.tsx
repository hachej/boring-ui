import { useMemo, useRef } from "react"
import {
  WorkspaceProvider,
  ChatCenteredShell,
  CodeEditorPane,
  DataProvider,
  EmptyPane,
  MarkdownEditorPane,
  type ChatSuggestion,
} from "@boring/workspace"
import {
  LineChart,
  Search,
  TrendingUp,
  Presentation,
} from "lucide-react"
import type {
  DataPaneConfig,
  PanelConfig,
  SurfaceShellApi,
} from "@boring/workspace"
import { useSessions, sessions } from "./sessions"
import { createMacroSeriesAdapter } from "./macroSeriesAdapter"
import { ChartCanvasPane } from "./panes/ChartCanvasPane"
import { DeckPane } from "./panes/DeckPane"

const FREQ_LABELS: Record<string, string> = {
  D: "Daily",
  W: "Weekly",
  M: "Monthly",
  Q: "Quarterly",
  SA: "Semiannual",
  A: "Annual",
}

// Wrappers that translate dockview's `{params, api/panelApi}` envelope into
// the flat `{path, panelApi}` shape CodeEditorPane and MarkdownEditorPane
// expect. Same pattern as workspace-playground's App.tsx — eventually
// these wrappers should disappear once the workspace built-in panes
// accept the dockview envelope directly.
function CodeEditorWrapper(props: Record<string, unknown>) {
  const p = props as { params?: { path?: string }; api?: unknown; panelApi?: unknown }
  const path = p.params?.path ?? ""
  return <CodeEditorPane path={path} panelApi={(p.api ?? p.panelApi) as never} chromeless />
}

function MarkdownEditorWrapper(props: Record<string, unknown>) {
  const p = props as { params?: { path?: string }; api?: unknown; panelApi?: unknown }
  const path = p.params?.path ?? ""
  return <MarkdownEditorPane path={path} panelApi={(p.api ?? p.panelApi) as never} chromeless />
}

const panels: PanelConfig[] = [
  // Built-in editors. The workspace package exports the components but
  // doesn't auto-register them — every consumer app picks which built-ins
  // it wants. Registering here lets file-tree clicks (and exec_ui from the
  // agent) open files in the workbench.
  {
    id: "code-editor",
    title: "Editor",
    component: CodeEditorWrapper as React.ComponentType<unknown>,
    placement: "center",
    source: "app",
    filePatterns: ["*"],
  },
  {
    id: "markdown-editor",
    title: "Markdown",
    component: MarkdownEditorWrapper as React.ComponentType<unknown>,
    placement: "center",
    source: "app",
    filePatterns: ["*.md", "*.markdown"],
  },
  // Macro-specific panes.
  {
    id: "chart-canvas",
    title: "Chart",
    component: ChartCanvasPane as React.ComponentType<unknown>,
    placement: "center",
    source: "app",
  },
  {
    id: "deck",
    title: "Deck",
    component: DeckPane as React.ComponentType<unknown>,
    placement: "center",
    source: "app",
  },
  {
    id: "empty",
    title: "Welcome",
    component: EmptyPane as React.ComponentType<unknown>,
    placement: "center",
    source: "app",
  },
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
  const { items, activeId } = useSessions()
  const sessionList = useMemo(() => items, [items])

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
      userInitial="J"
      sessions={sessionList}
      activeSessionId={activeId}
      onSwitchSession={sessions.switchTo}
      onCreateSession={sessions.create}
      onDeleteSession={sessions.remove}
      data={dataPaneConfig}
      extraPanels={["chart-canvas", "deck", "code-editor", "markdown-editor"]}
      chatSuggestions={macroChatSuggestions}
      emptyTitle="What macro question are we tackling?"
      emptyDescription="Search FRED, plot a series, derive a transform, or draft a briefing deck."
      // App-namespaced so this app's drawer/surface widths + the file-tree
      // sidebar collapsed/width all live under one prefix.
      storageKey="boring-macro:shell"
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
        persistenceEnabled
        storageKey="boring-macro-v2:layout"
      >
        <DataProvider apiBaseUrl="" authHeaders={{}} timeout={10000}>
          <Shell />
        </DataProvider>
      </WorkspaceProvider>
    </div>
  )
}
