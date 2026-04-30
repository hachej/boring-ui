import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChatPanel } from "@boring/agent"
import { Plus } from "lucide-react"
import {
  WorkspaceProvider,
  ChatLayout,
  TopBar,
  useRegistry,
  type SurfaceShellApi,
  type SurfaceShellSnapshot,
} from "@boring/workspace"
import {
  createLocalStorageSessions,
  useLocalStorageSessions,
} from "@boring/workspace/testing"
import {
  makeMacroClientPlugin,
  macroChatSuggestions,
} from "../plugin"
import { openSeriesPane } from "./macroSeriesUi"

const sessionsStore = createLocalStorageSessions({ storageKey: "boring-macro:sessions" })
const layoutStorageKey = "boring-macro:shell"

function Shell() {
  const { sessions, activeId } = useLocalStorageSessions(sessionsStore)
  const panelRegistry = useRegistry()
  const surfaceSnapshotRef = useRef<SurfaceShellSnapshot>({ openTabs: [], activeTab: null })
  const [drawerOpen, setDrawerOpenState] = useState(true)
  const [surfaceOpen, setSurfaceOpenState] = useState(true)
  const drawerOpenRef = useRef(true)
  const surfaceOpenRef = useRef(true)
  const surfaceRef = useRef<SurfaceShellApi | null>(null)
  const pushAbortRef = useRef<AbortController | null>(null)

  const activeSession = sessions.find((session) => session.id === activeId)
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
    }).catch(() => {})
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
      setDrawerOpenState(open)
      pushUiState()
    },
    [pushUiState],
  )

  const setSurfaceOpen = useCallback(
    (open: boolean) => {
      surfaceOpenRef.current = open
      setSurfaceOpenState(open)
      pushUiState()
    },
    [pushUiState],
  )

  const getSurface = useCallback(() => surfaceRef.current, [])
  const isWorkbenchOpen = useCallback(() => surfaceOpenRef.current, [])
  const openWorkbench = useCallback(() => setSurfaceOpen(true), [setSurfaceOpen])

  const openCommandPalette = useCallback(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: true, ctrlKey: true, bubbles: true }),
    )
  }, [])

  useEffect(() => {
    pushUiState()
    return () => {
      pushAbortRef.current?.abort()
    }
  }, [pushUiState])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopBar
        appTitle="boring.macro"
        sessionTitle={activeSession?.title}
        onCommandPalette={openCommandPalette}
        topBarRight={
          <button
            type="button"
            onClick={sessionsStore.create}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label="New chat"
            title="New chat"
          >
            <Plus className="h-4 w-4" />
          </button>
        }
      />
      <div className="min-h-0 flex-1">
        <ChatLayout
          nav={drawerOpen ? "session-list" : ""}
          navParams={{
            sessions,
            activeId,
            onSwitch: sessionsStore.switchTo,
            onCreate: sessionsStore.create,
            onDelete: sessionsStore.remove,
            onClose: () => setDrawerOpen(false),
          }}
          center="chat"
          centerParams={{
            sessionId: activeId,
            chrome: false,
            thinkingControl: true,
            suggestions: macroChatSuggestions,
            emptyTitle: "What macro question are we tackling?",
            emptyDescription: "Search FRED, plot a series, derive a transform, or draft a briefing deck.",
            className: "h-full min-h-0",
            getSurface,
            isWorkbenchOpen,
            openWorkbench,
          }}
          surface={surfaceOpen ? "artifact-surface" : ""}
          surfaceParams={{
            storageKey: `${layoutStorageKey}:surface`,
            extraPanels: ["chart-canvas", "deck"],
            onReady: handleSurfaceReady,
            onChange: handleSurfaceChange,
            onClose: () => setSurfaceOpen(false),
          }}
          onOpenNav={() => setDrawerOpen(true)}
          onOpenSurface={() => setSurfaceOpen(true)}
          className="h-full"
        />
      </div>
    </div>
  )
}

const macroPlugin = makeMacroClientPlugin((row) => openSeriesPane(row.id))

export function App() {
  return (
    <div className="h-full bg-background text-foreground">
      <WorkspaceProvider
        chatPanel={ChatPanel}
        plugins={[macroPlugin]}
        apiBaseUrl=""
        apiTimeout={10000}
        persistenceEnabled
        storageKey="boring-macro:layout"
      >
        <Shell />
      </WorkspaceProvider>
    </div>
  )
}
