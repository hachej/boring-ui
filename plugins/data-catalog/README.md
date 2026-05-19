# @hachej/boring-data-catalog

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

</div>

A configurable data catalog plugin for the workbench — left sidebar tab with a searchable, faceted list and a visualization panel to explore rows. Built on [`@hachej/boring-data-explorer`](../data-explorer/README.md).

```bash
git clone https://github.com/hachej/boring-ui.git && cd boring-ui && pnpm install
```

> **Note:** This plugin is workspace-private (`"private": true`) — install from source within the monorepo.

---

## TL;DR

**The Problem**: You have a data source (customers, invoices, time series, whatever) and you want users to browse it from a sidebar tab, click rows to open detail visualizations, and let the agent open specific rows programmatically. But wiring up a catalog tab + explorer panel + surface resolver + agent tool is repetitive.

**The Solution**: `@hachej/boring-data-catalog` gives you a one-call plugin factory: pass in an `ExplorerDataSource` adapter and configure labels, facets, and behavior. It produces a left tab, a visualization panel, a catalog, and a surface resolver — all wired up.

### Why Use @hachej/boring-data-catalog?

| Feature | What It Does |
|---------|--------------|
| **Left sidebar catalog tab** | Persistent sidebar listing rows from your adapter, with search and facet filters |
| **Visualization panel** | Click a row → opens a detail panel that also shows an explorer table |
| **Surface resolver** | Agent can open a specific row via `openSurface` with `DATA_CATALOG_ROW_SURFACE_KIND` |
| **Agent tool** | Server plugin ships a `search_catalog` tool the agent uses to find rows before opening them |
| **Pre-wired with data-explorer** | Search + facets + drag-out behavior comes for free |
| **Customizable** | Swap the visualization component, customize facets/groupBy/onSelect, or pick which outputs to include |

---

## Quick Example

**Frontend (workbench):**

```ts
import { createDataCatalogPlugin } from "@hachej/boring-data-catalog/front"
import type { ExplorerDataSource } from "@hachej/boring-data-explorer/shared"

// Your data adapter
const adapter: ExplorerDataSource = {
  async search({ query, filters, limit, offset }) {
    // fetch from your backend
    return { items: [...], total, hasMore: ... }
  },
}

// One plugin = left tab + visualization panel + catalog + surface resolver
const catalogPlugin = createDataCatalogPlugin({
  id: "customers",
  label: "Customers",
  adapter,
  facets: [
    { key: "industry", label: "Industry", formatValue: (v) => v },
    { key: "region", label: "Region", order: ["US", "EU", "APAC"], formatValue: (v) => v },
  ],
  groupBy: "industry",
})
```

Add `catalogPlugin` to your `WorkspaceProvider` plugins array.

**Server (agent runtime):**

```ts
import { createDataCatalogServerPlugin } from "@hachej/boring-data-catalog/server"
import { ExplorerDataSource } from "@hachej/boring-data-explorer/shared"

const catalogServerPlugin = createDataCatalogServerPlugin({
  label: "Customers",
  adapter,        // same ExplorerDataSource as front
  defaultLimit: 20,
  maxLimit: 50,
})
```

Add `catalogServerPlugin` to `createAgentApp` `plugins` array.

Now agents can search the catalog via the tool and open specific rows via the UI bridge `openSurface` command:
```
openSurface({ kind: DATA_CATALOG_ROW_SURFACE_KIND, target: row.id, meta: { catalogId, row } })
```

---

## What It Produces

One call to `createDataCatalogPlugin()` produces four outputs:

| Output | What | Toggle |
|--------|------|--------|
| **Left tab** | Sidebar tab with searchable, faceted table | `includeLeftTab` (default: true) |
| **Visualization panel** | Center panel for exploring a selected row's context | `includeVisualizationPanel` (default: true) |
| **Catalog** | Command-palette-searchable catalog entry | `includeCatalog` (default: true) |
| **Surface resolver** | Maps `openSurface` calls to panel open | `includeSurfaceResolver` (default: true if visualization panel is on) |

You can disable any of these with the `include*` flags. For example, a plugin that only contributes a left tab:

```ts
createDataCatalogPlugin({
  id: "metrics",
  label: "Metrics",
  adapter,
  includeLeftTab: true,
  includeVisualizationPanel: false,
  includeCatalog: false,
  includeSurfaceResolver: false,
})
```

