import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { Navigate, Route, useParams } from 'react-router-dom'
import { ChatPanel } from '@boring/agent'
import {
  BoringApp,
  UserMenu,
  UserSettingsPage as CoreUserSettingsPage,
  WorkspaceSettingsPage as CoreWorkspaceSettingsPage,
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
const WORKSPACE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function readStoredBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback
  try {
    const value = window.localStorage.getItem(key)
    if (value === '1') return true
    if (value === '0') return false
  } catch {
    // storage unavailable — use default
  }
  return fallback
}

function writeStoredBoolean(key: string, value: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, value ? '1' : '0')
  } catch {
    // storage unavailable — ignore
  }
}

function AppTopBar({
  sessionTitle,
  onNewChat,
}: {
  sessionTitle?: string
  onNewChat?: () => void
}) {
  return (
    <TopBar
      appTitle="Boring"
      sessionTitle={sessionTitle}
      onCommandPalette={openCommandPalette}
      onNewChat={onNewChat}
      topBarLeft={<WorkspaceSwitcher workspacePathPrefix="/workspace" />}
      topBarRight={<UserMenu />}
    />
  )
}

function AppUserSettingsPage() {
  return <CoreUserSettingsPage topBar={<AppTopBar />} />
}

function AppWorkspaceSettingsPage() {
  return <CoreWorkspaceSettingsPage topBar={<AppTopBar />} />
}

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
  const drawerOpenStorageKey = `${shellStorageKey}:drawerOpen`
  const surfaceOpenStorageKey = `${shellStorageKey}:workbenchOpen`
  const panelRegistry = useRegistry()
  const surfaceSnapshotRef = useRef<SurfaceShellSnapshot>({ openTabs: [], activeTab: null })
  const [drawerOpen, setDrawerOpenState] = useState(() =>
    readStoredBoolean(drawerOpenStorageKey, true),
  )
  const [surfaceOpen, setSurfaceOpenState] = useState(() =>
    readStoredBoolean(surfaceOpenStorageKey, true),
  )
  const drawerOpenRef = useRef(drawerOpen)
  const surfaceOpenRef = useRef(surfaceOpen)
  const surfaceRef = useRef<SurfaceShellApi | null>(null)
  const pushAbortRef = useRef<AbortController | null>(null)

  const sessionCount = sessionApi.sessions.length

  useEffect(() => {
    const nextDrawerOpen = readStoredBoolean(drawerOpenStorageKey, true)
    const nextSurfaceOpen = readStoredBoolean(surfaceOpenStorageKey, true)
    drawerOpenRef.current = nextDrawerOpen
    surfaceOpenRef.current = nextSurfaceOpen
    setDrawerOpenState(nextDrawerOpen)
    setSurfaceOpenState(nextSurfaceOpen)
  }, [drawerOpenStorageKey, surfaceOpenStorageKey])

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
      writeStoredBoolean(drawerOpenStorageKey, open)
      setDrawerOpenState(open)
      pushUiState()
    },
    [drawerOpenStorageKey, pushUiState],
  )

  const setSurfaceOpen = useCallback(
    (open: boolean) => {
      surfaceOpenRef.current = open
      writeStoredBoolean(surfaceOpenStorageKey, open)
      setSurfaceOpenState(open)
      pushUiState()
    },
    [pushUiState, surfaceOpenStorageKey],
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <AppTopBar sessionTitle={activeSession?.title} onNewChat={handleCreateSession} />
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

function openCommandPalette() {
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true, bubbles: true }),
  )
}

function WorkspaceLoadingPage({
  title = 'Switching workspace',
  description = 'Restoring files, sessions, and saved layout.',
  status = 'Loading workspace',
}: {
  title?: string
  description?: string
  status?: string
}) {
  return (
    <div className="flex h-screen min-h-0 flex-col bg-background text-foreground">
      <AppTopBar />
      <main className="min-h-0 flex-1">
        <WorkspaceLoadingState
          title={title}
          description={description}
          status={status}
          fullscreen={false}
          className="h-full min-h-0"
        />
      </main>
    </div>
  )
}

function WorkspaceErrorPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex h-screen min-h-0 flex-col bg-background text-foreground">
      <AppTopBar />
      <div className="flex min-h-0 flex-1 items-center justify-center px-6">
        <div className="max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm">
          <p className="text-sm font-medium text-destructive">Workspace failed to open</p>
          <h1 className="mt-2 text-xl font-semibold">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>
          <button
            className="mt-4 inline-flex text-sm font-medium text-primary underline"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </div>
      </div>
    </div>
  )
}

type WorkspaceBootState =
  | { status: 'loading'; label: string }
  | { status: 'ready' }
  | { status: 'error'; message: string }

function WorkspaceBootGate({ id, children }: { id: string; children: ReactNode }) {
  const [state, setState] = useState<WorkspaceBootState>({
    status: 'loading',
    label: 'Waking workspace runtime',
  })

  useEffect(() => {
    const controller = new AbortController()
    const headers = { 'x-boring-workspace-id': id }

    async function fetchOk(path: string): Promise<void> {
      const response = await fetch(path, { headers, signal: controller.signal })
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(text || `${path} failed with ${response.status}`)
      }
    }

    async function boot() {
      setState({ status: 'loading', label: 'Waking workspace runtime' })
      try {
        await Promise.all([
          fetchOk('/api/v1/tree?path='),
          fetchOk('/api/v1/agent/sessions'),
        ])
        if (!controller.signal.aborted) setState({ status: 'ready' })
      } catch (error) {
        if (controller.signal.aborted) return
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown workspace boot error',
        })
      }
    }

    void boot()
    return () => controller.abort()
  }, [id])

  if (state.status === 'ready') return <>{children}</>

  if (state.status === 'error') {
    return (
      <WorkspaceErrorPage
        title="Runtime failed to wake"
        description={state.message}
      />
    )
  }

  return (
    <WorkspaceLoadingPage
      title="Opening workspace"
      description="Waking the sandbox and preparing files, sessions, and layout."
      status={state.label}
    />
  )
}

function WorkspaceRoute() {
  const { id } = useParams<{ id: string }>()
  const currentWorkspace = useCurrentWorkspace()
  const coreCommands = useCoreCommands()
  if (!id) return null

  if (!WORKSPACE_ID_RE.test(id)) {
    return (
      <div className="flex h-screen items-center justify-center bg-background px-6 text-foreground">
        <div className="max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm">
          <p className="text-sm font-medium text-destructive">Invalid workspace URL</p>
          <h1 className="mt-2 text-xl font-semibold">Workspace id is malformed</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This link contains an invalid workspace id. Check for accidental spaces like %20.
          </p>
          <a className="mt-4 inline-flex text-sm font-medium text-primary underline" href="/">
            Go to default workspace
          </a>
        </div>
      </div>
    )
  }

  if (currentWorkspace?.id !== id) {
    return <WorkspaceLoadingPage />
  }

  return (
    <WorkspaceBootGate id={id}>
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
    </WorkspaceBootGate>
  )
}

function HomeRedirect() {
  const workspace = useCurrentWorkspace()
  if (!workspace) {
    return (
      <WorkspaceLoadingPage
        title="Opening workspace"
        description="Finding your default workspace."
        status="Loading workspace"
      />
    )
  }
  return <Navigate to={`/workspace/${workspace.id}`} replace />
}

createRoot(document.getElementById('root')!).render(
  <BoringApp authPages={{ userSettings: AppUserSettingsPage }}>
    <Route path="/" element={<HomeRedirect />} />
    <Route path="/workspace/:id" element={<WorkspaceRoute />} />
    <Route path="/workspace/:id/settings" element={<AppWorkspaceSettingsPage />} />
  </BoringApp>,
)
