---
name: boring-plugin-authoring
description: Create, extend, or update boring-ui workspace plugins, including hot-reloadable user plugins, app-default plugins shipped with apps, React panels, file visualizers, surface resolvers, static server integrations, and Pi/agent contributions. Use when the user asks to build, extend, configure, or modify a boring-ui plugin.
---

# Boring Plugin Authoring

## STEP 0 — Always scaffold first

Don't write plugin files from scratch. The CLI scaffold produces a known-correct
`package.json` + `front/index.tsx` skeleton under `.pi/extensions/<name>/`.
**Run it, then read the generated files, then customize.** This guarantees the
file layout, API surface (`definePlugin`, `registerPanel`, etc.), and import
paths are correct — the parts agents most often invent or get wrong.

```sh
# First check whether this runtime supports workspace-local plugin roots.
boring-ui-plugin status --json

# Only run this when workspaceLocalPluginRoots is true. Always target the
# current workspace root. The second arg prevents writing into a parent repo
# if your shell cwd drifts.
boring-ui-plugin scaffold <kebab-name> "$BORING_AGENT_WORKSPACE_ROOT"
```

The workspace agent puts the provisioned Node bin directory on `PATH` (for
local/bwrap this is `/workspace/.boring-agent/node/node_modules/.bin`), provides
the `boring-ui-plugin` command there, and exports `BORING_AGENT_WORKSPACE_ROOT`. Use
`$BORING_AGENT_WORKSPACE_ROOT` instead of host paths such as `/home/...`; in
sandboxed modes the runtime-visible workspace is `/workspace`. Do not `cd` to a
parent repo to scaffold; hot-reloadable user plugins belong under
`$BORING_AGENT_WORKSPACE_ROOT/.pi/extensions/<name>/`. If you are outside the
agent workspace and do not have that binary, use
`npx @hachej/boring-ui-plugin-cli scaffold <kebab-name> <workspace-root>`.

The scaffold writes the canonical hot-reload package skeleton:

- `.pi/extensions/<name>/package.json` — manifest with `boring.front` and `pi.systemPrompt`
- `.pi/extensions/<name>/front/index.tsx` — `definePlugin` config registering one panel + command + left tab
- `.pi/extensions/<name>/.gitignore` — ignores runtime verifier/signature sidecars

**Discovery roots:**

- Workspace-local boring/Pi plugins live under `$BORING_AGENT_WORKSPACE_ROOT/.pi/extensions/<name>/`
- Global Pi plugins live under `~/.pi/agent/extensions/`

**Default to workspace-local.** Never ask the user to choose. Always scaffold into `.pi/extensions/<name>/`. Only use `~/.pi/agent/extensions/` when the user explicitly asks for a globally installed plugin (e.g. "make this a global plugin").

This skill teaches the **workspace-local** authoring path. Before scaffolding or writing `.pi/extensions`, run `boring-ui-plugin status --json`. Only use `.pi/extensions` when `workspaceLocalPluginRoots` is `true`. If it is `false`, do not create a hot-reloadable plugin; explain that this runtime does not support local plugin roots. Do not scaffold directly into the global root unless the user explicitly asks for a globally installed plugin.

Hot-reloadable agent behavior belongs in `pi.extensions` / `pi.skills` / `pi.systemPrompt`. The scaffold does not create `server/index.ts`: `boring.server` is advanced boot-time/static server integration and is not activated by `/reload` for `.pi/extensions` user plugins.

**Workflow:**

1. Run `boring-ui-plugin status --json` via the bash tool and stop if `workspaceLocalPluginRoots` is `false`.
2. Run the scaffold command via the bash tool.
3. Read the generated files with the read tool.
4. Edit them in place with the edit tool — do **NOT** rewrite from scratch.
5. Run `boring-ui-plugin verify <kebab-name> "$BORING_AGENT_WORKSPACE_ROOT"` via bash. Fix anything it reports and re-run until it returns `OK`.
6. If the workspace UI is open, run `boring-ui-plugin test <kebab-name>` via bash. Add `--workspace <id>` in workspaces mode and `--panel-id <id>` if the plugin's main panel is not `<kebab-name>.panel`. Fix render failures and re-run until it returns `OK`. If it reports `NO_BROWSER_CONNECTED`, ask the user to open the workspace UI and rerun.
7. Tell the user to run `/reload` for front/Pi asset changes. If you added `boring.server`, tell the user the workspace process must be statically composed with that package and restarted.

