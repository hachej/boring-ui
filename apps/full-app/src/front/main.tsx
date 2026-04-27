import { useMemo } from 'react'
import type { ComponentType } from 'react'
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
  DataProvider,
  IdeLayout,
  CodeEditorPane,
  MarkdownEditorPane,
  FileTreePane,
  EmptyPane,
  useDockviewApi,
  useRegistry,
  type PanelConfig,
  type WorkspaceBridge,
} from '@boring/workspace'
import { ChatPanel } from '@boring/agent/ui-shadcn'

import '@boring/core/theme.css'
import '@boring/workspace/globals.css'
import '@boring/agent/ui-shadcn/styles.css'

const API_BASE_URL = ''

function ChatPanelWrapper(props: Record<string, unknown>) {
  const p = props as { params?: { sessionId?: string } }
  const sessionId = p.params?.sessionId ?? 'default'
  return <ChatPanel sessionId={sessionId} />
}

function FileTreeWrapper(props: Record<string, unknown>) {
  const p = props as { params?: { rootDir?: string }; api?: unknown; panelApi?: unknown }
  const dockApi = useDockviewApi()
  const registry = useRegistry()

  const bridge = useMemo<Pick<WorkspaceBridge, 'openFile'>>(() => ({
    async openFile(path: string) {
      const panelId = `file:${path}`
      const resolved = registry.resolve(path)
      const component = resolved?.id ?? 'code-editor'
      const title = path.split('/').pop() ?? path

      try {
        dockApi.addPanel('center', { id: panelId, component, title, params: { path } })
      } catch {
        dockApi.activatePanel(panelId)
      }

      return { seq: 0, status: 'ok' as const }
    },
  }), [dockApi, registry])

  return (
    <FileTreePane
      rootDir={p.params?.rootDir ?? '.'}
      panelApi={(p.api ?? p.panelApi) as never}
      bridge={bridge as WorkspaceBridge}
    />
  )
}

function CodeEditorWrapper(props: Record<string, unknown>) {
  const p = props as { params?: { path?: string }; api?: unknown; panelApi?: unknown }
  return <CodeEditorPane path={p.params?.path ?? ''} panelApi={(p.api ?? p.panelApi) as never} chromeless />
}

function MarkdownEditorWrapper(props: Record<string, unknown>) {
  const p = props as { params?: { path?: string }; api?: unknown; panelApi?: unknown }
  return <MarkdownEditorPane path={p.params?.path ?? ''} panelApi={(p.api ?? p.panelApi) as never} chromeless />
}

const panels: PanelConfig[] = [
  {
    id: 'filetree',
    title: 'Files',
    component: FileTreeWrapper as ComponentType<unknown>,
    placement: 'left',
    source: 'app',
  },
  {
    id: 'code-editor',
    title: 'Editor',
    component: CodeEditorWrapper as ComponentType<unknown>,
    placement: 'center',
    filePatterns: ['*.ts', '*.tsx', '*.js', '*.jsx', '*.json', '*.css', '*.py', '*.sql', '*.yaml', '*.yml'],
    source: 'app',
  },
  {
    id: 'markdown-editor',
    title: 'Markdown',
    component: MarkdownEditorWrapper as ComponentType<unknown>,
    placement: 'center',
    filePatterns: ['*.md', '*.mdx'],
    source: 'app',
  },
  {
    id: 'empty',
    title: 'Welcome',
    component: EmptyPane as ComponentType<unknown>,
    placement: 'center',
    source: 'app',
  },
  {
    id: 'agent',
    title: 'Agent',
    component: ChatPanelWrapper as ComponentType<unknown>,
    placement: 'right',
    source: 'app',
  },
]

function WorkspaceRoute() {
  const { id } = useParams<{ id: string }>()
  if (!id) return null

  return (
    <div className="h-screen bg-background text-foreground">
      <WorkspaceProvider
        workspaceId={id}
        panels={panels}
        apiBaseUrl={API_BASE_URL}
        persistenceEnabled
        storageKey="boring-ui-v2:layout:full-app"
      >
        <DataProvider apiBaseUrl={API_BASE_URL} authHeaders={{}} timeout={10_000}>
          <div className="flex h-full flex-col">
            <header className="border-border/60 bg-background/95 supports-[backdrop-filter]:bg-background/80 flex items-center justify-between border-b px-3 py-2 backdrop-blur">
              <WorkspaceSwitcher />
              <div className="flex items-center gap-2">
                <ThemeToggle />
                <UserMenu />
              </div>
            </header>
            <main className="min-h-0 flex-1">
              <IdeLayout sidebar="filetree" center="empty" right="agent" />
            </main>
          </div>
        </DataProvider>
      </WorkspaceProvider>
    </div>
  )
}

function HomeRedirect() {
  const workspace = useCurrentWorkspace()
  if (!workspace) {
    // WorkspaceAuthProvider is still resolving the user's default workspace.
    // Show a tiny loading sliver — replaced when the redirect fires below.
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
