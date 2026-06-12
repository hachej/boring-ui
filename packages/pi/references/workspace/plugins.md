> boring-ui can create plugins. Ask it to build one for your use case.

# Plugins

Plugins are package directories with `package.json` metadata. One package can contribute to two runtimes:

- `package.json#boring` — workspace/UI discovery: label plus front entrypoint, and optional advanced static server entrypoint.
- `package.json#pi` — hot-reloadable agent/Pi assets: native Pi extensions, skills, Pi packages, short prompt context.

## Where to put hot-reloadable plugins

In a live workspace, hot-reloadable package plugins are discovered under:

```txt
.pi/extensions/<plugin-name>/
```

Create the directory if it does not exist. Do **not** put new live plugins at the workspace root (`./<plugin-name>/`); `/reload` will not discover them there. The `.boring/` and `.boring/plugins/` directories are not scan roots today.

## Minimal package

```jsonc
{
  "name": "@hachej/boring-plugin-widget",
  "version": "1.0.0",
  "boring": {
    "label": "Widget",
    "front": "front/index.tsx"
  },
  "pi": {
    "extensions": ["agent/index.ts"],
    "skills": ["agent/skills"],
    "systemPrompt": "Use the widget UI when the user asks for widget details."
  }
}
```

Package discovery derives an asset id from `package.json#name` (`@scope/name` becomes `scope-name`). There is no separate `boring.id` field. The `definePlugin({ id })` / `defineServerPlugin({ id })` value is a contribution namespace for panels, commands, routes, diagnostics, and ownership. Matching the normalized package id is recommended for fully package-loaded plugins; first-party/static composition may use a shorter namespace when the host owns that mapping.

`boring` does not register panels, commands, left tabs, or surface resolvers. Those runtime UI contributions are registered by the `BoringFrontFactory` exported from `boring.front`. Agent-facing context belongs under `pi.systemPrompt` or, preferably for larger docs, `pi.skills`.

## Front entry

`boring.front` default-exports a `BoringFrontFactoryWithId` (produced by
`definePlugin`):

```tsx
import { definePlugin } from "@hachej/boring-workspace/plugin"

export default definePlugin({
  id: "widget",
  label: "Widget",
  panels: [
    {
      id: "widget-panel",
      label: "Widget",
      component: () => import("./WidgetPane"),
    },
  ],
  commands: [
    {
      id: "open-widget",
      title: "Open widget",
      panelId: "widget-panel",
    },
  ],
})
```

`definePlugin({ id, label?, panels?, commands?, setup? })` returns a
`BoringFrontFactoryWithId` — a function with `pluginId`/`pluginLabel` static
fields. The shell auto-wraps it. The bare `BoringFrontFactory = (api) => void | Promise<void>`
type still exists for host/hot-load internals; consumers should always use `definePlugin`. The `definePlugin({ setup })` escape hatch is synchronous for static provider bootstrap.

Front code is browser code. Do not import Node-only modules and do not define
agent tools in front plugins. Hot-loaded package fronts currently support panels,
commands, catalogs, left tabs, and surface resolvers; plugins that register
providers or bindings must be statically imported by the host app and passed via
`WorkspaceProvider.plugins` / `WorkspaceAgentFront.plugins` for now. Use object-shaped registrations such as
`api.registerPanel({ id, label, component })` and `api.registerSurfaceResolver({
id, kind, resolve })`. Use `registerPanelCommand`, not `registerCommand`,
inside the factory. Hot-loaded panels are normal React function components;
hooks such as `useState` and `useEffect` are supported when the Vite host
aliases/dedupes React to the workspace shell singleton. Keep generated
hot-reload examples dependency-light: only import packages already resolvable
from the host app, and prefer plain React/SVG/CSS for quick visualizers instead
of adding new charting libraries.

## File visualizers

To replace the built-in viewer for files, register a panel plus a
`workspace.open.path` surface resolver:

```tsx
import { definePlugin, WORKSPACE_OPEN_PATH_SURFACE_KIND, type PaneProps } from "@hachej/boring-workspace/plugin"
import { useApiBaseUrl, useWorkspaceRequestId } from "@hachej/boring-workspace"

function CsvPanel({ params }: PaneProps<{ path?: string }>) {
  const apiBaseUrl = useApiBaseUrl()
  const workspaceRequestId = useWorkspaceRequestId()
  // Browser panels fetch raw workspace file contents from:
  // `${apiBaseUrl}/api/v1/files/raw?path=<workspace-relative-path>`
  // Include `x-boring-workspace-id: workspaceRequestId` when present.
  return <div>{params?.path}</div>
}

export default definePlugin({
  id: "csv-viz",
  label: "CSV Viz",
  panels: [{ id: "csv-viz", label: "CSV Viz", component: CsvPanel }],
  surfaceResolvers: [
    {
      id: "csv-viz-open-path",
      kind: WORKSPACE_OPEN_PATH_SURFACE_KIND,
      resolve(request) {
        if (!request.target.toLowerCase().endsWith(".csv")) return undefined
        return {
          id: `csv-viz:${request.target}`,
          component: "csv-viz",
          title: request.target.split("/").pop() ?? request.target,
          params: { path: request.target },
          score: 100,
        }
      },
    },
  ],
})
```

