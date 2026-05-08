# Boring UI Plugin System

Read this before creating or updating a boring-ui plugin.

## Universal plugin layout

A plugin root can contain these layers:

```
<plugin-root>/
  package.json
  agent/index.ts       # native pi ExtensionFactory; tools, skills, prompts
  agent/skills/*.md    # pi-native skills
  agent/prompts/*.md   # pi-native prompt templates
  front/index.tsx      # BoringFrontFactory; panels, tabs, resolvers
  server/index.ts      # trusted Fastify/server hooks, routes only
  server/template/     # files copied into workspaces
  sdk/                 # language SDK or CLI assets
  shared/              # platform-neutral constants/types
```

## package.json

```json
{
  "pi": { "extensions": ["./agent/index.ts"] },
  "boring": {
    "front": "./front/index.tsx",
    "server": "./server/index.ts",
    "label": "My Plugin",
    "panels": [{ "id": "my-panel", "title": "My Panel" }],
    "surfaceResolvers": [
      { "id": "my-open", "surfaceKind": "my.open", "panelId": "my-panel" }
    ]
  }
}
```

- `pi.extensions` is loaded by pi through `additionalExtensionPaths`; do not pass imported factories for hot reload.
- `boring.front` points at the browser factory loaded by boring-ui.
- `boring.server` is optional. Omit it to use `server/index.{ts,js}` by convention, set a safe relative path for a custom dynamic server factory, or set `false` when the plugin has static host-composed Fastify routes that are not compatible with the dynamic exact-route API yet.

## front/index.tsx

Export a default `BoringFrontFactory` from `@boring/workspace/plugin`:

```tsx
import type { BoringFrontFactory } from "@boring/workspace/plugin"

function MyPanel() {
  return <div>Hello from my plugin</div>
}

const front: BoringFrontFactory = (api) => {
  api.registerPanel({ id: "my-panel", label: "My Panel", component: MyPanel })
  api.registerLeftTab({ id: "my-tab", title: "My Plugin", panelId: "my-panel", component: MyPanel })
  api.registerSurfaceResolver({
    kind: "my.open",
    resolve: (request) => ({ component: "my-panel", id: `my:${request.target}` }),
  })
}

export default front
```

## agent/index.ts

Export a default pi `ExtensionFactory`:

```ts
import { defineTool, type ExtensionFactory } from "@mariozechner/pi-coding-agent"
import { Type } from "@sinclair/typebox"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const __dir = dirname(fileURLToPath(import.meta.url))

const extension: ExtensionFactory = (pi) => {
  pi.on("resources_discover", () => ({
    skillPaths: [join(__dir, "skills")],
    promptPaths: [join(__dir, "prompts")],
  }))

  pi.registerTool(defineTool({
    name: "my_tool",
    label: "My Tool",
    description: "Do useful plugin work",
    parameters: Type.Object({ input: Type.String() }),
    async execute(_id, { input }) {
      if (!input.trim()) throw new Error("input is required")
      return { content: [{ type: "text", text: input }], details: undefined }
    },
  }))
}

export default extension
```

Throw errors from pi tools. Do not return `{ isError: true }` from native pi tools.

## Reload workflow

After creating or editing a plugin, ask the user to run `/reload` in chat. The command calls `POST /api/v1/agent/reload`, which calls `piSession.reload()`. Pi then re-runs jiti over every `additionalExtensionPaths` entry, so changed `agent/index.ts` files are loaded fresh.

When full boring-ui asset reload is available, `/boring.reload` will also refresh front/server assets through SSE. Until then, `/reload` covers agent tools, skills, and prompts.

## Rules

- For hot reload, pass file paths into pi (`additionalExtensionPaths`), not imported in-process functions.
- Browser/front code must not import Node-only modules.
- Server code may use Node APIs.
- Shared code must remain platform-neutral.
- Keep package-neutral workspace front/shared code free of value imports from `@boring/agent`.