---

## Configuration

```ts
interface CreateDataCatalogPluginOptions {
  pluginId?: string
  id: string
  label: string
  adapter: ExplorerDataSource        // required — your data source
  facets?: FacetConfig[]             // facet filter definitions
  groupBy?: string                   // group key for the left tab rows
  getDragPayload?: (row) => DragPayload | null
  onSelect?: (row, context) => void  // custom row click handler
  emptyState?: ReactNode
  searchPlaceholder?: string
  pageSize?: number
  debounceMs?: number
  leftTabId?: string
  leftTabTitle?: string
  leftTabIcon?: IconType
  catalogId?: string
  catalogLabel?: string
  visualizationPanelId?: string
  visualizationTitle?: string
  visualizationIcon?: IconType
  visualizationComponent?: ComponentType<PaneProps<DataCatalogVisualizationParams>>
  includeLeftTab?: boolean           // default true
  includeCatalog?: boolean           // default true
  includeVisualizationPanel?: boolean // default true
  includeSurfaceResolver?: boolean   // default true (if visualization panel on)
  source?: "builtin" | "app"         // panel attribution
}
```

---

## Architecture

```
┌───────────────────────────────────────┐
│   Workspace Left Sidebar             │
│   ┌───────────────────────────────┐  │
│   │ 📊 Customers (left tab)       │  │
│   │ ┌───────────────────────────┐ │  │
│   │ │ [Search: "acme..."]       │ │  │
│   │ │ [Industry: Tech ▼]        │ │  │
│   │ │ ───────────────────────── │ │  │
│   │ │ US: Acme Corp      [T]  ✓ │ │  │
│   │ │ EU: Acme GmbH      [T]    │ │  │
│   │ │ APAC: Acme KK      [L]    │ │  │
│   │ └─────────────────────────── │ │  │
│   └───────────────────────────────┘  │
└───────────────┬───────────────────────┘
                │ click row → open panel
                ▼
┌───────────────────────────────────────┐
│   Center Panel (visualization)        │
│   ┌───────────────────────────────┐  │
│   │ Acme Corp                     │  │
│   │ US: Acme Corp [T]            │  │
│   │ ┌───────────────────────────┐│  │
│   │ │ [Search...]               ││  │
│   │ │ [filtered by row context] ││  │
│   │ │ ...explorer table...      ││  │
│   │ └───────────────────────────┘│  │
│   └───────────────────────────────┘  │
└───────────────────────────────────────┘
```

The agent can open any row programmatically:
```
POST /api/v1/ui/commands
{ kind: "openSurface", params: {
  surfaceKind: "data-catalog-row",
  target: <row.id>,
  meta: { catalogId: "customers", row: { title: "Acme Corp", ... } }
}}
```

---

## Installation

```bash
# From source (workspace-only — not published to npm)
cd boring-ui/plugins/data-catalog && pnpm install && pnpm build
```

---

## How @hachej/boring-data-catalog Compares

| Feature | @hachej/boring-data-catalog | Custom sidebar + table | Embedded BI tool |
|---------|------------------------------|-----------------------|------------------|
| Catalog tab + panel | ✅ One plugin call | ❌ DIY each piece | ⚠️ Configuration-heavy |
| Agent tool + bridge | ✅ search + openSurface | ❌ DIY | ❌ |
| Wiring effort | ✅ ~10 lines | ❌ Hours | ❌ Days |
| Data source flexibility | ✅ Any backend via ExplorerDataSource | ⚠️ Custom per source | ⚠️ Vendor-defined |
| Workbench integration | ✅ Drag-to-panel, exec_ui | ⚠️ Manual | ❌ None |
| Customizable outputs | ✅ Toggle left-tab / panel / catalog / resolver | ❌ All or nothing | ❌ |

**When to use @hachej/boring-data-catalog:**
- You want a sidebar catalog tab that lets users browse your data
- You want the agent to search and open specific rows in panels
- You want a left-tab + visualization panel combo with minimal code

**When it might not fit:**
- You only need a standalone table (use `@hachej/boring-data-explorer` directly)
- You want a full BI dashboard with charting (embed a dedicated BI tool)
- You need real-time data streaming (not supported in v1)

