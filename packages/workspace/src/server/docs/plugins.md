# Boring UI Plugin System

Read this before creating or updating a boring-ui plugin.

## Discovery location

In a live workspace, hot-reloadable package plugins are discovered under:

```txt
.pi/extensions/<plugin-name>/
```

Create that directory if it does not exist. Do **not** create live plugins at
`./<plugin-name>/`; `/reload` will not discover them there. `.boring/` and
`.boring/plugins/` are not scan roots today.

## Universal plugin layout

```txt
<plugin-root>/
  package.json
  front/index.tsx      # BoringFrontFactory; panels, tabs, resolvers
  agent/index.ts       # optional native Pi ExtensionFactory
  agent/skills/*.md    # optional Pi-native skills
  server/index.ts      # optional trusted workspace/UI support routes
  shared/              # optional platform-neutral constants/types
```

## package.json

`package.json#boring` is workspace/UI discovery metadata only. Runtime UI
registration happens in `front/index.tsx`.

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "boring": {
    "label": "My Plugin",
    "front": "front/index.tsx",
    "server": "server/index.ts"
  },
  "pi": {
    "extensions": ["agent/index.ts"],
    "skills": ["agent/skills"],
    "systemPrompt": "Use my-plugin tools when the task needs my data."
  }
}
```

Rules:

- The runtime plugin id is `package.json#name` (`@scope/name` becomes
  `scope-name`). There is no separate `boring.id` field.
- `boring.front` and `boring.server` are safe relative paths. `server` may be
  `false` to opt out.
- `boring` must not declare panels, commands, tabs, resolvers, tools, or prompt
  text.
- `pi` owns agent/Pi assets: extensions, skills, packages, and prompt context.

## front/index.tsx

Export a default `BoringFrontFactory`. This is the single runtime UI
registration source:

```tsx
import type { BoringFrontFactory } from "@hachej/boring-workspace/plugin"

function MyPanel() {
  return <div>Hello from my plugin</div>
}

const front: BoringFrontFactory = (api) => {
  api.registerPanel({ id: "my-panel", label: "My Panel", component: MyPanel })
  api.registerPanelCommand({ id: "my-open", title: "Open My Plugin", panelId: "my-panel" })
  api.registerLeftTab({ id: "my-tab", title: "My Plugin", panelId: "my-panel" })
  api.registerSurfaceResolver({
    id: "my-open-surface",
    kind: "my.open",
    resolve: (request) => ({
      id: `my:${request.target}`,
      component: "my-panel",
      params: { target: request.target },
    }),
  })
}

export default front
```

Front code is browser code. Do not import Node-only modules and do not define
agent tools in front plugins. `BoringFrontFactory` is a function type, not a
class; do not construct it with `new`. Use object-shaped registrations such as
`api.registerPanel({ id, label, component })` and `api.registerSurfaceResolver({
id, kind, resolve })`. Use `registerPanelCommand`, not `registerCommand`, inside
`BoringFrontFactory`. Hot-loaded panels are normal React function components;
hooks such as `useState` and `useEffect` are supported when the Vite host
aliases/dedupes React to the workspace shell singleton. Keep generated
hot-reload examples dependency-light: only import packages already resolvable
from the host app, and prefer plain React/SVG/CSS for quick visualizers instead
of adding new charting libraries.

## File visualizers

To replace the built-in viewer for files, register a panel plus a
`workspace.open.path` surface resolver:

```tsx
import { WORKSPACE_OPEN_PATH_SURFACE_KIND, type PaneProps } from "@hachej/boring-workspace"
import type { BoringFrontFactory } from "@hachej/boring-workspace/plugin"

function CsvPanel({ params }: PaneProps<{ path?: string }>) {
  // Browser panels can fetch raw workspace file contents from:
  // GET /api/v1/files/raw?path=<workspace-relative-path>
  return <div>{params?.path}</div>
}

const plugin: BoringFrontFactory = (api) => {
  api.registerPanel({ id: "csv-viz", label: "CSV Viz", component: CsvPanel })
  api.registerSurfaceResolver({
    id: "csv-viz-open-path",
    kind: WORKSPACE_OPEN_PATH_SURFACE_KIND,
    resolve(request) {
      if (request.kind !== WORKSPACE_OPEN_PATH_SURFACE_KIND) return undefined
      if (!request.target.toLowerCase().endsWith(".csv")) return undefined
      return {
        id: `csv-viz:${request.target}`,
        component: "csv-viz",
        title: request.target.split("/").pop() ?? request.target,
        params: { path: request.target },
        score: 100,
      }
    },
  })
}
```

Use `/api/v1/files/raw` for raw text/blob bytes. `/api/v1/files` returns the
workspace file JSON shape used by the built-in editor, and `/api/v1/fs/file` is
not a workspace endpoint.

## agent/index.ts

Export a default Pi extension factory for agent tools, skills, prompts, and
resources:

```ts
import { defineTool, type ExtensionFactory } from "@mariozechner/pi-coding-agent"
import { Type } from "@sinclair/typebox"

const extension: ExtensionFactory = (pi) => {
  pi.registerTool(defineTool({
    name: "my_tool",
    label: "My Tool",
    description: "Do useful plugin work",
    parameters: Type.Object({ input: Type.String() }),
    async execute(_id, { input }) {
      return { content: [{ type: "text", text: input }], details: undefined }
    },
  }))
}

export default extension
```

## server/index.ts

`boring.server` is for trusted workspace/UI support routes only. Agent tools and
agent prompt additions belong under `pi`.

## Reload workflow

After creating or editing a plugin, run `/reload` in chat. The command calls
`POST /api/v1/agent/reload`, the active harness reloads the agent session, and
the workspace reload hook refreshes Boring plugin assets.

Successful reloads emit `boring.plugin.load` / `boring.plugin.unload` SSE
events. Metadata or server entry errors emit `boring.plugin.error`, write a
`.error` file, and keep the last good UI/server route handlers alive.

## Current front asset scope

Hot-loaded front entries currently use Vite `/@fs/` module URLs. This is a
development/workspace-dev-server feature and is gated by
`WorkspaceProvider frontPluginHotReload="vite"` (dev default, production false).
Vite hosts must keep React singleton-safe for hook panels, e.g.
`resolve.dedupe` includes `react` and `react-dom`, and aliases cover `react`,
`react-dom`, `react-dom/client`, `react/jsx-runtime`, and
`react/jsx-dev-runtime` to the host app's `node_modules`. Production
Fastify-only front plugin loading needs a workspace-owned authenticated module
asset endpoint/bundler.

Server-side reload is switchable in `createWorkspaceAgentServer` via a
single flag (defaults to `true`):

```ts
createWorkspaceAgentServer({
  pluginHotReload: true, // /reload re-scans plugin dirs, jiti re-imports
                         // server entries, and refreshes Pi resources
                         // (systemPromptDynamic + getDynamicResources).
})
```

Set to `false` to disable reload-time scan + Pi refresh while preserving
explicit host-supplied plugin options (initial discovery still runs).

## Rules

- For hot reload, pass file paths into Pi (`pi.extensions`), not imported
  in-process extension functions.
- Browser/front code must not import Node-only modules.
- Server code may use Node APIs.
- Shared code must remain platform-neutral.
- Keep package-neutral workspace front/shared code free of value imports from
  `@hachej/boring-agent`.
