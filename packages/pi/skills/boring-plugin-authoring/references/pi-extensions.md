# Pi extensions & extending existing plugins

## Hot-reloadable agent behavior: Pi extension

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

## Extending an existing plugin (no `composePlugins` helper)

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
