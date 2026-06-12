# API reference — `definePlugin`, package.json, plugin-local deps

## The API surface — `definePlugin(config)`

`definePlugin` takes a declarative config object. Each `<thing>s` field
is an array of registration objects:

| Field | Item shape | What it does |
|---|---|---|
| `panels` | `{ id, label, component }` | Register a React component as a panel |
| `commands` | `{ id, title, panelId }` | Add a **Ctrl+K command-palette entry** that opens a panel — ⚠️ this is NOT the `/open-…` slash-command in agent chat; for that, see `pi.registerCommand` below |
| `leftTabs` | `{ id, title, panelId }` | Add a sidebar tab |
| `surfaceResolvers` | `{ id, kind, resolve(request) }` | Map a domain target → panel |
| `providers` / `bindings` / `catalogs` | (rare) | Advanced |
| `setup` | `(api) => void` | Escape hatch — runtime branching, called LAST |

`definePlugin` takes a single declarative config object — the legacy
3-arg `definePlugin("id", factory, opts)` form was removed. To chain
an imperative factory (e.g. when composing with a 3rd-party kit),
call it from the `setup` escape hatch:

```ts
definePlugin({
  id: "my-extended",
  panels: [...],
  setup: (api) => baseKitFactory(api),
})
```

**Names that DO NOT EXIST and will silently fail:**

- ❌ `createPlugin(...)` — use `definePlugin(...)`
- ❌ `defineFrontPlugin(...)` — removed from the public API
- ❌ inside `setup`: `api.registerComponent`, `api.addPanel`, `api.registerCommand` (no `Panel`), `api.registerTab` — use the corresponding `register*` name from the table above
- ❌ in Pi extensions: `defineTool(...)` / `export const tools` — export a default function and call `pi.registerTool({ name, description, parameters: { type: "object", properties: {} }, execute })`. `parameters` is mandatory even for no-arg tools.

## package.json shape

The scaffold writes this. Customize fields but keep the structure:

```jsonc
{
  "name": "<kebab-name>",         // package discovery id; @scope/x becomes scope-x
  "version": "0.1.0",
  "private": true,
  "boring": {
    "label": "<Display Label>",   // shown in panel chrome
    "front": "front/index.tsx"    // path to front factory file
  },
  "pi": {
    "systemPrompt": "<1-2 sentences telling the agent when this plugin is relevant>",
    "extensions": ["agent/index.ts"],  // OPTIONAL — only if you write a Pi extension
    // Declare slash commands statically so the picker shows them on plugin load,
    // before the agent runs. Pair each entry with a pi.registerCommand handler
    // in agent/index.ts.
    "slashCommands": [
      { "name": "open-<kebab-name>", "description": "Open the <Label> panel" }
    ]
  }
}
```

## Plugin-local dependencies

Runtime plugins follow Pi's local extension dependency model. If you need a browser-safe library that is not a host singleton, add it to the plugin package and install from the plugin directory:

```sh
cd "$BORING_AGENT_WORKSPACE_ROOT/.pi/extensions/<kebab-name>"
npm install recharts
# or pnpm add recharts when this plugin already uses pnpm
```

Rules:

- Install dependencies inside `.pi/extensions/<name>/`, never at the workspace root.
- `/reload` does not install missing dependencies; it only reloads already-installed plugin resources.
- After changing dependencies, run `boring-ui-plugin verify <kebab-name> "$BORING_AGENT_WORKSPACE_ROOT"`.
- Do not add host singletons as plugin dependencies: `react`, `react-dom`, `@hachej/boring-workspace`, `@hachej/boring-workspace/plugin`, `@hachej/boring-workspace/events`, or `@hachej/boring-ui-kit`.
- Front code still cannot import Node built-ins (`node:fs`, `node:path`, etc.).

## front/index.tsx canonical shape

```tsx
import React from "react"
import { definePlugin } from "@hachej/boring-workspace/plugin"

function MyPane() {
  return <div style={{ padding: 16 }}>Hello from my-plugin</div>
}

export default definePlugin({
  id: "my-plugin",            // contribution namespace; matching package name is recommended
  label: "My Plugin",
  panels: [
    { id: "my-plugin.panel", label: "My Plugin", component: MyPane },
  ],
  commands: [
    { id: "my-plugin.open", title: "Open My Plugin", panelId: "my-plugin.panel" },
  ],
  // Optional only for persistent sidebar navigation:
  // leftTabs: [{ id: "my-plugin.tab", title: "My Plugin", panelId: "my-plugin.panel" }],
})
```

Notes:

- Package discovery derives an asset id from `package.json#name` (`@scope/name` becomes `scope-name`). `config.id` is the contribution namespace for front outputs. Matching the normalized package id is recommended for fully package-loaded plugins; first-party/static composition may use a shorter namespace.
- Panel/command/tab ids should be `<plugin-id>.<thing>` — convention.
- Import React explicitly (no `globalThis.React`).
- Do NOT use `defineFrontPlugin` or `createPlugin` (don't exist).

## Design-system defaults

Generated plugins should look native to boring-ui, not like isolated demos.
Use `@hachej/boring-ui-kit` for common controls and layout pieces before adding third-party UI libraries:

```tsx
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Toolbar, ToolbarGroup } from "@hachej/boring-ui-kit"
```

Design rules:

- Use boring-ui-kit for buttons, cards, inputs, badges, tabs, toolbars, empty/loading/error states, status badges, separators, and scroll areas.
- Use boring-ui tokens/classes (`bg-background`, `text-foreground`, `border-border`, `text-muted-foreground`, `accent`) instead of hard-coded colors.
- Prefer `className` + Tailwind utilities; avoid inline styles except dynamic sizing/positioning.
- Structure panes as full-height roots with optional toolbar/header and a scrollable body.
- Make every pane horizontally responsive. Pane roots should use `min-w-0 min-h-0`; scroll regions should use `min-w-0 overflow-auto`; grids should collapse with responsive classes such as `grid-cols-1 md:grid-cols-3`.
- Do **not** hard-code large content widths (`width={820}`, `w-[900px]`, fixed SVG/chart width) unless the containing region can scroll intentionally. For charts, prefer library responsive wrappers such as Recharts `ResponsiveContainer` with a `w-full min-w-0` parent.
- Test horizontal resize mentally and/or in the browser: narrow the workbench and confirm content wraps, shrinks, or scrolls instead of being clipped.
- Always include empty/loading/error states for data-driven panes.
- Do not add `@hachej/boring-ui-kit` to plugin dependencies; it is host-provided.
- Only add plugin-local dependencies for specialized libraries (charts, maps, editors, etc.), not for basic controls.
