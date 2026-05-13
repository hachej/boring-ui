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

```ts
import { definePanel } from '@hachej/boring-workspace'

export const myPanel = definePanel({
  id: 'my-panel',
  title: 'My Panel',
  placement: 'center',
  // Zero-arg factory → auto-detected as lazy (code-split)
  component: () => import('./MyPane').then(m => ({ default: m.MyPane })),
})
```

---

## Panel component API

Panel components receive `PaneProps<T>`:

```ts
import type { PaneProps } from '@hachej/boring-workspace'

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
  id: 'my-panel',
  component: 'my-panel',
  params: { id: 'item-123' },
})
```

See [plugins.md](./plugins.md) for the full plugin API.
