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
  EmptyPane,
  defaultEditorPanels,
  definePanel,
  type PanelConfig,
} from '@boring/workspace'
import { createMockSessions, useMockSessions } from '@boring/workspace/testing'

import '@boring/core/theme.css'
import '@boring/workspace/globals.css'
import '@boring/agent/ui-shadcn/styles.css'

const panels: PanelConfig[] = [
  ...defaultEditorPanels,
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

function Shell() {
  const { sessions, activeId } = useMockSessions(sessionsStore)
  return (
    <ChatCenteredShell
      topBarLeft={<WorkspaceSwitcher />}
      topBarRight={
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <UserMenu />
        </div>
      }
      sessions={sessions}
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
