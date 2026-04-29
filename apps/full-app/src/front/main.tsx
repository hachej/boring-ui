import { useEffect, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { Navigate, Route, useParams } from 'react-router-dom'
import {
  BoringApp,
  ThemeToggle,
  UserMenu,
  WorkspaceSwitcher,
  useCurrentWorkspace,
} from '@boring/core/front'
import {
  WorkspaceProvider,
  ChatCenteredShell,
  CodeEditorPane,
  EmptyPane,
  defaultEditorPanels,
  definePanel,
  type PanelConfig,
} from '@boring/workspace'
import { createMockSessions, useMockSessions } from '@boring/workspace/testing'
import { SHOWCASE_SESSION_ID, seedShowcase } from './showcaseMessages'

import '@boring/core/theme.css'
import '@boring/workspace/globals.css'
import '@boring/agent/front/styles.css'
import './app.css'

const panels: PanelConfig[] = [
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
    chromeless: true,
  }),
]

const sessionsStore = createMockSessions()

function isShowcaseRoute(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('showcase') === '1'
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
      { id: SHOWCASE_SESSION_ID, title: 'Showcase conversation', updatedAt: Date.now() },
      ...sessions,
    ]
  }, [showcase, sessions])

  return (
    <ChatCenteredShell
      appTitle="Boring"
      topBarLeft={<WorkspaceSwitcher />}
      topBarRight={
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <UserMenu />
        </div>
      }
      sessions={sessionList}
      activeSessionId={activeId}
      onSwitchSession={sessionsStore.switchTo}
      onCreateSession={sessionsStore.create}
      onDeleteSession={sessionsStore.remove}
    />
  )
}

function WorkspaceRoute() {
  const { id } = useParams<{ id: string }>()
  if (!id) return null

  return (
    <div className="h-screen bg-background text-foreground">
      <WorkspaceProvider
        workspaceId={id}
        panels={panels}
        apiBaseUrl=""
        apiTimeout={10_000}
        persistenceEnabled
        storageKey="boring-ui-v2:layout:full-app"
      >
        <Shell />
      </WorkspaceProvider>
    </div>
  )
}

function HomeRedirect() {
  const workspace = useCurrentWorkspace()
  if (!workspace) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        Loading workspace…
      </div>
    )
  }
  return <Navigate to={`/workspace/${workspace.id}`} replace />
}

createRoot(document.getElementById('root')!).render(
  <BoringApp>
    <Route path="/" element={<HomeRedirect />} />
    <Route path="/workspace/:id" element={<WorkspaceRoute />} />
  </BoringApp>,
)
