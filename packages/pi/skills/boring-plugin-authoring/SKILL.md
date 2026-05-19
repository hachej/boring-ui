---
name: boring-plugin-authoring
description: Create, extend, or update boring-ui workspace plugins, including hot-reloadable user plugins, app-default plugins shipped with apps, React panels, file visualizers, surface resolvers, server-side agent tools, and Pi/agent contributions. Use when the user asks to build, extend, configure, or modify a boring-ui plugin.
---

# Boring Plugin Authoring

## What a boring-ui plugin is

A directory with `package.json` declaring `boring` and/or `pi` fields.
Plugins enter the workspace through **one load process**:

```
                                                                
   Source → BoringPluginAssetManager scan → SSE event           
                  → front dynamic import (Vite /@fs/)           
                  → server load (jiti, fresh on each /reload)   
                                                                
```

Three places plugins can come from — same load pipeline for all:

| Source | Used for |
|---|---|
| `<workspace>/.pi/extensions/<name>/` | User-added plugins (you write them locally, /reload picks them up) |
| `defaultPluginPackages` in `createWorkspaceAgentServer` | App-default plugins (npm packages the app ships with) |
| `pi install npm:<pkg>` | Ad-hoc Pi-installed packages (the workspace picks them up via Pi's package registry) |

## The single way to define a plugin: `definePlugin`

```ts
import { definePlugin } from "@hachej/boring-workspace/plugin"

export default definePlugin("my-plugin", (api) => {
  api.registerPanel({ ... })
  api.registerPanelCommand({ ... })
  api.registerSurfaceResolver({ ... })
}, { label: "My Plugin" })
```

`definePlugin(id, factory, { label? })` returns a `BoringFrontFactoryWithId` —
a function with `pluginId` (and optional `pluginLabel`) static fields. The
workspace shell auto-wraps it when you pass it to `WorkspaceProvider.plugins`,
and the asset manager loads it identically whether it lives in
`.pi/extensions/<name>/` or an npm package.

> Do **not** use `defineFrontPlugin` (removed from the public API), do **not**
> return an object literal like `{ panels: [...] }` from the factory, and do
> **not** `npm init` inside `.pi/extensions/<name>/`.

## Minimal hot-reloadable user plugin

The fastest way is the CLI scaffold (writes `package.json` + `front/index.tsx`
into `<workspace>/.pi/extensions/<name>/`, then a `/reload` picks it up):

```sh
# Run from inside the workspace root:
npx @hachej/boring-ui-cli scaffold-plugin my-plugin
# …or pass the workspace path explicitly:
npx @hachej/boring-ui-cli scaffold-plugin my-plugin /path/to/workspace
```

Or write the two files by hand:

`package.json`

```jsonc
{
  "name": "my-plugin",
  "version": "1.0.0",
  "boring": {
    "label": "My Plugin",
    "front": "front/index.tsx",
    "server": false
  },
  "pi": {
    "systemPrompt": "Short hint about when the agent should use this plugin."
  }
}
```

`front/index.tsx`

```tsx
import React from "react"
import { definePlugin } from "@hachej/boring-workspace/plugin"

function MyPane() {
  return <div>Hello from my-plugin</div>
}

export default definePlugin("my-plugin", (api) => {
  api.registerPanel({ id: "my-plugin.panel", label: "My Plugin", component: MyPane })
  api.registerPanelCommand({ id: "my-plugin.open", title: "Open My Plugin", panelId: "my-plugin.panel" })
}, { label: "My Plugin" })
```

After editing, the user runs `/reload`.

## App-default plugins (apps ship with these)

For plugins an app installs as npm deps (e.g. `@hachej/boring-ask-user`),
declare them in the workspace server boot:

```ts
// apps/my-app/src/server/dev.ts
await createWorkspaceAgentServer({
  workspaceRoot,
  defaultPluginPackages: ["@hachej/boring-ask-user"],
})
```

The workspace:
1. Resolves each name via `require.resolve('<name>/package.json')`
2. Registers the package dir as a plugin source (asset manager scans it)
3. Forwards its `pi.*` contributions to Pi (skills, systemPrompt, extensions)
4. Loads its `boring.server` via the standard jiti path on /reload

The app's front-end (`apps/my-app/src/front/App.tsx`) does **not** import
or list these packages in `WorkspaceProvider.plugins` — they arrive on the
front via SSE just like `.pi/extensions/<name>/` plugins.

## Extending an existing plugin (no `composePlugins` helper)

There's no library function for composition because the imperative API makes
composition trivial — you just call functions with the same `api`. Five
patterns ranked by frequency:

### 1. Configure via factory options (most common)

Most plugins are factories taking options. Wrap with your own configuration
and default-export the result. List the wrapper under `defaultPluginPackages`.

```ts
// my-app/src/plugins/my-data/front/index.tsx
import { createDataCatalogPlugin } from "@hachej/boring-data-catalog"
import { myAdapter } from "./adapter"
export default createDataCatalogPlugin({ adapter: myAdapter, label: "My Data" })
```

### 2. Component reuse from primitive packages

Plugins like `@hachej/boring-data-explorer` are libraries — they export React
components/hooks (no factory). Use them inside your own plugin's UI:

```tsx
import { definePlugin } from "@hachej/boring-workspace/plugin"
import { DataExplorer } from "@hachej/boring-data-explorer/front"

export default definePlugin("my-thing", (api) => {
  api.registerPanel({
    id: "my-thing.panel",
    component: () => <DataExplorer adapter={myAdapter} />,
  })
})
```

### 3. Wrap a factory (chain by sharing `api`)

Run the base plugin's registrations, then add your own:

```ts
import { definePlugin } from "@hachej/boring-workspace/plugin"
import { createDataCatalogPlugin } from "@hachej/boring-data-catalog"

const baseFactory = createDataCatalogPlugin({ adapter: myAdapter })

export default definePlugin("my-extended", (api) => {
  baseFactory(api)                         // base registrations
  api.registerPanelCommand({               // your additions
    id: "my-extended.export",
    title: "Export to CSV",
    panelId: "my-extended-panel",
  })
})
```

### 4. Side-by-side declaration

Just list multiple plugins. They coexist in the registries (each scoped by
its `pluginId`):

```ts
defaultPluginPackages: ["@hachej/boring-ask-user", "./src/plugins/my-data"]
```

### 5. Fork (last resort)

If upstream options don't cover what you need to change, copy the plugin's
source into your own package and modify. Standard npm pattern.

## File visualizers — opening files in your panel

Register a panel **and** a surface resolver keyed off
`WORKSPACE_OPEN_PATH_SURFACE_KIND`. The resolver maps a file-open request
into your panel; the panel fetches raw bytes from
`/api/v1/files/raw?path=<workspace-relative-path>`.

```tsx
import React, { useState, useEffect } from "react"
import { definePlugin } from "@hachej/boring-workspace/plugin"
import { WORKSPACE_OPEN_PATH_SURFACE_KIND, type PaneProps } from "@hachej/boring-workspace"

function CsvPane({ params }: PaneProps<{ path: string }>) {
  const [text, setText] = useState("")
  useEffect(() => {
    fetch(`/api/v1/files/raw?path=${encodeURIComponent(params.path)}`)
      .then((r) => r.text())
      .then(setText)
  }, [params.path])
  return <pre>{text}</pre>
}

export default definePlugin("csv-viz", (api) => {
  api.registerPanel({ id: "csv-viz.panel", label: "CSV Viz", component: CsvPane })
  api.registerSurfaceResolver({
    id: "csv-viz.surface",
    kind: WORKSPACE_OPEN_PATH_SURFACE_KIND,
    resolve(request) {
      if (!request.target.toLowerCase().endsWith(".csv")) return undefined
      return {
        id: `csv-viz:${request.target}`,
        component: "csv-viz.panel",
        title: request.target.split("/").pop() ?? request.target,
        params: { path: request.target },
        score: 100,
      }
    },
  })
}, { label: "CSV Viewer" })
```

## Server-side plugin (agent tools, routes)

If your plugin contributes agent tools or HTTP routes, declare `boring.server`
in `package.json` and add a server entry. `boring.server` has two valid
default-export shapes — the workspace discriminates by function arity:

### Shape A — `WorkspaceServerPlugin` factory (most plugins)

For plugins contributing agent tools + routes via a single `WorkspaceServerPlugin`
object. Signature `(options, ctx) => WorkspaceServerPlugin` (arity ≥ 2):

```ts
// .pi/extensions/my-plugin/server/index.ts  OR
// plugins/my-plugin/src/server/index.ts
import { defineServerPlugin, type WorkspaceServerPlugin } from "@hachej/boring-workspace/server"

export default function myServerPlugin(
  _options: unknown,
  ctx: { workspaceRoot: string; bridge: unknown },
): WorkspaceServerPlugin {
  return defineServerPlugin({
    id: "my-plugin",
    agentTools: [
      {
        name: "my_tool",
        description: "What this tool does.",
        parameters: { type: "object", properties: {} },
        async execute() {
          return { content: [{ type: "text", text: `workspace at ${ctx.workspaceRoot}` }] }
        },
      },
    ],
    routes: async (app) => {
      app.get("/my-plugin/status", async () => ({ ok: true }))
    },
    systemPrompt: "Use my_tool when …",
  })
}
```

### Shape B — `BoringServerFactory` (routes only, no agent tools)

If your plugin only contributes HTTP routes (no tools, no systemPrompt),
use the simpler `BoringServerFactory = (api) => void` shape (arity ≤ 1):

```ts
import type { BoringServerFactory } from "@hachej/boring-workspace/server"

const server: BoringServerFactory = (api) => {
  api.get("/my-plugin/health", async () => ({ ok: true }))
}

export default server
```

The asset manager arity-discriminates: arity-1 → registers routes directly;
arity-2 → skipped here (the plugin loads via `pluginEntryResolver` and its
`WorkspaceServerPlugin.routes` is wired by the bootstrap).

## Native Pi extension (agent-side tools, optional)

`.pi/extensions/<plugin-name>/agent/index.ts` is a Pi extension (different
from `boring.server` — this runs inside the Pi agent process, not as a
workspace-side route). Declare in `package.json#pi.extensions`:

```jsonc
{ "pi": { "extensions": ["agent/index.ts"], "systemPrompt": "..." } }
```

```ts
export default function extension(api: { registerTool(tool: unknown): void }) {
  api.registerTool({
    name: "my_plugin_status",
    description: "What this tool does.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute() {
      return { content: [{ type: "text", text: "ok" }] }
    },
  })
}
```

Use this for tools the agent should reach without going through the workspace's
HTTP layer (e.g. lightweight in-process state queries).

## Manifest shortcuts

If your layout follows the conventions (`front/index.tsx`, `server/index.ts`,
`agent/index.ts`), you can omit `boring.front` / `boring.server`. Including
them explicitly is also fine and recommended for clarity.

Plugins ALWAYS need a `package.json#name` — that becomes the plugin id
(`@scope/name` becomes `scope-name`).

## Common mistakes — do not do these

- **Do not** `npm init` / `npm install` inside `.pi/extensions/<id>/`.
- **Do not** use `defineFrontPlugin` (removed from public API) — use
  `definePlugin(id, factory, { label? })`.
- **Do not** return `{ panels: [...] }` from the factory — call
  `api.registerPanel(...)`.
- **Do not** import `composePlugins` (removed) — chain factories by calling
  them sequentially with the same `api`.
- **Do not** import Node-only modules from `front/index.tsx` (it runs in
  the browser).
- **Do not** put agent tools in `boring.server` arity-1 form (`BoringServerFactory`)
  — that shape only handles routes. Use the arity-2 `(options, ctx) =>
  WorkspaceServerPlugin` form for `agentTools`.
- **Do not** add heavy chart libraries (recharts, chart.js) for quick
  visualizers — plain SVG with `<rect>`, `<line>`, `<polyline>` is fine.

## More detail

When the patterns above don't cover your case, read:

- [Plugin authoring reference](../../references/workspace/plugins.md) —
  full package shape, conventions, hot-reload internals.
- [Panel/front API reference](../../references/workspace/panels.md) —
  `PaneProps`, parameter updates, left tabs, layout API.
- [Agent/UI bridge reference](../../references/workspace/bridge.md) — UI
  bridge commands and state.
