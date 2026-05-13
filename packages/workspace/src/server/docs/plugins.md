# Boring UI Plugin System

Read this before creating or updating a boring-ui plugin.

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
  api.registerPanel({ id: "my-panel", title: "My Panel", component: MyPanel })
  api.registerLeftTab({ id: "my-tab", title: "My Plugin", component: MyPanel })
  api.registerCommand({ id: "my-open", title: "Open My Plugin", run: () => {} })
  api.registerSurfaceResolver({
    id: "my-open-surface",
    resolve: () => ({ component: "my-panel" }),
  })
}

export default front
```

Front code is browser code. Do not import Node-only modules and do not define
agent tools in front plugins.

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
Production Fastify-only front plugin loading needs a workspace-owned
authenticated module asset endpoint/bundler.

Server-side reload is separately switchable in `createWorkspaceAgentServer`:

```ts
createWorkspaceAgentServer({
  boringPluginReload: true, // /reload refreshes Boring UI/server package assets
  piPluginReload: true,      // package.json#pi contributions are forwarded/refreshed
})
```

Set either to `false` to keep that side static/disabled while preserving explicit
host-supplied plugin options.

## Rules

- For hot reload, pass file paths into Pi (`pi.extensions`), not imported
  in-process extension functions.
- Browser/front code must not import Node-only modules.
- Server code may use Node APIs.
- Shared code must remain platform-neutral.
- Keep package-neutral workspace front/shared code free of value imports from
  `@hachej/boring-agent`.
