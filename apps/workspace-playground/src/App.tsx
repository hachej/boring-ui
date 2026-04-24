import { useCallback, useRef } from "react"
import {
  WorkspaceProvider,
  ChatCenteredShell,
  SessionBrowser,
  ChatStagePlaceholder,
  SurfaceShell,
  DataProvider,
  CodeEditorPane,
  MarkdownEditorPane,
  EmptyPane,
  type ChatStageHandle,
} from "@boring/workspace"
import type { PanelConfig } from "@boring/workspace"
import { mockSessions, useMockSessions } from "./mockSessions"

// ----- Panel registry (used only by SurfaceShell's internal Dockview) -----

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
  {
    id: "code-editor",
    title: "Editor",
    component: CodeEditorWrapper as React.ComponentType<unknown>,
    placement: "center",
    source: "app",
  },
  {
    id: "markdown-editor",
    title: "Markdown",
    component: MarkdownEditorWrapper as React.ComponentType<unknown>,
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

// ----- Composition -----

function SessionBrowserPanel() {
  const { sessions, activeId } = useMockSessions()
  return (
    <SessionBrowser
      sessions={sessions}
      activeId={activeId}
      onSwitch={mockSessions.switchTo}
      onCreate={mockSessions.create}
      onDelete={mockSessions.remove}
    />
  )
}

function ChatStagePanel({ stageRef }: { stageRef: React.MutableRefObject<ChatStageHandle | null> }) {
  const { sessions, activeId } = useMockSessions()
  const active = sessions.find((s) => s.id === activeId)
  return (
    <ChatStagePlaceholder
      ref={(h) => {
        stageRef.current = h
      }}
      sessionTitle={active?.title}
      sessionId={active?.id}
    />
  )
}

const mockDataSources = [
  { id: "users", name: "users", type: "table", description: "Account + profile rows" },
  { id: "events", name: "events", type: "stream", description: "Raw event firehose" },
  { id: "sessions", name: "sessions_daily", type: "view", description: "Rolled-up session metrics" },
  { id: "logs", name: "app_logs", type: "index", description: "Structured application logs" },
]

function SurfacePanel() {
  return <SurfaceShell rootDir="" storageKey="boring-ui-v2:chat-shell:surface" dataSources={mockDataSources} />
}

function Shell() {
  const stageRef = useRef<ChatStageHandle | null>(null)
  const focusComposer = useCallback(() => {
    stageRef.current?.focusComposer()
  }, [])

  return (
    <ChatCenteredShell
      drawer={<SessionBrowserPanel />}
      stage={<ChatStagePanel stageRef={stageRef} />}
      surface={<SurfacePanel />}
      onNewChat={mockSessions.create}
      focusComposer={focusComposer}
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