If the scaffold says the plugin already exists, you can read the existing
files directly and skip the scaffold step.

## The API surface — `definePlugin(config)`

`definePlugin` takes a declarative config object. Each `<thing>s` field
is an array of registration objects:

| Field | Item shape | What it does |
|---|---|---|
| `panels` | `{ id, label, component }` | Register a React component as a panel |
| `commands` | `{ id, title, panelId }` | Add a slash-command that opens a panel |
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
- ❌ in Pi extensions: `defineTool(...)` / `export const tools` — export a default function and call `pi.registerTool({ name, description, execute })`

## File layout (do not put files elsewhere)

User-added plugins live under `<workspace>/.pi/extensions/<name>/`. Inside
that directory:

```
.pi/extensions/<name>/
├── package.json          # manifest (boring.front, pi.systemPrompt, pi.extensions)
├── front/index.tsx       # front factory (boring.front)
└── agent/index.ts        # OPTIONAL — Pi extension, declared in pi.extensions
```

For `.pi/extensions/<name>/` plugins (the hot-reload path this skill teaches), do **NOT**:

- Put files at the package root (`index.ts`, `index.js`, `index.tsx` at the
  same level as `package.json`).
- Create `src/`, `dist/`, `lib/`, `build/` subdirectories — there is no
  compile step; the dev server transforms `.tsx` on the fly via Vite.
- Run `npm init`, `npm install`, `tsc`, or any build command inside the
  plugin dir. The scaffold's `package.json` already has `private: true`
  and no scripts.
- Create a `tsconfig.json` or `node_modules/` inside the plugin dir.
- Create a `README.md` unless the user asks for one.

> The above rules apply to the hot-reload layout under `.pi/extensions/<name>/`. Full npm-package plugins under `plugins/<name>/` (intended for publishing — e.g. `@hachej/boring-ask-user`) DO use `src/` + `tsup` + `dist/`. See the "Choosing a layout" section below.

## Choosing a layout: `.pi/extensions/<name>/` vs `plugins/<name>/`

Two valid layouts, picked by intent:

| Where | Build step? | When to use |
|---|---|---|
| `<workspace>/.pi/extensions/<name>/` | NO (Vite transforms `.tsx` on the fly, hot reload via SSE) | Workspace-local user plugins; agent-authored plugins; anything tied to one workspace. **Default for "I want a plugin".** |
| `plugins/<name>/` (in this repo) | YES (`tsup` → `dist/`, then consuming app does `defaultPluginPackages: ["@hachej/your-plugin"]`) | Plugins shipped as installable npm packages (e.g. `@hachej/boring-ask-user`, `@hachej/boring-data-catalog`). |

Global user-installed plugins are a third case: they are **discovered** from `~/.pi/agent/extensions/`, but this skill still recommends authoring/testing them in a workspace-local `.pi/extensions/<name>/` first, then copying/installing them globally once they work.

