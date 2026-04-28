import { useEffect, useMemo } from "react"
import {
  WorkspaceProvider,
  ChatCenteredShell,
  CodeEditorPane,
  EmptyPane,
  defaultEditorPanels,
  definePanel,
  type PanelConfig,
} from "@boring/workspace"
import { createMockSessions, useMockSessions } from "@boring/workspace/testing"
import { SHOWCASE_SESSION_ID, seedShowcase } from "./showcaseMessages"

// ----- Panel registry -----

const panels: PanelConfig[] = [
  ...defaultEditorPanels,
  definePanel<{ path: string }>({
    id: "csv-viewer",
    title: "CSV",
    component: CodeEditorPane,
    placement: "center",
    source: "app",
  }),
  definePanel({
    id: "empty",
    title: "Welcome",
    component: EmptyPane,
    placement: "center",
    source: "app",
  }),
]

const sessionsStore = createMockSessions()

function isShowcaseRoute(): boolean {
  if (typeof window === "undefined") return false
  return new URLSearchParams(window.location.search).get("showcase") === "1"
}

function Shell() {
  const { sessions, activeId } = useMockSessions(sessionsStore)
  const showcase = useMemo(isShowcaseRoute, [])

  useEffect(() => {
    if (!showcase) return
    seedShowcase()
    if (sessionsStore.getState().activeId !== SHOWCASE_SESSION_ID) {
      sessionsStore.switchTo(SHOWCASE_SESSION_ID)
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
      sessions={sessionList}
      activeSessionId={activeId}
      onSwitchSession={sessionsStore.switchTo}
      onCreateSession={sessionsStore.create}
      onDeleteSession={sessionsStore.remove}
    />
  )
}

export function WorkspaceShell() {
  return (
    <div className="h-full bg-background text-foreground">
      <WorkspaceProvider
        panels={panels}
        apiBaseUrl=""
        persistenceEnabled
        storageKey="boring-ui-v2:layout:playground"
      >
        <Shell />
      </WorkspaceProvider>
    </div>
  )
}
