import { useMemo } from "react"
import {
  WorkspaceProvider,
  useTheme,
  IdeLayout,
  FileTreePane,
  CodeEditorPane,
  MarkdownEditorPane,
  EmptyPane,
  DataProvider,
  useDockviewApi,
} from "@boring/workspace"
import type { PanelConfig, DockviewShellApi } from "@boring/workspace"

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  return (
    <button
      type="button"
      data-testid="theme-toggle"
      onClick={toggleTheme}
      className="fixed top-2 right-2 z-50 rounded border border-border bg-background px-3 py-1 text-sm text-foreground hover:bg-accent"
    >
      {theme === "light" ? "Dark" : "Light"}
    </button>
  )
}

function createLocalBridge(shellApi: DockviewShellApi) {
  return {
    openFile(path: string, _opts?: { mode?: string }) {
      const ext = path.split(".").pop()?.toLowerCase()
      const component = ext === "md" || ext === "markdown"
        ? "markdown-editor"
        : "code-editor"
      const panelId = `file:${path}`

      shellApi.activatePanel(panelId)
      if (shellApi.getActivePanel() === panelId) return { status: "ok" as const }

      const title = path.split("/").pop() ?? path
      shellApi.addPanel("center", {
        id: panelId,
        component,
        title,
        params: { path },
      })
      return { status: "ok" as const }
    },
    openPanel() { return { status: "ok" as const } },
    closePanel() { return { status: "ok" as const } },
    showNotification() { return { status: "ok" as const } },
    navigateToLine() { return { status: "ok" as const } },
    expandToFile() { return { status: "ok" as const } },
    markDirty() {},
    markClean() {},
    getOpenPanels() { return [] },
    getActiveFile() { return null },
    getDirtyFiles() { return [] },
    getVisibleFiles() { return [] },
    subscribe() { return () => {} },
    select() { return () => {} },
  }
}

function PlaygroundFileTree() {
  const shellApi = useDockviewApi()
  const bridge = useMemo(() => createLocalBridge(shellApi), [shellApi])
  return <FileTreePane rootDir="" bridge={bridge as any} />
}

function PlaygroundCodeEditor(props: Record<string, any>) {
  const path = props.params?.path ?? props.path ?? ""
  const panelApi = props.api ?? props.panelApi
  return <CodeEditorPane path={path} panelApi={panelApi} />
}

function PlaygroundMarkdownEditor(props: Record<string, any>) {
  const path = props.params?.path ?? props.path ?? ""
  const panelApi = props.api ?? props.panelApi
  return <MarkdownEditorPane path={path} panelApi={panelApi} />
}

const panels: PanelConfig[] = [
  {
    id: "filetree",
    title: "Files",
    component: PlaygroundFileTree as React.ComponentType<unknown>,
    placement: "left",
    source: "app",
  },
  {
    id: "empty",
    title: "Welcome",
    component: EmptyPane as React.ComponentType<unknown>,
    placement: "center",
    source: "app",
  },
  {
    id: "code-editor",
    title: "Editor",
    component: PlaygroundCodeEditor as React.ComponentType<unknown>,
    placement: "center",
    source: "app",
  },
  {
    id: "markdown-editor",
    title: "Markdown",
    component: PlaygroundMarkdownEditor as React.ComponentType<unknown>,
    placement: "center",
    source: "app",
  },
]

export function App() {
  return (
    <div className="h-full bg-background text-foreground">
      <WorkspaceProvider
        panels={panels}
        apiBaseUrl=""
        persistenceEnabled
        storageKey="boring-ui-v2:layout:playground"
      >
        <DataProvider apiBaseUrl="" authHeaders={{}} timeout={5000}>
          <ThemeToggle />
          <IdeLayout sidebar="filetree" center="empty" />
        </DataProvider>
      </WorkspaceProvider>
    </div>
  )
}
