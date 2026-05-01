# @boring/workspace

Workspace UI and bridge package for composing chat, files, catalogs, editors,
and app-specific panes. It provides React layouts, plugin registries, default
workspace plugins, and server helpers that wire workspace UI tools onto
`@boring/agent`.

App shells still own auth, routing, application persistence, and the concrete
chat component. Pass the chat component to `WorkspaceProvider` when rendering
chat chrome.

## Docs

- `docs/INTERFACES.md` - current package boundaries and contracts.
- `docs/PLUGIN_STRUCTURE.md` - plugin layout and invariant checks.
- `docs/plans/` - historical implementation plans.

## Three-tier API

### Tier 1: Preset Layouts

Use `ChatLayout` or `IdeLayout` when the stock workspace shape fits and you only need to choose panels by id.

```tsx
import { ChatPanel } from "@boring/agent"
import { ChatLayout, WorkspaceProvider } from "@boring/workspace"

export function App() {
  return (
    <WorkspaceProvider chatPanel={ChatPanel} plugins={[myPlugin]}>
      <ChatLayout sidebar="files" surface="artifact-surface" />
    </WorkspaceProvider>
  )
}
```

### Tier 2: Declarative Shell

Use `TopBar` with `ResponsiveDockviewShell` when preset slots are too narrow but you still want stock responsive chrome.

```tsx
import { ChatPanel } from "@boring/agent"
import { ResponsiveDockviewShell, TopBar, WorkspaceProvider } from "@boring/workspace"

export function App() {
  return (
    <WorkspaceProvider chatPanel={ChatPanel} plugins={[myPlugin]}>
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
