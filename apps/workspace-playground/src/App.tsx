import { useEffect, useMemo } from "react"
import {
  WorkspaceProvider,
  ChatCenteredShell,
  DataProvider,
  CodeEditorPane,
  MarkdownEditorPane,
  EmptyPane,
  type PanelConfig,
} from "@boring/workspace"
import { mockSessions, useMockSessions } from "./mockSessions"
import { SHOWCASE_SESSION_ID, seedShowcase } from "./showcaseMessages"

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

const dataSources = [
  { id: "users", name: "users", type: "table", description: "Account + profile rows" },
  { id: "events", name: "events", type: "stream", description: "Raw event firehose" },
  { id: "sessions", name: "sessions_daily", type: "view", description: "Rolled-up session metrics" },
  { id: "logs", name: "app_logs", type: "index", description: "Structured application logs" },
]

function isShowcaseRoute(): boolean {
  if (typeof window === "undefined") return false
  return new URLSearchParams(window.location.search).get("showcase") === "1"
}

function Shell() {
  const { sessions, activeId } = useMockSessions()
  const showcase = useMemo(isShowcaseRoute, [])

  // Showcase = a one-shot seed: hydrate the fixture into localStorage and
  // pin the showcase session as the initial active row. Subsequent clicks
  // in the session drawer flow through mockSessions.switchTo as normal,
  // so the user can navigate away from the showcase to other sessions
  // (and back) without losing the gallery.
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
      dataSources={dataSources}
    />
  )
}

export function App() {
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
