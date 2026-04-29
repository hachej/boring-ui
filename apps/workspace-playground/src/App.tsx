import { useCallback, useEffect, useMemo } from "react"
import { ChatPanel } from "@boring/agent"
import {
  WorkspaceProvider,
  ChatLayout,
  CodeEditorPane,
  EmptyPane,
  TopBar,
  definePanel,
  type PanelConfig,
} from "@boring/workspace"
import { createMockSessions, useMockSessions } from "@boring/workspace/testing"
import { SHOWCASE_SESSION_ID, seedShowcase } from "./showcaseMessages"

// ----- Panel registry -----

const panels: PanelConfig[] = [
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
const layoutStorageKey = "boring-ui-v2:layout:playground"

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

  const activeSession = sessionList.find((session) => session.id === activeId)

  const openCommandPalette = useCallback(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: true, ctrlKey: true, bubbles: true }),
    )
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopBar
        appTitle="Boring"
        sessionTitle={activeSession?.title}
        onCommandPalette={openCommandPalette}
      />
      <div className="min-h-0 flex-1">
        <ChatLayout
          nav="session-list"
          navParams={{
            sessions: sessionList,
            activeId,
            onSwitch: sessionsStore.switchTo,
            onCreate: sessionsStore.create,
            onDelete: sessionsStore.remove,
          }}
          center={activeId ? "chat" : "empty"}
          centerParams={
            activeId
              ? {
                  sessionId: activeId,
                  chrome: false,
                  className: "h-full min-h-0",
                }
              : undefined
          }
          sidebar="workbench-left"
          surface="artifact-surface"
          surfaceParams={{
            storageKey: `${layoutStorageKey}:surface`,
            extraPanels: ["csv-viewer"],
          }}
          className="h-full"
        />
      </div>
    </div>
  )
}

export function WorkspaceShell() {
  return (
    <div className="h-full bg-background text-foreground">
      <WorkspaceProvider
        chatPanel={ChatPanel}
        panels={panels}
        apiBaseUrl=""
        persistenceEnabled
        storageKey={layoutStorageKey}
      >
        <Shell />
      </WorkspaceProvider>
    </div>
  )
}
