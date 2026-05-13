> boring-ui can create plugins. Ask it to build one for your use case.

# Plugins

Plugins are package directories with `package.json` metadata. One package can contribute to two runtimes:

- `package.json#boring` — workspace/UI discovery: label plus front and support-server entrypoints.
- `package.json#pi` — agent/Pi assets: native Pi extensions, skills, Pi packages, short prompt context.

## Minimal package

```jsonc
{
  "name": "@hachej/boring-plugin-widget",
  "version": "1.0.0",
  "boring": {
    "label": "Widget",
    "front": "front/index.tsx",
    "server": "server/index.ts"
  },
  "pi": {
    "extensions": ["agent/index.ts"],
    "skills": ["agent/skills"],
    "systemPrompt": "Use the widget UI when the user asks for widget details."
  }
}
```

The plugin id is `package.json#name` (`@scope/name` becomes `scope-name`). There is no separate `boring.id` field.

`boring` does not register panels, commands, left tabs, or surface resolvers. Those runtime UI contributions are registered by the `BoringFrontFactory` exported from `boring.front`. Agent-facing context belongs under `pi.systemPrompt` or, preferably for larger docs, `pi.skills`.

## Front entry

`boring.front` default-exports a `BoringFrontFactory`:

```tsx
import type { BoringFrontFactory } from "@hachej/boring-workspace/plugin"

const plugin: BoringFrontFactory = (api) => {
  api.registerPanel({
    id: "widget-panel",
    label: "Widget",
    component: () => import("./WidgetPane"),
  })
  api.registerPanelCommand({
    id: "open-widget",
    title: "Open widget",
    panelId: "widget-panel",
  })
}

export default plugin
```

## Server entry

`boring.server` is for workspace/UI support routes only:

```ts
import type { BoringServerFactory } from "@hachej/boring-workspace/server"

const server: BoringServerFactory = (api) => {
  api.get("/health", async () => ({ ok: true }))
}

export default server
```

Agent tools, skills, and prompt additions belong under `pi`, not `boring.server`.

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

## Folder layout

```txt
my-plugin/
  package.json         # boring + pi metadata
  front/index.tsx      # BoringFrontFactory
  server/index.ts      # optional BoringServerFactory for UI support routes
  agent/index.ts       # optional native Pi extension
  agent/skills/        # optional Pi skills
  shared/constants.ts  # platform-neutral constants
```

## Hot front asset scope

Hot-loaded front plugins currently use the Vite dev server's `/@fs/` module
transform path. `WorkspaceProvider` therefore defaults front plugin hot-reload to
`frontPluginHotReload="vite"` only in dev and `false` in production. Production
Fastify-only hosts need a workspace-owned module asset endpoint before loading
TS/TSX front plugin entries without Vite.

Server-side reload is separately switchable in `createWorkspaceAgentServer`:

```ts
createWorkspaceAgentServer({
  boringPluginReload: true, // /reload refreshes Boring UI/server package assets
  piPluginReload: true,      // package.json#pi contributions are forwarded/refreshed
})
```

Set either to `false` to keep that side static/disabled while preserving explicit
host-supplied plugin options.

## Invariants

```bash
pnpm --filter @hachej/boring-workspace run lint:plugin-invariants
```

Rejects cross-layer imports, legacy file names, and plugin-domain imports from workspace chrome.
