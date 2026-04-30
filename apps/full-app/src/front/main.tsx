import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Navigate, Route, useParams } from 'react-router-dom'
import { ChatPanel } from '@boring/agent'
import {
  BoringApp,
  UserMenu,
  WorkspaceSettingsPage,
  WorkspaceSwitcher,
  useCoreCommands,
  useCurrentWorkspace,
} from '@boring/core/front'
import {
  WorkspaceProvider,
  ChatLayout,
  CodeEditorPane,
  EmptyPane,
  TopBar,
  WorkspaceLoadingState,
  definePanel,
  useRegistry,
  type PanelConfig,
  type SurfaceShellApi,
  type SurfaceShellSnapshot,
} from '@boring/workspace'
import { useSessions } from '@boring/agent/front'
import { seedShowcase } from './showcaseMessages'

import '@boring/core/theme.css'
import '@boring/workspace/globals.css'
import '@boring/agent/front/styles.css'
import './app.css'

const panels: PanelConfig[] = [
  definePanel<{ path: string }>({
    id: 'csv-viewer',
    title: 'CSV',
    component: CodeEditorPane,
    placement: 'center',
    source: 'app',
  }),
  definePanel({
    id: 'empty',
    title: 'Welcome',
    component: EmptyPane,
    placement: 'center',
    source: 'app',
    chromeless: true,
  }),
]

const layoutStorageKey = 'boring-ui-v2:layout:full-app'

function isShowcaseRoute(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('showcase') === '1'
}

function Shell({ workspaceId }: { workspaceId: string }) {
  const showcase = useMemo(isShowcaseRoute, [])
  const workspaceHeaders = useMemo(
    () => ({ 'x-boring-workspace-id': workspaceId }),
    [workspaceId],
  )
  const sessionStorageKey = useMemo(
    () => `boring-agent:activeSessionId:${workspaceId}`,
    [workspaceId],
  )
  const sessionApi = useSessions({
    requestHeaders: workspaceHeaders,
    storageKey: sessionStorageKey,
  })
  const shellStorageKey = `boring-ui-v2:chat-layout:full-app:${workspaceId}`
  const surfaceStorageKey = `${shellStorageKey}:surface`
  const panelRegistry = useRegistry()
  const surfaceSnapshotRef = useRef<SurfaceShellSnapshot>({ openTabs: [], activeTab: null })
  const [drawerOpen, setDrawerOpenState] = useState(true)
  const [surfaceOpen, setSurfaceOpenState] = useState(true)
  const drawerOpenRef = useRef(true)
  const surfaceOpenRef = useRef(true)
  const surfaceRef = useRef<SurfaceShellApi | null>(null)
  const pushAbortRef = useRef<AbortController | null>(null)

  const sessionCount = sessionApi.sessions.length

  useEffect(() => {
    if (sessionApi.loading || sessionCount > 0) return
    void sessionApi.create({
      title: showcase ? 'Showcase conversation' : 'New session',
    })
  }, [showcase, sessionApi.loading, sessionApi.create, sessionCount])

  useEffect(() => {
    if (showcase && sessionApi.activeSessionId) {
      seedShowcase(sessionApi.activeSessionId)
    }
  }, [showcase, sessionApi.activeSessionId])

  const handleCreateSession = useCallback(() => {
    void sessionApi.create()
  }, [sessionApi.create])

  const handleDeleteSession = useCallback((id: string) => {
    void sessionApi.delete(id).catch(() => {})
  }, [sessionApi.delete])

  const activeId = sessionApi.activeSessionId
  const activeSession = sessionApi.activeSession

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
      causedBy: 'user' as const,
    }

    pushAbortRef.current?.abort()
    const controller = new AbortController()
    pushAbortRef.current = controller
    void fetch('/api/v1/ui/state', {
      method: 'PUT',
      headers: { ...workspaceHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    }).catch(() => {})
  }, [availablePanelIds, workspaceHeaders])

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

  useEffect(() => {
    pushUiState()
    return () => {
      pushAbortRef.current?.abort()
    }
  }, [pushUiState])

  const openCommandPalette = useCallback(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true, bubbles: true }),
    )
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopBar
        appTitle="Boring"
        sessionTitle={activeSession?.title}
        onCommandPalette={openCommandPalette}
        onNewChat={handleCreateSession}
        topBarLeft={<WorkspaceSwitcher workspacePathPrefix="/workspace" />}
        topBarRight={<UserMenu />}
      />
      <div className="min-h-0 flex-1">
        <ChatLayout
          nav={drawerOpen ? 'session-list' : ''}
          navParams={{
            sessions: sessionApi.sessions,
            activeId,
            onSwitch: sessionApi.switch,
            onCreate: handleCreateSession,
            onDelete: handleDeleteSession,
            onClose: () => setDrawerOpen(false),
          }}
          center={activeId ? 'chat' : 'empty'}
          centerParams={
            activeId
              ? {
                  sessionId: activeId,
                  chrome: false,
                  thinkingControl: true,
                  className: 'h-full min-h-0',
                  requestHeaders: workspaceHeaders,
                  getSurface,
                  isWorkbenchOpen,
                  openWorkbench,
                }
              : undefined
          }
          surface={surfaceOpen ? 'artifact-surface' : ''}
          surfaceParams={{
            storageKey: surfaceStorageKey,
            extraPanels: ['csv-viewer'],
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

function WorkspaceRoute() {
  const { id } = useParams<{ id: string }>()
  const currentWorkspace = useCurrentWorkspace()
  const coreCommands = useCoreCommands()
  if (!id) return null

  if (currentWorkspace?.id !== id) {
    return (
      <WorkspaceLoadingState
        title="Switching workspace"
        description="Restoring files, sessions, and saved layout."
        status="Loading workspace"
      />
    )
  }

  return (
    <div className="h-screen bg-background text-foreground">
      <WorkspaceProvider
        key={id}
        workspaceId={id}
        chatPanel={ChatPanel}
        panels={panels}
        commands={coreCommands}
        apiBaseUrl=""
        authHeaders={{ 'x-boring-workspace-id': id }}
        apiTimeout={10_000}
        persistenceEnabled
        storageKey={`${layoutStorageKey}:${id}`}
      >
        <Shell workspaceId={id} />
      </WorkspaceProvider>
    </div>
  )
}

function HomeRedirect() {
  const workspace = useCurrentWorkspace()
  if (!workspace) {
    return (
      <WorkspaceLoadingState
        title="Opening workspace"
        description="Finding your default workspace."
        status="Loading workspace"
      />
    )
  }
  return <Navigate to={`/workspace/${workspace.id}`} replace />
}

createRoot(document.getElementById('root')!).render(
  <BoringApp>
    <Route path="/" element={<HomeRedirect />} />
    <Route path="/workspace/:id" element={<WorkspaceRoute />} />
    <Route path="/workspace/:id/settings" element={<WorkspaceSettingsPage />} />
  </BoringApp>,
)