---

## Package Surfaces

| Import | Environment | What You Get |
|--------|-------------|--------------|
| `@hachej/boring-data-catalog/front` | Browser | `createDataCatalogPlugin()`, types, hooks, surface resolver |
| `@hachej/boring-data-catalog/server` | Node | `createDataCatalogServerPlugin()` — agent tool + skill prompt |
| `@hachej/boring-data-catalog/shared` | Any | `DATA_CATALOG_PLUGIN_ID`, `DATA_CATALOG_ROW_SURFACE_KIND`, constants |

---

## Dependencies

| Package | Required | Why |
|---------|----------|-----|
| `@hachej/boring-data-explorer` | ✅ Yes | Core table component and `ExplorerDataSource` adapter |
| `@hachej/boring-workspace` | ✅ peerDependency | Plugin system and panel registry |
| `lucide-react` | ✅ Yes | Catalog icons (Database, BarChart3) |

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| Catalog tab doesn't appear | Front plugin not in workspace | Add `createDataCatalogPlugin()` to `WorkspaceProvider` plugins |
| Clicking a row does nothing | `adapter.search()` is broken or returns nothing | Test your adapter independently |
| Agent tool not found | Server plugin not registered | Add `createDataCatalogServerPlugin()` to agent app `plugins` |
| Agent can't open rows | Surface resolver disabled | Set `includeSurfaceResolver: true` (on by default) |
| Icons not rendering | Invalid lucide icon name | Check `leftTabIcon` / `visualizationIcon` against [lucide.dev](https://lucide.dev/icons/) |

---

## Limitations

- **Workspace-private** — `"private": true` in package.json. Not published to npm. Install from source within the monorepo.
- **Single data source per plugin** — Each call to `createDataCatalogPlugin()` wires to one `ExplorerDataSource`. For multiple catalogs, instantiate the plugin multiple times with different adapters and labels.
- **No charting or visualization** — The visualization panel shows another explorer table, not charts. For visualizations, provide a custom `visualizationComponent`.
- **No server-side caching** — Each search triggers a fresh `search()` call. Cache at your adapter level if needed.
- **Real-time data** — Not supported in v1. Search uses debounce and pagination but no live streaming.

---

## FAQ

**Q: How do I use multiple data sources?**  
A: Call `createDataCatalogPlugin()` once per data source, each with a different `id`, `label`, and `adapter`. Or use `createSourcesAdapter(SourceEntry[])` from data-explorer to wrap a static source list.

**Q: How does the agent open a specific row?**  
A: The catalog registers a surface resolver. The agent uses the UI bridge `openSurface` command: `{ kind: DATA_CATALOG_ROW_SURFACE_KIND, target: row.id, meta: { catalogId, row } }`.

**Q: Can I customize the visualization panel?**  
A: Yes. Pass a custom `visualizationComponent` to `createDataCatalogPlugin()`. It receives `PaneProps<DataCatalogVisualizationParams>` with the selected row and context.

**Q: What if my data source is a REST API, not a database?**  
A: The `ExplorerDataSource` adapter is backend-agnostic. Implement `search()` (and optionally `fetchFacets()`) to hit your REST endpoint.

**Q: Can I disable outputs I don't need?**  
A: Yes. Set `includeLeftTab`, `includeVisualizationPanel`, `includeCatalog`, or `includeSurfaceResolver` to `false`. A left-tab-only plugin is a perfectly valid output.

---

*About Contributions:* Please don't take this the wrong way, but I do not accept outside contributions for any of my projects. I simply don't have the mental bandwidth to review anything, and it's my name on the thing, so I'm responsible for any problems it causes; thus, the risk-reward is highly asymmetric from my perspective. I'd also have to worry about other "stakeholders," which seems unwise for tools I mostly make for myself for free. Feel free to submit issues, and even PRs if you want to illustrate a proposed fix, but know I won't merge them directly. Instead, I'll have Claude or Codex review submissions via `gh` and independently decide whether and how to address them. Bug reports in particular are welcome. Sorry if this offends, but I want to avoid wasted time and hurt feelings. I understand this isn't in sync with the prevailing open-source ethos that seeks community contributions, but it's the only way I can move at this velocity and keep my sanity.

---

## License

MIT
