import { useCallback, useEffect, useMemo, useRef } from "react"
import { ChatPanel } from "@boring/agent"
import {
  WorkspaceProvider,
  ChatLayout,
  CodeEditorPane,
  EmptyPane,
  TopBar,
  definePanel,
  useCommandRegistry,
  useRegistry,
  type PanelConfig,
  type SurfaceShellApi,
  type SurfaceShellSnapshot,
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
const playgroundCommandScope = "workspace-playground"

function isShowcaseRoute(): boolean {
  if (typeof window === "undefined") return false
  return new URLSearchParams(window.location.search).get("showcase") === "1"
}

function Shell() {
  const { sessions, activeId } = useMockSessions(sessionsStore)
  const showcase = useMemo(isShowcaseRoute, [])
  const commandRegistry = useCommandRegistry()
  const panelRegistry = useRegistry()
  const surfaceSnapshotRef = useRef<SurfaceShellSnapshot>({ openTabs: [], activeTab: null })
  const drawerOpenRef = useRef(true)
  const surfaceOpenRef = useRef(true)
  const surfaceRef = useRef<SurfaceShellApi | null>(null)
  const pushAbortRef = useRef<AbortController | null>(null)

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

  const availablePanelIds = useMemo(
    () => panelRegistry.list().map((panel) => panel.id),
    [panelRegistry],
  )

  const pushUiState = useCallback(() => {
    const snapshot = surfaceSnapshotRef.current
    const body = {
      state: {
        v: 1,
        workbenchOpen: surfaceOpenRef.current,
        drawerOpen: drawerOpenRef.current,
        openTabs: snapshot.openTabs,
        activeTab: snapshot.activeTab,
        activeFile:
          snapshot.openTabs.find((tab) => tab.id === snapshot.activeTab)?.params?.path ?? null,
        availablePanels: availablePanelIds,
      },
      causedBy: "user" as const,
    }

    pushAbortRef.current?.abort()
    const controller = new AbortController()
    pushAbortRef.current = controller
    void fetch("/api/v1/ui/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    }).catch(() => {
      // Best-effort UI bridge state sync; playground must keep booting without an agent backend.
    })
  }, [availablePanelIds])

  const handleSurfaceReady = useCallback(
    (api: SurfaceShellApi) => {
      surfaceSnapshotRef.current = api.getSnapshot()
      surfaceRef.current = api
      pushUiState()
    },
    [pushUiState],
  )

  const handleSurfaceChange = useCallback(
    (snapshot: SurfaceShellSnapshot) => {
      surfaceSnapshotRef.current = snapshot
      pushUiState()
    },
    [pushUiState],
  )

  const setDrawerOpen = useCallback(
    (open: boolean) => {
      drawerOpenRef.current = open
      pushUiState()
    },
    [pushUiState],
  )

  const setSurfaceOpen = useCallback(
    (open: boolean) => {
      surfaceOpenRef.current = open
      pushUiState()
    },
    [pushUiState],
  )

  const getSurface = useCallback(() => surfaceRef.current, [])
  const isWorkbenchOpen = useCallback(() => surfaceOpenRef.current, [])
  const openWorkbench = useCallback(() => setSurfaceOpen(true), [setSurfaceOpen])

  useEffect(() => {
    commandRegistry.unregisterByPluginId(playgroundCommandScope)
    commandRegistry.registerCommand({
      id: "chat-shell.newChat",
      title: "New Chat",
      pluginId: playgroundCommandScope,
      run: sessionsStore.create,
    })

    for (const session of sessionList) {
      commandRegistry.registerCommand({
        id: `chat-shell.session.${session.id}`,
        title: `Switch to: ${session.title}`,
        pluginId: playgroundCommandScope,
        run: () => sessionsStore.switchTo(session.id),
      })
    }

    return () => {
      commandRegistry.unregisterByPluginId(playgroundCommandScope)
    }
  }, [commandRegistry, sessionList])

  useEffect(() => {
    pushUiState()
    return () => {
      pushAbortRef.current?.abort()
    }
  }, [pushUiState])

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
        onNewChat={sessionsStore.create}
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
            onClose: () => setDrawerOpen(false),
          }}
          center={activeId ? "chat" : "empty"}
          centerParams={
            activeId
              ? {
                  sessionId: activeId,
                  chrome: false,
                  className: "h-full min-h-0",
                  getSurface,
                  isWorkbenchOpen,
                  openWorkbench,
                }
              : undefined
          }
          sidebar="workbench-left"
          surface="artifact-surface"
          surfaceParams={{
            storageKey: `${layoutStorageKey}:surface`,
            extraPanels: ["csv-viewer"],
            onReady: handleSurfaceReady,
            onChange: handleSurfaceChange,
            onClose: () => setSurfaceOpen(false),
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
