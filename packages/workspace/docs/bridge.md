> boring-ui agents use exec_ui to open panels and interact with the workspace. Ask boring-ui to wire up a new surface.

# UI Bridge

The UI bridge is the typed pubsub channel between the agent backend and the workspace frontend. The agent calls `exec_ui` (a tool) to post commands; the frontend dispatches them against the live workspace runtime.

## Table of Contents

- [Opening a panel from the agent](#opening-a-panel-from-the-agent)
- [openSurface vs openPanel](#opensurface-vs-openpanel)
- [Reading current UI state](#reading-current-ui-state)
- [Surface resolvers](#surface-resolvers)
- [Posting from server code](#posting-from-server-code)
- [Frontend event bus](#frontend-event-bus)

---

## Opening a panel from the agent

Use `exec_ui` with `kind: "openSurface"`:

```json
{
  "kind": "openSurface",
  "params": {
    "kind": "my-plugin.open",
    "target": "item-123",
    "meta": { "title": "My Item" }
  }
}
```

The workspace routes this to the plugin's `surface-resolver` output, which maps the `kind` to a concrete panel open call.

---

## openSurface vs openPanel

| method | use when |
|---|---|
| `openSurface` | you want plugin resolver selection — preferred for domain targets |
| `openPanel` | you intentionally name the concrete panel id |

**Prefer `openSurface`.** It keeps the agent decoupled from panel ids and lets the plugin control routing.

Open a file in the editor (built-in surface):

```json
{
  "kind": "openSurface",
  "params": {
    "kind": "workspace.open.path",
    "target": "src/index.ts"
  }
}
```

---

## Reading current UI state

Use `get_ui_state` before `openPanel` to discover which panel components are registered, or to check what the user is currently viewing:

```json
// tool call: get_ui_state (no params)
// returns:
{
  "workbenchOpen": true,
  "drawerOpen": false,
  "openTabs": [{ "id": "...", "title": "...", "params": {} }],
  "activeTab": "tab-id-or-null",
  "activeFile": "src/index.ts-or-null",
  "availablePanels": ["code-editor", "chart-canvas", "..."]
}
```

`availablePanels` lists every component id registered by the host — use these with `exec_ui openPanel`.

---

## Surface resolvers

Register a surface resolver in your plugin to map `SurfaceOpenRequest` kinds to panel opens:

```ts
import { defineFrontPlugin, type SurfacePanelResolution } from '@boring/workspace'

defineFrontPlugin({
  outputs: [
    {
      type: 'surface-resolver',
      resolve(req): SurfacePanelResolution | null {
        if (req.kind === 'my-plugin.open') {
          return {
            panelId: 'my-panel',
            params: { id: req.target },
          }
        }
        return null
      },
    },
  ],
})
```

---

## Posting from server code

From a Fastify route or server plugin:

```ts
import { postUiCommand } from '@boring/workspace/server'

await postUiCommand(workspaceId, {
  kind: 'openSurface',
  params: { kind: 'my-plugin.open', target: 'item-123' },
})
```

---

## Frontend event bus

Subscribe to workspace events on the frontend:

```ts
import { events, workspaceEvents } from '@boring/workspace'

events.on(workspaceEvents.panelOpened, (panel) => {
  console.log('panel opened', panel.id)
})
```

See [plugins.md](./plugins.md) to register a surface resolver in your plugin.
