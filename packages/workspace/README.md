# @hachej/boring-workspace

Plugin system, panel registry, and IDE-style layout for boring-ui apps.

```bash
pnpm add @hachej/boring-workspace
```

---

## What it provides

- **Plugin system** — contribute panels, commands, catalogs, sidebar tabs, and surface resolvers
- **Layouts** — `ChatLayout`, `IdeLayout`, `ResponsiveDockviewShell`
- **Panel registry** — auto-lazy code splitting, error boundaries, dockview integration
- **Bridge** — typed pubsub between agent backend and frontend panels
- **Built-in plugins** — file tree, editor, artifact surface, command palette

---

## Quickstart

```tsx
import { WorkspaceProvider, IdeLayout } from "@hachej/boring-workspace"
import { ChatPanel } from "@hachej/boring-agent"

export function App() {
  return (
    <WorkspaceProvider chatPanel={ChatPanel} plugins={[myPlugin]}>
      <IdeLayout />
    </WorkspaceProvider>
  )
}
```

---

## Writing a plugin

```ts
import { defineFrontPlugin, definePanel } from "@hachej/boring-workspace"

export const myPlugin = defineFrontPlugin({
  id: "my-plugin",
  label: "My Plugin",
  systemPrompt: "You can open widgets with the 'open-widget' tool.",
  outputs: [
    {
      type: "panel",
      panel: definePanel({
        id: "my-widget",
        title: "Widget",
        placement: "center",
        component: () => import("./WidgetPane").then(m => ({ default: m.WidgetPane })),
      }),
    },
  ],
})
```

Panel components receive `PaneProps<T>`:

```ts
import type { PaneProps } from "@hachej/boring-workspace"

export function WidgetPane({ params, api }: PaneProps<{ id: string }>) {
  // params — data passed when the panel is opened
  // api    — DockviewPanelApi (close, setTitle, …)
}
```

Panels are auto-lazy: a zero-arg factory `() => import(...)` is code-split automatically.

---

## Output types

| type | contributes |
|---|---|
| `panel` | a center/right/bottom pane |
| `left-tab` | a persistent sidebar tab |
| `command` | a command palette entry |
| `catalog` | a searchable data explorer |
| `surface-resolver` | maps agent `exec_ui` calls to panel opens |

---

## Part of [boring-ui](https://github.com/hachej/boring-ui)

| Package | Role |
|---|---|
| `@hachej/boring-agent` | Agent runtime + tools |
| `@hachej/boring-workspace` | Plugin system, workbench |
| `@hachej/boring-core` | DB, auth, app factory |
| `@hachej/boring-ui-kit` | Shared UI primitives |
| `@hachej/boring-ui-cli` | Zero-setup CLI |
