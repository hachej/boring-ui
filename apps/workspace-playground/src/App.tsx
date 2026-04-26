import { useEffect, useMemo } from "react"
import {
  WorkspaceProvider,
  ChatCenteredShell,
  DataProvider,
  CodeEditorPane,
  MarkdownEditorPane,
  EmptyPane,
  type DataPaneConfig,
  type PanelConfig,
} from "@boring/workspace"
import { mockSessions, useMockSessions } from "./mockSessions"
import { SHOWCASE_SESSION_ID, seedShowcase } from "./showcaseMessages"
import { createPlaygroundSeriesAdapter } from "./mockSeriesAdapter"

// ----- Panel registry -----

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
  { id: "code-editor", title: "Editor", component: CodeEditorWrapper as React.ComponentType<unknown>, placement: "center", source: "app" },
  { id: "markdown-editor", title: "Markdown", component: MarkdownEditorWrapper as React.ComponentType<unknown>, placement: "center", source: "app" },
  { id: "csv-viewer", title: "CSV", component: CodeEditorWrapper as React.ComponentType<unknown>, placement: "center", source: "app" },
  { id: "empty", title: "Welcome", component: EmptyPane as React.ComponentType<unknown>, placement: "center", source: "app" },
]

const FREQ_LABELS: Record<string, string> = {
  D: "Daily",
  W: "Weekly",
  M: "Monthly",
  Q: "Quarterly",
  SA: "Semiannual",
  A: "Annual",
}

const dataPaneConfig: DataPaneConfig = {
  adapter: createPlaygroundSeriesAdapter(),
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
      formatValue: (v) => (v === "fred" ? "FRED" : v === "derived" ? "Derived" : v),
    },
  ],
  // eslint-disable-next-line no-console
  onActivate: (row) => console.log("open series", row.id),
  getDragPayload: (row) => ({ mimeType: "text/series-id", value: row.id }),
  emptyState: "No series match",
}

function isShowcaseRoute(): boolean {
  if (typeof window === "undefined") return false
  return new URLSearchParams(window.location.search).get("showcase") === "1"
}

function Shell() {
  const { sessions, activeId } = useMockSessions()
  const showcase = useMemo(isShowcaseRoute, [])

  useEffect(() => {
    if (!showcase) return
    seedShowcase()
    if (mockSessions.getState().activeId !== SHOWCASE_SESSION_ID) {
      mockSessions.switchTo(SHOWCASE_SESSION_ID)
    }
  }, [showcase])

  const sessionList = useMemo(() => {
    if (!showcase) return sessions
    if (sessions.some((s) => s.id === SHOWCASE_SESSION_ID)) return sessions
    return [
      { id: SHOWCASE_SESSION_ID, title: "Showcase conversation", updatedAt: Date.now() },
      ...sessions,
    ]
  }, [showcase, sessions])

  return (
    <ChatCenteredShell
      appTitle="Boring"
      userInitial="J"
      sessions={sessionList}
      activeSessionId={activeId}
      onSwitchSession={mockSessions.switchTo}
      onCreateSession={mockSessions.create}
      onDeleteSession={mockSessions.remove}
      data={dataPaneConfig}
    />
  )
}

export function WorkspaceShell() {
  return (
    <div className="h-full bg-background text-foreground">
      <WorkspaceProvider
        panels={panels}
        apiBaseUrl=""
        persistenceEnabled={false}
        storageKey="boring-ui-v2:layout:playground"
      >
        <DataProvider apiBaseUrl="" authHeaders={{}} timeout={5000}>
          <Shell />
        </DataProvider>
      </WorkspaceProvider>
    </div>
  )
}
