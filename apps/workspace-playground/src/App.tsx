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

  useEffect(() => {
    if (showcase) seedShowcase()
  }, [showcase])

  if (showcase) {
    const showcaseSessions = [
      { id: SHOWCASE_SESSION_ID, title: "Showcase conversation", updatedAt: Date.now() },
      ...sessions.filter((s) => s.id !== SHOWCASE_SESSION_ID),
    ]
    return (
      <ChatCenteredShell
        appTitle="Boring"
        userInitial="J"
        sessions={showcaseSessions}
        activeSessionId={SHOWCASE_SESSION_ID}
        onSwitchSession={mockSessions.switchTo}
        onCreateSession={mockSessions.create}
        onDeleteSession={mockSessions.remove}
        dataSources={dataSources}
      />
    )
  }

  return (
    <ChatCenteredShell
      appTitle="Boring"
      userInitial="J"
      sessions={sessions}
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
