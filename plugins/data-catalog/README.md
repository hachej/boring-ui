# @hachej/boring-data-catalog

A configurable data-catalog plugin **builder** for the workbench. One call to
`createDataCatalogPlugin(options)` binds your `ExplorerDataSource` adapter and
returns a configured front plugin that contributes a workspace page, a
visualization panel, a catalog entry, and a surface resolver. Built on
[`@hachej/boring-data-explorer`](../data-explorer/README.md).

## What it does

- Adds a workspace page listing rows from your adapter, with search + facets.
- Opens a shared Dockview "visualization" panel when a row is activated (default panel
  shows another explorer scoped to the row; swap in your own component).
- Lets the agent search the catalog and open a specific row in a panel.

## What it contributes to the workspace

`createDataCatalogPlugin()` returns one front plugin with up to four
contributions, each opt-out via an `include*` flag:

| Contribution | What | Flag (default) |
|--------------|------|----------------|
| Workspace page | searchable, faceted row list | `includeWorkspacePage` (true) |
| Visualization panel | shared Dockview panel for the selected row | `includeVisualizationPanel` (true) |
| Catalog | command-palette-searchable catalog entry | `includeCatalog` (true) |
| Surface resolver | maps `openSurface` → opens the panel | `includeSurfaceResolver` (true if panel on and no custom `onSelect`) |

The server plugin (`createDataCatalogServerPlugin`) contributes an agent tool
(default name **`query_data_catalog`**) plus a system-prompt snippet.

## How it's wired

This package has **no default export** and requires `options`, so it is **not**
a direct `defaultPluginPackages` entry. Wrap it in an app-local module that
default-exports the built factory, then list that wrapper.

**Front:**

```ts
import { createDataCatalogPlugin } from "@hachej/boring-data-catalog/front"
import type { ExplorerDataSource } from "@hachej/boring-data-explorer/shared"

const adapter: ExplorerDataSource = { async search(args) { /* ... */ } }

const catalogPlugin = createDataCatalogPlugin({
  id: "customers",
  label: "Customers",
  adapter,
  facets: [{ key: "region", label: "Region", order: ["US", "EU", "APAC"] }],
  groupBy: "region",
})
// <WorkspaceProvider plugins={[catalogPlugin, ...]}>
```

**Server:**

```ts
import { createDataCatalogServerPlugin } from "@hachej/boring-data-catalog/server"

const catalogServer = createDataCatalogServerPlugin({
  label: "Customers",
  adapter,           // same ExplorerDataSource as the front
  defaultLimit: 20,  // optional (default 20)
  maxLimit: 50,      // optional (default 50)
})
```

The agent searches via the tool, then opens a row through the UI bridge:

```ts
openSurface({
  kind: "data-catalog.open-row",   // DATA_CATALOG_ROW_SURFACE_KIND
  target: row.id,
  meta: { catalogId: "customers", row },
})
```

## Configuration

`createDataCatalogPlugin(options)` — only `adapter` is required. Key options:

- `id`, `label`, `pluginId`, `source` — identity / panel attribution.
- `facets`, `groupBy`, `getDragPayload`, `onSelect(row, ctx)`, `emptyState`,
  `searchPlaceholder`, `pageSize`, `debounceMs` — explorer behavior.
- `workspacePageId` / `workspacePageTitle` / `workspacePageIcon`,
  `catalogId` / `catalogLabel`,
  `visualizationPanelId` / `visualizationTitle` / `visualizationIcon` /
  `visualizationComponent` — per-contribution overrides.
- `surfaceKind`, `surfaceResolverId` — surface wiring overrides.
- `include*` flags — toggle each contribution.

Server options: `name`, `label`, `adapter`, `defaultLimit`, `maxLimit`,
`surfaceKind`, `guidance`, `id`.

## Package surfaces

| Import | Env | Exports |
|--------|-----|---------|
| `@hachej/boring-data-catalog/front` | Browser | `createDataCatalogPlugin`, surface-resolver + open/query helpers, types |
| `@hachej/boring-data-catalog/server` | Node | `createDataCatalogServerPlugin`, `createDataCatalogAgentTool`, `createDataCatalogSkillPrompt` |
| `@hachej/boring-data-catalog/shared` | Any | `DATA_CATALOG_PLUGIN_ID`, `DATA_CATALOG_DEFAULT_TOOL_NAME`, `DATA_CATALOG_ROW_SURFACE_KIND` |

## Dependencies

Requires `@hachej/boring-data-explorer` (table + adapter contract), peer
`@hachej/boring-workspace` (plugin/panel registry), and `lucide-react` (icons).

## Notes

- One adapter per plugin instance — call the builder once per data source.
- The default visualization panel shows another explorer scoped to the row, not
  charts; pass `visualizationComponent` for a custom view.
- No server-side caching; each search hits the adapter.

## Validation

```bash
pnpm --filter @hachej/boring-data-catalog typecheck
pnpm --filter @hachej/boring-data-catalog test
pnpm --filter @hachej/boring-data-catalog build
```

## License

MIT
