import { useCallback, useEffect, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { Navigate, Route, useParams } from 'react-router-dom'
import {
  BoringApp,
  UserMenu,
  WorkspaceSwitcher,
  WorkspaceSettingsPage,
  useCurrentWorkspace,
} from '@boring/core/front'
import {
  WorkspaceProvider,
  ChatCenteredShell,
  CodeEditorPane,
  EmptyPane,
  WorkspaceLoadingState,
  defaultEditorPanels,
  definePanel,
  type PanelConfig,
} from '@boring/workspace'
import { useSessions } from '@boring/agent/front'
import { seedShowcase } from './showcaseMessages'

import '@boring/core/theme.css'
import '@boring/workspace/globals.css'
import '@boring/agent/front/styles.css'
import './app.css'

type FullAppPanelConfig = PanelConfig<any>

const panels: FullAppPanelConfig[] = [
  ...defaultEditorPanels,
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
  }),
]

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

  return (
    <ChatCenteredShell
      appTitle="Boring"
      topBarLeft={<WorkspaceSwitcher workspacePathPrefix="/workspace" />}
      topBarRight={<UserMenu />}
      chatRequestHeaders={workspaceHeaders}
      uiRequestHeaders={workspaceHeaders}
      storageKey={`boring-ui-v2:chat-centered-shell:full-app:${workspaceId}`}
      surfaceStorageKey={`boring-ui-v2:surface-shell:full-app:${workspaceId}`}
      sessions={sessionApi.sessions}
      activeSessionId={sessionApi.activeSessionId}
      onSwitchSession={sessionApi.switch}
      onCreateSession={handleCreateSession}
      onDeleteSession={handleDeleteSession}
    />
  )
}

function WorkspaceRoute() {
  const { id } = useParams<{ id: string }>()
  const currentWorkspace = useCurrentWorkspace()
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
        panels={panels}
        apiBaseUrl=""
        authHeaders={{ 'x-boring-workspace-id': id }}
        apiTimeout={10_000}
        persistenceEnabled
        storageKey={`boring-ui-v2:layout:full-app:${id}`}
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
