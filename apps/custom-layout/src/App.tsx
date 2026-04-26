import { WorkspaceProvider, DockviewShell, DataProvider, FileTreePane, CodeEditorPane, MarkdownEditorPane, EmptyPane, type LayoutConfig, type PanelConfig } from "@boring/workspace"

const layout: LayoutConfig = {
  version: "2.0",
  groups: [
    { id: "left", position: "left", panel: "file-tree", constraints: { minWidth: 180, maxWidth: 360 } },
    { id: "center", position: "center", panel: "empty" },
    { id: "right", position: "right", panel: "preview", dynamic: true, placeholder: "empty", constraints: { minWidth: 280, maxWidthViewportRatio: 0.4 } },
  ],
}

function FileTreeWrapper(props: Record<string, unknown>) {
  return <FileTreePane rootDir="/" panelApi={(props as { api?: unknown }).api as never} />
}
function CodeEditorWrapper(props: Record<string, unknown>) {
  const p = props as { params?: { path?: string }; api?: unknown }
  return <CodeEditorPane path={p.params?.path ?? ""} panelApi={p.api as never} chromeless />
}
function MarkdownWrapper(props: Record<string, unknown>) {
  const p = props as { params?: { path?: string }; api?: unknown }
  return <MarkdownEditorPane path={p.params?.path ?? ""} panelApi={p.api as never} chromeless />
}

const panels: PanelConfig[] = [
  { id: "file-tree", title: "Files", component: FileTreeWrapper as React.ComponentType<unknown>, placement: "left", source: "app" },
  { id: "code-editor", title: "Editor", component: CodeEditorWrapper as React.ComponentType<unknown>, placement: "center", source: "app" },
  { id: "markdown-editor", title: "Markdown", component: MarkdownWrapper as React.ComponentType<unknown>, placement: "center", source: "app" },
  { id: "preview", title: "Preview", component: CodeEditorWrapper as React.ComponentType<unknown>, placement: "right", source: "app" },
  { id: "empty", title: "Welcome", component: EmptyPane as React.ComponentType<unknown>, placement: "center", source: "app" },
]

export function CustomLayoutApp() {
  return (
    <div className="h-full bg-background text-foreground">
      <WorkspaceProvider panels={panels} apiBaseUrl="" persistenceEnabled storageKey="boring-custom-layout:layout">
        <DataProvider apiBaseUrl="" authHeaders={{}} timeout={5000}>
          <DockviewShell layout={layout} storageKey="boring-custom-layout:dockview" />
        </DataProvider>
      </WorkspaceProvider>
    </div>
  )
}
