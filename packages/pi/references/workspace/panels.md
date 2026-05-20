> boring-ui can create panel components. Ask it to build one for your domain.

# Panels

Panels are React components rendered inside the workspace dockview layout. They receive `PaneProps<T>` and can be opened programmatically by the agent or user.

## Table of Contents

- [Defining a panel](#defining-a-panel)
- [Panel component API](#panel-component-api)
- [Placement](#placement)
- [Auto-lazy loading](#auto-lazy-loading)
- [Opening panels](#opening-panels)

---

## Defining a panel

Hot-reloadable plugin panels are registered from `front/index.tsx` with
`definePlugin({ ... })` from `@hachej/boring-workspace/plugin`:

```tsx
import { definePlugin } from "@hachej/boring-workspace/plugin"

function MyPane() {
  return <div>My Panel</div>
}

export default definePlugin({
  id: "my-plugin",
  label: "My Plugin",
  panels: [
    {
      id: "my-plugin.panel",
      label: "My Panel",
      placement: "center",
      component: MyPane,
    },
  ],
  commands: [
    { id: "my-plugin.open", title: "Open My Panel", panelId: "my-plugin.panel" },
  ],
  // Optional only for persistent sidebar navigation/catalogs:
  // leftTabs: [{ id: "my-plugin.tab", title: "My Plugin", panelId: "my-plugin.panel" }],
})
```

The package manifest only points at this file with `boring.front` and gives the
package a display label. It does not contain panel definitions or template
inheritance metadata.

---

## Panel component API

Panel components receive `PaneProps<T>`. Hot-loaded plugin panels may be normal
React function components using hooks; host Vite config is responsible for
aliasing/deduping React so plugin hooks use the workspace shell's React
singleton.

```ts
import type { PaneProps } from "@hachej/boring-workspace"

interface Params { id?: string; query?: string }

export function MyPane({ params, api, containerApi }: PaneProps<Params>) {
  // params       — data passed when the panel is opened
  // api          — DockviewPanelApi (close, setTitle, onDidParametersChange, …)
  // containerApi — DockviewApi (addPanel, fromJSON, …)
}
```

React to parameter changes (agent re-opens with new params):

```ts
useEffect(() => {
  const disposable = api.onDidParametersChange(() => {
    // params updated
  })
  return () => disposable.dispose()
}, [api])
```

---

## Placement

| value | where |
|---|---|
| `center` | main editor area |
| `right` | right sidebar |
| `bottom` | bottom panel |

---

## Auto-lazy loading

**Do not set `lazy: true`.** The registry auto-detects it:

- Zero-arg function `() => import(...)` → lazy (code-split, loaded on first open)
- Component `(props) => JSX` → eager (loaded at startup)

---

## Plugin panel registration

Prefer declarative `panels`, `commands`, and `leftTabs` fields. For conditional
registration, use the synchronous `setup(api)` escape hatch:

```tsx
import { definePlugin } from "@hachej/boring-workspace/plugin"

export default definePlugin({
  id: "my-plugin",
  setup(api) {
    api.registerPanel({ id: "my-plugin.panel", label: "My Panel", component: MyPane })
    api.registerPanelCommand({ id: "my-plugin.open", title: "Open My Panel", panelId: "my-plugin.panel" })
    api.registerLeftTab({ id: "my-plugin.tab", title: "My Plugin", panelId: "my-plugin.panel" })
  },
})
```

Do not put panel definitions in `package.json#boring`; it only stores discovery
metadata such as `label`, `front`, and optional static `server`.

## Opening panels

From the agent via exec_ui (see [bridge.md](./bridge.md)):

```json
{
  "kind": "openSurface",
  "params": { "kind": "my-plugin.open", "target": "item-123" }
}
```

From React code directly:

```ts
containerApi.addPanel({
  id: "my-panel",
  component: "my-plugin.panel",
  params: { id: "item-123" },
})
```

See [plugins.md](./plugins.md) for the full plugin API.
