# @hachej/boring-data-catalog

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm](https://img.shields.io/npm/v/@hachej/boring-data-catalog.svg)](https://www.npmjs.com/package/@hachej/boring-data-catalog)

</div>

A configurable data catalog as a persistent workbench tab. Built on [`@hachej/boring-data-explorer`](../data-explorer/README.md) — adds a sidebar source navigator with search, facets, and agent-driven row opening.

```bash
curl -o install-data-catalog.sh https://raw.githubusercontent.com/hachej/boring-ui/main/plugins/data-catalog/install.sh | bash
```

---

## TL;DR

**The Problem**: Your agent app has multiple data sources (customers, invoices, orders) and you want a single sidebar tab listing them all, where users can pick a source and explore its rows. Building this catalog UI — source switching, open-in-panel routing, agent surface resolver — from scratch is repetitive.

**The Solution**: `@hachej/boring-data-catalog` gives you a ready-made left-tab plugin: configure your sources, wire up a data adapter, and you get a browsable catalog with faceted search and agent integration.

### Why Use @hachej/boring-data-catalog?

| Feature | What It Does |
|---------|--------------|
| **Left-tab catalog** | Persistent sidebar listing all configured data sources with icons |
| **Source switching** | Click a source → opens it in an explorer panel |
| **Surface resolver** | Agent can request "open this row" via typed open-request — routed to the right panel |
| **Pre-wired with data-explorer** | Search + facets + drag-out behavior comes for free |
| **Server adapter contract** | Backend-agnostic — implement `ExplorerDataSource` once per source |

### Quick Example

```bash
pnpm add @hachej/boring-data-catalog
```

**Frontend (workbench):**

```ts
import { createDataCatalogPlugin } from "@hachej/boring-data-catalog/front"

const catalogPlugin = createDataCatalogPlugin({
  sources: [
    { id: "customers", label: "Customers", icon: "users" },
    { id: "invoices", label: "Invoices", icon: "receipt" },
  ],
})
```

**Server (agent runtime):**

```ts
import { createDataCatalogServerPlugin } from "@hachej/boring-data-catalog/server"

const catalogServerPlugin = createDataCatalogServerPlugin({
  adapter: yourSourcesAdapter, // implements ExplorerDataSource per source id
})
```

Pass both plugins into your `WorkspaceProvider` and `createAgentApp`. Users see a "Data Catalog" tab in the sidebar; clicking a source opens a faceted explorer table.

---

## Installation

```bash
# pnpm
pnpm add @hachej/boring-data-catalog

# npm
npm install @hachej/boring-data-catalog

# from source
cd boring-ui/plugins/data-catalog
pnpm install && pnpm build
```

---

## Architecture

```
┌────────────────────────────────┐
│   Workspace Sidebar            │
│   ┌────────────────────────┐   │
│   │ ▤ Data Catalog         │   │
│   │ ───────────────────────│   │
│   │ 👥 Customers      430  │   │
│   │ 📄 Invoices      1,203 │   │
│   │ 📦 Orders        5,678 │   │
│   └────────────────────────┘   │
└──────────┬─────────────────────┘
           │ click → open source
           ▼
┌────────────────────────────────┐
│   Explorer Panel (center)       │
│   ┌──────────────────────┐     │
│   │ 🔍  [search...]      │     │
│   │ [facet: region ▼]    │     │
│   │ ─────────────────────│     │
│   │ id │ name  │ revenue │     │
│   │ 1  │ Acme  │ $42K    │     │
│   │ ... drag row out ... │     │
│   └──────────────────────┘     │
└────────────────────────────────┘
```

### Package Surfaces

| Import | Environment | What You Get |
|--------|-------------|--------------|
| `@hachej/boring-data-catalog/front` | Browser | `createDataCatalogPlugin()` — sidebar tab + panel opener |
| `@hachej/boring-data-catalog/server` | Node | `createDataCatalogServerPlugin()` — routes + adapter wiring |
| `@hachej/boring-data-catalog/shared` | Any | Source config types, constants |

### Configuration

```ts
interface CatalogSource {
  id: string           // unique source key
  label: string        // display name in sidebar
  icon: string         // lucide icon name (e.g. "users", "receipt")
  description?: string // optional tooltip
}

// Front plugin
createDataCatalogPlugin({
  sources: CatalogSource[]
})

// Server plugin
createDataCatalogServerPlugin({
  adapter: {
    getSource(sourceId: string): ExplorerDataSource | null
  }
})
```

---

## When to Use This vs `data-explorer`

| Use `data-explorer` when... | Use `data-catalog` when... |
|-----------------------------|----------------------------|
| You want a single faceted table inside a custom panel | You want a sidebar tab listing **multiple** data sources |
| You're building a one-off table | You want a reusable catalog the agent can navigate |
| You need total control over layout | You want "browse sources → click → explore" out of the box |

Both plugins share the same `ExplorerDataSource` adapter contract. You can use both in the same app.

---

## How @hachej/boring-data-catalog Compares

| Feature | @hachej/boring-data-catalog | Custom sidebar + table | Embedded BI tool |
|---------|------------------------------|------------------------|------------------|
| Source list sidebar | ✅ Built-in | ❌ DIY | ⚠️ Configuration-heavy |
| Agent row opening | ✅ Surface resolver | ❌ DIY | ❌ |
| Wiring effort | ✅ ~10 lines | ❌ Hours | ❌ Days |
| Data source flexibility | ✅ Any backend via adapter | ⚠️ Custom per source | ⚠️ Vendor-defined |
| Workbench integration | ✅ Drag-to-panel, exec_ui | ⚠️ Manual | ❌ None |

**When to use @hachej/boring-data-catalog:**
- You have 2+ data sources users need to browse
- You want a "data hub" sidebar in your agent app
- You want the agent to open specific rows in panels

**When it might not fit:**
- You only need one table (use `@hachej/boring-data-explorer` directly)
- You want a full BI dashboard with charting (embed a dedicated BI tool)
- You need real-time data streaming (not supported in v1)

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| Catalog tab doesn't appear | Front plugin not in workspace | Add `createDataCatalogPlugin()` to `WorkspaceProvider` plugins |
| Clicking a source does nothing | Server adapter not returning data source | Check your `adapter.getSource(sourceId)` implementation |
| Explorer panel opens but shows no rows | `search()` returning empty results | Verify your backend query and `ExplorerDataSource` implementation |
| Agent can't open rows | Surface resolver not registered | Ensure `createDataCatalogServerPlugin()` is added to agent app |
| Icons not rendering | Invalid lucide icon name | Check icon names against [lucide.dev](https://lucide.dev/icons/) |

---

## Limitations

- **Depends on `data-explorer`** — This plugin wraps the explorer. You need `@hachej/boring-data-explorer` installed as a dependency.
- **No charting or visualization** — The catalog opens tables, not charts. For visualizations, build a custom surface resolver that maps row clicks to a chart panel.
- **No server-side caching** — Each source switch triggers a fresh `search()` call. Cache at your adapter level if needed.
- **Single selection** — Only one source can be explored at a time. No split-panel dual-source comparison.

---

## FAQ

**Q: Can I add a new source without rebuilding the frontend?**  
A: The source list is configured at plugin creation time. For dynamic source discovery, implement a server route that returns source metadata and build a dynamic catalog plugin.

**Q: How does the agent open a specific row?**  
A: The catalog registers a surface resolver. The agent calls `exec_ui({ kind: "open-catalog-row", params: { sourceId, itemId } })` and the resolver opens the row in an explorer panel.

**Q: Can I customize the explorer panel that opens?**  
A: Yes. The catalog uses `data-explorer` internally. Wrap it with your own `createDataCatalogPlugin()` options to customize which columns, facets, or features are enabled.

**Q: What if my data source is a REST API, not a database?**  
A: The `ExplorerDataSource` adapter is backend-agnostic. Implement `search()` and `facets()` to hit your REST endpoint. The plugin doesn't care where data comes from.

---

## Dependencies

| Package | Required | Why |
|---------|----------|-----|
| `@hachej/boring-data-explorer` | ✅ Yes | Core table component and adapter contract |
| `@hachej/boring-workspace` | ✅ Yes | Plugin system and panel registry |
| `lucide-react` | ✅ Yes | Source icons in the sidebar |

---

*About Contributions:* Please don't take this the wrong way, but I do not accept outside contributions for any of my projects. I simply don't have the mental bandwidth to review anything, and it's my name on the thing, so I'm responsible for any problems it causes; thus, the risk-reward is highly asymmetric from my perspective. I'd also have to worry about other "stakeholders," which seems unwise for tools I mostly make for myself for free. Feel free to submit issues, and even PRs if you want to illustrate a proposed fix, but know I won't merge them directly. Instead, I'll have Claude or Codex review submissions via `gh` and independently decide whether and how to address them. Bug reports in particular are welcome. Sorry if this offends, but I want to avoid wasted time and hurt feelings. I understand this isn't in sync with the prevailing open-source ethos that seeks community contributions, but it's the only way I can move at this velocity and keep my sanity.

---

## License

MIT
