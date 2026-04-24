import { useMemo } from 'react'
import './app.css'
import '@boring/workspace/globals.css'
import '@boring/agent/ui-shadcn/styles.css'
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
    component: FileTreeWrapper as React.ComponentType<unknown>,
    placement: 'left',
    source: 'app',
  },
  {
    id: 'code-editor',
    title: 'Editor',
    component: CodeEditorWrapper as React.ComponentType<unknown>,
    placement: 'center',
    filePatterns: ['*.ts', '*.tsx', '*.js', '*.jsx', '*.json', '*.css', '*.py', '*.sql', '*.yaml', '*.yml'],
    source: 'app',
  },
  {
    id: 'markdown-editor',
    title: 'Markdown',
    component: MarkdownEditorWrapper as React.ComponentType<unknown>,
    placement: 'center',
    filePatterns: ['*.md', '*.mdx'],
    source: 'app',
  },
  {
    id: 'empty',
    title: 'Welcome',
    component: EmptyPane as React.ComponentType<unknown>,
    placement: 'center',
    source: 'app',
  },
  {
    id: 'agent',
    title: 'Agent',
    component: ChatPanelWrapper as React.ComponentType<unknown>,
    placement: 'right',
    source: 'app',
  },
]

const API_BASE_URL = ''

export function App() {
  return (
    <div className="h-full bg-background text-foreground">
      <WorkspaceProvider
        panels={panels}
        apiBaseUrl={API_BASE_URL}
        persistenceEnabled
        storageKey="boring-ui-v2:layout:ide"
      >
        <DataProvider apiBaseUrl={API_BASE_URL} authHeaders={{}} timeout={10000}>
          <IdeLayout sidebar="filetree" center="empty" right="agent" />
        </DataProvider>
      </WorkspaceProvider>
    </div>
  )
}
