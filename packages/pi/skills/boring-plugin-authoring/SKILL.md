---
name: boring-plugin-authoring
description: Create, extend, or update boring-ui workspace plugins, including hot-reloadable user plugins, app-default plugins shipped with apps, React panels, file visualizers, surface resolvers, server-side agent tools, and Pi/agent contributions. Use when the user asks to build, extend, configure, or modify a boring-ui plugin.
---

# Boring Plugin Authoring

## STEP 0 — Always scaffold first

Don't write plugin files from scratch. The CLI scaffold produces a known-correct
`package.json` + `front/index.tsx` skeleton under `.pi/extensions/<name>/`.
**Run it, then read the generated files, then customize.** This guarantees the
file layout, API surface (`definePlugin`, `registerPanel`, etc.), and import
paths are correct — the parts agents most often invent or get wrong.

```sh
# From inside the workspace root (or pass workspace path as 2nd arg):
npx @hachej/boring-ui-cli scaffold-plugin <kebab-name>
```

The scaffold writes exactly two files:

- `.pi/extensions/<name>/package.json` — manifest with `boring.front`, `pi.systemPrompt`
- `.pi/extensions/<name>/front/index.tsx` — `definePlugin` factory registering one panel + command + left tab

**Workflow:**

1. Run the scaffold command via the bash tool.
2. Read the two generated files with the read tool.
3. Edit them in place with the edit tool — do **NOT** rewrite from scratch.
4. Tell the user to run `/reload` (the workspace picks up the new plugin).

If the scaffold says the plugin already exists, you can read the existing
files directly and skip step 1.

## The API surface (exact names — do not invent variations)

The factory receives a `BoringFrontApi` object. Only these methods exist:

| Method | Purpose |
|---|---|
| `api.registerPanel({ id, label, component })` | Register a React component as a panel |
| `api.registerPanelCommand({ id, title, panelId })` | Add a slash-command that opens the panel |
| `api.registerLeftTab({ id, title, panelId })` | Add a sidebar tab |
| `api.registerSurfaceResolver({ id, kind, resolve })` | Map a domain target → panel |

**Common invented names that DO NOT EXIST and will silently fail:**

- ❌ `api.registerComponent(...)` — use `registerPanel`
- ❌ `api.addPanel(...)` / `api.add(...)` — use `registerPanel`
- ❌ `api.registerCommand(...)` (with no `Panel`) — use `registerPanelCommand`
- ❌ `api.registerTab(...)` — use `registerLeftTab`

The factory is **imperative**: it calls registration methods. It MUST NOT
return an object literal:

```ts
// WRONG — the factory must not return data:
export default definePlugin("x", () => ({ panels: [...] }))

// RIGHT — the factory calls registration methods:
export default definePlugin("x", (api) => {
  api.registerPanel({ id: "x.panel", label: "X", component: XPane })
})
```

## File layout (do not put files elsewhere)

User-added plugins live under `<workspace>/.pi/extensions/<name>/`. Inside
that directory:

```
.pi/extensions/<name>/
├── package.json          # manifest (boring.front, boring.server, pi.systemPrompt, pi.extensions)
├── front/index.tsx       # front factory (boring.front)
├── server/index.ts       # OPTIONAL — only if boring.server is true
└── agent/index.ts        # OPTIONAL — Pi extension, declared in pi.extensions
```

Do **NOT**:

- Put files at the package root (`index.ts`, `index.js`, `index.tsx` at the
  same level as `package.json`).
- Create `src/`, `dist/`, `lib/`, `build/` subdirectories — there is no
  compile step; the dev server transforms `.tsx` on the fly via Vite.
- Run `npm init`, `npm install`, `tsc`, or any build command inside the
  plugin dir. The scaffold's `package.json` already has `private: true`
  and no scripts.
- Create a `tsconfig.json` or `node_modules/` inside the plugin dir.
- Create a `README.md` unless the user asks for one.

## package.json shape

The scaffold writes this. Customize fields but keep the structure:

```jsonc
{
  "name": "<kebab-name>",         // becomes plugin id; @scope/x becomes scope-x
  "version": "0.1.0",
  "private": true,
  "boring": {
    "label": "<Display Label>",   // shown in panel chrome
    "front": "front/index.tsx",   // path to front factory file
    "server": false               // true if you add server/index.ts
  },
  "pi": {
    "systemPrompt": "<1-2 sentences telling the agent when this plugin is relevant>",
    "extensions": ["agent/index.ts"]  // OPTIONAL — only if you write a Pi extension
  }
}
```

