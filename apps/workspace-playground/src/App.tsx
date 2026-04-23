import { useCallback, useState } from "react"
import {
  WorkspaceProvider,
  useTheme,
  IdeLayout,
  FileTreePane,
  CodeEditorPane,
  MarkdownEditorPane,
  EmptyPane,
  DataProvider,
} from "@boring/workspace"
import type { PanelConfig } from "@boring/workspace"

function isMarkdown(path: string): boolean {
  return /\.md$/i.test(path)
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <button
      type="button"
      onClick={() => setTheme(theme === "light" ? "dark" : "light")}
      className="fixed top-2 right-2 z-50 rounded border border-border bg-background px-3 py-1 text-sm text-foreground hover:bg-accent"
    >
      {theme === "light" ? "Dark" : "Light"}
    </button>
  )
}

function FileTreeWrapper() {
  return <FileTreePane rootDir="" />
}

function EditorRouter({ path }: { path: string }) {
  if (isMarkdown(path)) {
    return <MarkdownEditorPane path={path} />
  }
  return <CodeEditorPane path={path} />
}

const panels: PanelConfig[] = [
  {
    id: "filetree",
    title: "Files",
    component: FileTreeWrapper as React.ComponentType<unknown>,
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
]

export function App() {
  return (
    <div className="h-full bg-background text-foreground">
      <WorkspaceProvider
        panels={panels}
        apiBaseUrl=""
        persistenceEnabled={false}
      >
        <DataProvider apiBaseUrl="" authHeaders={{}} timeout={5000}>
          <ThemeToggle />
          <IdeLayout sidebar="filetree" center="empty" />
        </DataProvider>
      </WorkspaceProvider>
    </div>
  )
}
