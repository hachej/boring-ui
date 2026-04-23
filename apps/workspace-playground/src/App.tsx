import {
  WorkspaceProvider,
  useTheme,
  IdeLayout,
  FileTreePane,
  EmptyPane,
  DataProvider,
} from "@boring/workspace"
import type { PanelConfig } from "@boring/workspace"

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

function PlaygroundFileTree() {
  return <FileTreePane rootDir="" />
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