Use `/api/v1/files/raw` for raw text/blob bytes. Build the URL with
`useApiBaseUrl()` and pass `x-boring-workspace-id` from
`useWorkspaceRequestId()` when present; CLI workspaces mode requires that
workspace scope. `/api/v1/files` returns the workspace file JSON shape used by
the built-in editor, and `/api/v1/fs/file` is not a workspace endpoint.

## Server entry (advanced static composition only)

Hot-reloadable `.pi/extensions` user plugins should put agent behavior in
`pi.extensions`, `pi.skills`, and `pi.systemPrompt`. `boring.server` is for
workspace server integrations that the host composes at boot (for example via
`defaultPluginPackages` or explicit server plugins) and activates by restarting
the process. `/reload` verifies and refreshes front/Pi assets; it does not import
or register `.pi/extensions` server routes or agent tools.

When a host intentionally statically composes the package, `boring.server` may point at a workspace/UI support route module:

```ts
import { defineServerPlugin, type WorkspaceServerPlugin } from "@hachej/boring-workspace/server"

export default function (_options: unknown, ctx: { workspaceRoot: string }): WorkspaceServerPlugin {
  return defineServerPlugin({
    id: "widget",
    routes: async (app) => {
      app.get("/health", async () => ({ ok: true, root: ctx.workspaceRoot }))
    },
  })
}
```

Hot-reloadable agent tools, skills, and prompt additions belong under `pi`, not `boring.server`.

## Pi entry

`pi.extensions` points at native Pi extension factories:

```ts
export default function extension(api: { registerTool(tool: unknown): void }) {
  api.registerTool({
    name: "widget_lookup",
    description: "Look up widget data.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute() {
      return { content: [{ type: "text", text: "widget data" }] }
    },
  })
}
```

## Chat slash commands

Pi resources double as chat `/slash` commands: extensions, prompts, and skills
shipped in `package.json#pi` appear automatically in the chat composer's
slash-command picker, tagged with their source (`extension`/`prompt`/`skill`)
and plugin name. `kind: skill` commands are forwarded to the agent as
`skill: <name>`; server commands execute via the agent's commands route without
going through the chat loop. No harness changes are needed — shipping the Pi
resource is enough.

## Folder layout

```txt
my-plugin/
  package.json         # boring + pi metadata
  front/index.tsx      # BoringFrontFactory
  server/index.ts      # advanced static WorkspaceServerPlugin; requires host composition + restart
  agent/index.ts       # optional native Pi extension; hot-reloadable through pi.extensions
  agent/skills/        # optional Pi skills
  shared/constants.ts  # platform-neutral constants
```

## Hot front asset scope

Hot-loaded front plugins currently use the Vite dev server's `/@fs/` module
transform path. `WorkspaceProvider` therefore defaults front plugin hot-reload to
`frontPluginHotReload="vite"` only in dev and `false` in production. Apps that
consume built `@hachej/boring-workspace` dist for a dev playground should pass
`frontPluginHotReload="vite"` explicitly; the dist bundle cannot infer the host
app's dev mode reliably.

Vite hosts must keep React singleton-safe for hook panels, e.g.
`resolve.dedupe` includes `react` and `react-dom`, and aliases cover `react`,
`react-dom`, `react-dom/client`, `react/jsx-runtime`, and
`react/jsx-dev-runtime` to the host app's `node_modules`.

Runtime plugin files under `.pi/extensions` are **not** normal Vite HMR
boundaries. The host should suppress Vite HMR for those files and exclude them
from React Refresh instrumentation; `/reload` is the update boundary. Without
that, edits can full-page reload or leave a stale React hook dispatcher and
surface `Invalid hook call` / `resolveDispatcher() is null` even for valid
function components.

Production Fastify-only hosts need a workspace-owned module asset endpoint
before loading TS/TSX front plugin entries without Vite.

Runtime front assets and dynamic `pi.*` snapshots refresh through the canonical
`/reload` path. Workspace server entries remain boot-time/static composition:
restart the host process after changing `boring.server` code.

## Invariants

```bash
pnpm --filter @hachej/boring-workspace run lint:plugin-invariants
```

Rejects cross-layer imports, legacy file names, and plugin-domain imports from workspace chrome.