## front/index.tsx canonical shape

```tsx
import React from "react"
import { definePlugin } from "@hachej/boring-workspace/plugin"

function MyPane() {
  return <div style={{ padding: 16 }}>Hello from my-plugin</div>
}

export default definePlugin(
  "my-plugin",               // MUST match package.json#name
  (api) => {
    api.registerPanel({
      id: "my-plugin.panel",
      label: "My Plugin",
      component: MyPane,
    })
    api.registerPanelCommand({
      id: "my-plugin.open",
      title: "Open My Plugin",
      panelId: "my-plugin.panel",
    })
    api.registerLeftTab({
      id: "my-plugin.tab",
      title: "My Plugin",
      panelId: "my-plugin.panel",
    })
  },
  { label: "My Plugin" },
)
```

Notes:

- The first arg to `definePlugin` MUST match `package.json#name` (string,
  not template literal).
- Panel/command/tab ids should be `<plugin-id>.<thing>` — convention.
- Import React explicitly (no `globalThis.React`).
- Do NOT use `defineFrontPlugin` (removed from the public API).

## Common patterns

### File visualizer (opens files in your panel)

Use `WORKSPACE_OPEN_PATH_SURFACE_KIND` so the workspace routes file-open
requests through your resolver:

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
  api.registerPanel({ id: "csv-viz.panel", label: "CSV", component: CsvPane })
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

Read raw file bytes from `/api/v1/files/raw?path=<workspace-relative-path>`.
For charts, use plain SVG (`<rect>`, `<line>`, `<polyline>`) — do not add
recharts / chart.js dependencies.

### Server-side plugin (agent tools or HTTP routes)

Add `boring.server: true` to package.json, then create `server/index.ts`.
Two valid shapes, discriminated by arity:

```ts
// server/index.ts — arity-2: contributes agent tools + routes
import { defineServerPlugin, type WorkspaceServerPlugin } from "@hachej/boring-workspace/server"

export default function (
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
          return { content: [{ type: "text", text: "ok" }] }
        },
      },
    ],
    routes: async (app) => {
      app.get("/my-plugin/status", async () => ({ ok: true }))
    },
    systemPrompt: "Use my_tool when the user asks about …",
  })
}
```

```ts
// server/index.ts — arity-1: routes only, no agent tools
import type { BoringServerFactory } from "@hachej/boring-workspace/server"

const server: BoringServerFactory = (api) => {
  api.get("/my-plugin/health", async () => ({ ok: true }))
}
export default server
```

### Pi-side agent extension (rare)

`.pi/extensions/<name>/agent/index.ts` runs inside the Pi agent process.
Use for in-process state queries the agent should reach without HTTP. Declare
in `package.json#pi.extensions: ["agent/index.ts"]`.

### Extending an existing plugin (no `composePlugins` helper)

There's no library function — just chain factories with the same `api`:

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

For component reuse (e.g. `@hachej/boring-data-explorer` exports React
components), just import and render them inside your panel:

```tsx
import { DataExplorer } from "@hachej/boring-data-explorer/front"

api.registerPanel({
  id: "my-thing.panel",
  component: () => <DataExplorer adapter={myAdapter} />,
})
```

## App-default plugins (apps ship with these)

For plugins an app installs as npm deps (`@hachej/boring-ask-user` etc.),
declare in the workspace boot:

```ts
await createWorkspaceAgentServer({
  workspaceRoot,
  defaultPluginPackages: ["@hachej/boring-ask-user"],
})
```

The app's front-end (`apps/<app>/src/front/App.tsx`) does **not** also list
these in `WorkspaceProvider.plugins` — they arrive via SSE just like
`.pi/extensions/<name>/` plugins.

## After editing — tell the user to /reload

Hot reload is driven by the user (via `/reload`), not by the agent. After
your edits, end your message with a line telling the user to run `/reload`.
The workspace then re-scans `.pi/extensions/` and re-imports affected files.

## More detail

When patterns above don't cover your case, read:

- [Plugin authoring reference](../../references/workspace/plugins.md) —
  full package shape, conventions, hot-reload internals.
- [Panel/front API reference](../../references/workspace/panels.md) —
  `PaneProps`, parameter updates, left tabs, layout API.
- [Agent/UI bridge reference](../../references/workspace/bridge.md) — UI
  bridge commands and state.
