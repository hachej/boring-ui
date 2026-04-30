# @boring/workspace

Frontend-only workspace layout package for composing chat, file, editor, and app-specific panes.

## Three-tier API

### Tier 1: Preset Layouts

Use `ChatLayout` or `IdeLayout` when the stock workspace shape fits and you only need to choose panels by id.

```tsx
import { ChatLayout, WorkspaceProvider } from "@boring/workspace"

export function App() {
  return (
    <WorkspaceProvider plugins={[myPlugin]}>
      <ChatLayout sidebar="files" surface="artifact-surface" />
    </WorkspaceProvider>
  )
}
```

### Tier 2: Declarative Shell

Use `TopBar` with `ResponsiveDockviewShell` when preset slots are too narrow but you still want stock responsive chrome.

```tsx
import { ResponsiveDockviewShell, TopBar, WorkspaceProvider } from "@boring/workspace"

export function App() {
  return (
    <WorkspaceProvider plugins={[myPlugin]}>
      <TopBar appTitle="My App" />
      <ResponsiveDockviewShell layout={myLayout} />
    </WorkspaceProvider>
  )
}
```

### Tier 3: Dock Runtime

Use `DockviewShell` directly when the host owns all chrome and wants only registry-backed panel rendering.

```tsx
import { DockviewShell, WorkspaceProvider } from "@boring/workspace"

export function App() {
  return (
    <WorkspaceProvider plugins={[myPlugin]}>
      <DockviewShell layout={myLayout} />
    </WorkspaceProvider>
  )
}
```
