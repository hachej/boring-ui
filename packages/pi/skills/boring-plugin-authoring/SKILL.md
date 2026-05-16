---
name: boring-plugin-authoring
description: Create or update boring-ui workspace plugins, including hot-reloadable package plugins, React panels, file visualizers, surface resolvers, and Pi/agent contributions. Use when the user asks to build or modify a boring-ui plugin.
---

# Boring Plugin Authoring

## What a boring-ui plugin is

A directory with a `package.json#boring` manifest. Live hot-reloadable
plugins live at `.pi/extensions/<plugin-name>/`. The directory is **not** an
installable npm package — you write the `.tsx`/`.ts` source files directly
and `/reload` re-imports them.

> Do **not** run `npm init`, `npm install`, or create `node_modules/`/`dist/`
> inside `.pi/extensions/<plugin-name>/`. Those are not part of the plugin
> shape and will be ignored. Just write `package.json` + the entry files.

## Minimal hot-reloadable plugin

Write exactly these two files (plus optional `agent/index.ts`):

`.pi/extensions/my-plugin/package.json`

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

`.pi/extensions/my-plugin/front/index.tsx`

```tsx
import React from "react"
import type { BoringFrontFactory } from "@hachej/boring-workspace/plugin"

function MyPane() {
  return <div>Hello from my-plugin</div>
}

const factory: BoringFrontFactory = (api) => {
  api.registerPanel({ id: "my-plugin.panel", label: "My Plugin", component: MyPane })
  api.registerPanelCommand({ id: "my-plugin.open", title: "Open My Plugin", panelId: "my-plugin.panel" })
}

export default factory
```

After editing, the user runs `/reload`.

## `BoringFrontFactory` is **imperative**

The factory signature is `(api) => void | Promise<void>`. Call
`api.registerPanel(...)`, `api.registerPanelCommand(...)`,
`api.registerLeftTab(...)`, `api.registerSurfaceResolver(...)`.

> Do **not** return an object literal like `{ panels: [...], commands: [...] }`.
> That shape is not supported — the workspace will ignore it and your plugin
> will not register anything.

Panel components are normal React function components; `useState` and
`useEffect` work.

## File visualizers — opening files in your panel

Register a panel **and** a surface resolver keyed off
`WORKSPACE_OPEN_PATH_SURFACE_KIND`. The resolver maps a file-open request
into your panel; the panel fetches raw bytes from
`/api/v1/files/raw?path=<workspace-relative-path>`.

```tsx
import React, { useState, useEffect } from "react"
import {
  WORKSPACE_OPEN_PATH_SURFACE_KIND,
  type BoringFrontFactory,
  type PaneProps,
} from "@hachej/boring-workspace"

function CsvPane({ params }: PaneProps<{ path: string }>) {
  const [text, setText] = useState("")
  useEffect(() => {
    fetch(`/api/v1/files/raw?path=${encodeURIComponent(params.path)}`)
      .then((r) => r.text())
      .then(setText)
  }, [params.path])
  return <pre>{text}</pre>
}

const factory: BoringFrontFactory = (api) => {
  api.registerPanel({ id: "csv-viz.panel", label: "CSV Viz", component: CsvPane })
  api.registerSurfaceResolver({
    id: "csv-viz.surface",
    kind: WORKSPACE_OPEN_PATH_SURFACE_KIND,
    resolve(request) {
      if (request.kind !== WORKSPACE_OPEN_PATH_SURFACE_KIND) return undefined
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
}
export default factory
```

## Native agent tools (optional)

`.pi/extensions/<plugin-name>/agent/index.ts` is a Pi extension. The agent
loads it directly — declare it in `package.json#pi.extensions`:

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

## Manifest shortcuts

If your layout follows the conventions (`front/index.tsx`, `server/index.ts`,
`agent/index.ts`), you can omit `boring.front` / `boring.server`. Including
them explicitly is also fine and recommended for clarity.

## Common mistakes — do not do these

- **Do not** `npm init` / `npm install` inside `.pi/extensions/<id>/`.
- **Do not** return `{ panels: [...] }` from `BoringFrontFactory` — call
  `api.registerPanel(...)`.
- **Do not** use `defineFrontPlugin` (legacy) — default-export a
  `BoringFrontFactory` instead.
- **Do not** import Node-only modules from `front/index.tsx`. It runs in
  the browser.
- **Do not** put agent tools in `boring.server`. Agent contributions go
  under `pi`.
- **Do not** add heavy chart libraries (recharts, chart.js) for quick
  visualizers — plain SVG with `<rect>`, `<line>`, `<polyline>` is fine
  and avoids dependency churn.

## More detail

When the simple case above does not cover your situation, read:

- [Plugin authoring reference](../../references/workspace/plugins.md) —
  full package shape, conventions, hot-reload internals.
- [Panel/front API reference](../../references/workspace/panels.md) —
  `PaneProps`, parameter updates, left tabs, layout API.
- [Agent/UI bridge reference](../../references/workspace/bridge.md) — UI
  bridge commands and state.