The rest of this skill teaches the hot-reload layout. Repo contributors building a publishable plugin start from `packages/cli/templates/plugin/` (build-based template) instead; everyone else uses `boring-ui-plugin scaffold <name>` (Step 0).

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
- Do not add `leftTabs` by default. A left tab is permanent sidebar navigation; use it only for catalogs or always-on tools. File visualizers should open through `surfaceResolvers`, not create sidebar tabs.
- Import React explicitly (no `globalThis.React`).
- Do NOT use `defineFrontPlugin` or `createPlugin` (don't exist).

## Common patterns

### Workspace links (open files, surfaces, and panels without routes)

Use `WorkspaceLink` when rows/cards should open workspace targets. It renders an
anchor for normal link affordance, but unmodified left-click dispatches through
`postUiCommand` on the existing frontend command bus. Do **not** add backend
routes or set `window.location` for in-workspace navigation.

```tsx
import React from "react"
import { WorkspaceLink } from "@hachej/boring-workspace"

function Row() {
  return (
    <div>
      <WorkspaceLink to={{ kind: "openFile", path: "README.md" }}>
        Open README
      </WorkspaceLink>

      <WorkspaceLink
        to={{ kind: "openSurface", surfaceKind: "niche", target: "climate-tools" }}
      >
        Open niche detail
      </WorkspaceLink>
    </div>
  )
}
```

Supported targets:

```ts
{ kind: "openFile", path: "README.md" }
{ kind: "openSurface", surfaceKind: "my-surface", target: "record-id", meta?: {...} }
{ kind: "openPanel", id: "my-panel:record-id", component: "my-plugin.panel", title?: "Title", params?: {...} }
{ kind: "expandToFile", path: "src/index.ts" }
```

Important details:

- Prefer `openSurface` for domain records. Register a `surfaceResolver` for the
  same `surfaceKind`; let the resolver choose the panel id/component/params.
- Use `openPanel` only when you already know the registered panel component id.
  It needs both `id` (panel instance id) and `component` (registered panel id).
- Do **not** use `navigateToLine` yet. The current workspace dispatcher accepts
  that command as a no-op, so a helper exposing it would be a false promise.
- `WorkspaceLink` does not replace file visualizers. File visualizers still use
  `surfaceResolvers`; links are just the clickable way to request opens.

### File visualizer (opens files in your panel)

Use `WORKSPACE_OPEN_PATH_SURFACE_KIND` so the workspace routes file-open
requests through your resolver:

```tsx
import React, { useState, useEffect } from "react"
import { definePlugin, WORKSPACE_OPEN_PATH_SURFACE_KIND, type PaneProps } from "@hachej/boring-workspace/plugin"
import { useApiBaseUrl, useWorkspaceRequestId } from "@hachej/boring-workspace"

function CsvPane({ params }: PaneProps<{ path: string }>) {
  const apiBaseUrl = useApiBaseUrl()
  const workspaceRequestId = useWorkspaceRequestId()
  const [text, setText] = useState("")
  useEffect(() => {
    const base = apiBaseUrl.replace(/\/$/, "")
    const headers: Record<string, string> = {}
    if (workspaceRequestId) headers["x-boring-workspace-id"] = workspaceRequestId
    fetch(`${base}/api/v1/files/raw?path=${encodeURIComponent(params.path)}`, {
      credentials: "include",
      headers,
    })
      .then((r) => r.text())
      .then(setText)
  }, [apiBaseUrl, params.path, workspaceRequestId])
  return <pre>{text}</pre>
}

export default definePlugin({
  id: "csv-viz",
  label: "CSV Viewer",
  panels: [
    { id: "csv-viz.panel", label: "CSV", component: CsvPane },
  ],
  surfaceResolvers: [
    {
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
    },
  ],
})
```

Read raw file bytes from `/api/v1/files/raw?path=<workspace-relative-path>`.
Inside panels, build the URL with `useApiBaseUrl()` and pass
`x-boring-workspace-id` from `useWorkspaceRequestId()` when present; CLI
workspaces mode requires that workspace scope. Use the imported
`WORKSPACE_OPEN_PATH_SURFACE_KIND` constant as the resolver `kind` (not the
string `"WORKSPACE_OPEN_PATH_SURFACE_KIND"`), and read the path from
`request.target` (not `request.path`). Do not use `/workspace/read`.
For charts, use plain SVG (`<rect>`, `<line>`, `<polyline>`) — do not add
recharts / chart.js dependencies.

### Hot-reloadable agent behavior: Pi extension

For `.pi/extensions/<name>/` user plugins, agent tools belong in Pi extensions,
not `boring.server`. Create `.pi/extensions/<name>/agent/index.ts` and declare
it in `package.json#pi.extensions: ["agent/index.ts"]`. `/reload` refreshes this
Pi code for subsequent agent turns.

```ts
// agent/index.ts — native Pi extension
export default function extension(api: { registerTool(tool: unknown): void }) {
  api.registerTool({
    name: "my_tool",
    description: "What this tool does.",
    parameters: { type: "object", properties: {} },
    async execute() {
      return { content: [{ type: "text", text: "ok" }] }
    },
  })
}
```

Also add or update `pi.systemPrompt` / `pi.skills` so the agent knows when to use
the tool.

### Advanced static server integration (not hot-reloadable for .pi/extensions)

`boring.server: "server/index.ts"` is only for workspace server integrations
that the host composes at boot (for example through `defaultPluginPackages` or
explicit server plugins) and activates by restarting the process. `boring-ui-plugin verify`
checks that the declared file is safe and present, but `/reload`
does **not** import/register `.pi/extensions` server routes or agent tools.

Only use this path when the user/host explicitly wants boot-time server routes or
static `agentTools` and can restart:

```ts
// server/index.ts — static WorkspaceServerPlugin factory
import { defineServerPlugin, type WorkspaceServerPlugin } from "@hachej/boring-workspace/server"

export default function (
  _options: unknown,
  ctx: { workspaceRoot: string; bridge: unknown },
): WorkspaceServerPlugin {
  return defineServerPlugin({
    id: "my-plugin",
    routes: async (app) => {
      app.get("/my-plugin/status", async () => ({ ok: true, root: ctx.workspaceRoot }))
    },
  })
}
```

### Extending an existing plugin (no `composePlugins` helper)

Composition is JS-native — spread + concat. Plugins that export their
config object can be extended directly:

```ts
import { definePlugin } from "@hachej/boring-workspace/plugin"
import { baseDataCatalogConfig } from "@hachej/boring-data-catalog"

export default definePlugin({
  ...baseDataCatalogConfig({ adapter: myAdapter }),
  id: "my-extended",
  commands: [
    ...baseDataCatalogConfig({ adapter: myAdapter }).commands,
    { id: "my-extended.export", title: "Export to CSV", panelId: "my-extended-panel" },
  ],
})
```

If a base plugin only exposes a factory (`(api) => void`), use the
`setup` escape hatch to call it:

```ts
import { definePlugin } from "@hachej/boring-workspace/plugin"
import { createDataCatalogPlugin } from "@hachej/boring-data-catalog"

const baseFactory = createDataCatalogPlugin({ adapter: myAdapter })

export default definePlugin({
  id: "my-extended",
  commands: [
    { id: "my-extended.export", title: "Export to CSV", panelId: "my-extended-panel" },
  ],
  setup: (api) => baseFactory(api),   // runs after declarative registrations
})
```

For component reuse (e.g. `@hachej/boring-data-explorer` exports React
components), just import and render them inside your panel:

```tsx
import { DataExplorer } from "@hachej/boring-data-explorer/front"

definePlugin({
  id: "my-thing",
  panels: [
    { id: "my-thing.panel", label: "My Thing", component: () => <DataExplorer adapter={myAdapter} /> },
  ],
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

The app's front-end (`apps/<app>/src/front/App.tsx`) usually does **not** also
list these in `WorkspaceProvider.plugins` — panel/command/catalog package fronts
arrive via SSE like `.pi/extensions/<name>/` plugin fronts. Exception: plugins
that register `providers` or `bindings` need static front composition for now
(import the plugin's front export and pass it in `plugins={[...]}`) because
dynamic provider/binding hot-load is intentionally unsupported. Server entries
from package plugins are boot-time/static: changing `boring.server` code requires
restarting the workspace process.

## After editing — tell the user to /reload

Hot reload is driven by the user (via `/reload`), not by the agent and not by
Vite HMR. After front or Pi edits, end your message with a line telling the user
to run `/reload`. The workspace then re-scans `.pi/extensions/` and refreshes
front assets plus Pi extensions/skills/prompts. If you changed `boring.server`,
say that `/reload` is not enough: the host must statically compose that server
entry and restart the workspace process.

If the user reports a page reload, `Invalid hook call`, or
`resolveDispatcher() is null` after editing a plugin, suspect host Vite config
first: `.pi/extensions` files must be excluded from React Refresh and ignored by
Vite HMR so the `/reload` bridge owns runtime plugin updates.

## More detail

When patterns above don't cover your case, read:

- [Plugin authoring reference](../../references/workspace/plugins.md) —
  full package shape, conventions, hot-reload internals.
- [Panel/front API reference](../../references/workspace/panels.md) —
  `PaneProps`, parameter updates, left tabs, layout API.
- [Agent/UI bridge reference](../../references/workspace/bridge.md) — UI
  bridge commands and state.
