# @hachej/boring-data-explorer

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm](https://img.shields.io/npm/v/@hachej/boring-data-explorer.svg)](https://www.npmjs.com/package/@hachej/boring-data-explorer)

</div>

Searchable, faceted data tables for the workbench. The headless primitive that `data-catalog` and other explorer-style plugins build on top of.

```bash
curl -o install-data-explorer.sh https://raw.githubusercontent.com/hachej/boring-ui/main/plugins/data-explorer/install.sh | bash
```

---

## TL;DR

**The Problem**: You have data — customers, invoices, logs, metrics — and you want users to search, filter, and explore it inside an agent app. But building faceted tables with virtualization, paging, and selection from scratch is tedious.

**The Solution**: `@hachej/boring-data-explorer` provides a controlled `<DataExplorer>` component + `useExplorerState` hook + an `ExplorerDataSource` adapter contract. You implement two methods (`search`, `facets`) against any backend. The component handles the rest.

### Why Use @hachej/boring-data-explorer?

| Feature | What It Does |
|---------|--------------|
| **`<DataExplorer>` component** | Search box, faceted filters, virtualized rows, row selection, drag-and-drop payload |
| **`useExplorerState` hook** | Manages query, facets, paging, and selection state |
| **Adapter contract** | `search(args)` + `facets(args)` — implement once, plug any backend (SQL, REST, in-memory, gRPC) |
| **`createSourcesAdapter`** | Fan a single explorer across multiple datasources (one component, many tables) |
| **Agent-driven** | Rows expose a drag-out payload; the agent can open any row via surface resolver |
| **Headless + styled** | Use the hook alone for custom UI, or mount the full component out of the box |

---

## Quick Example

```bash
pnpm add @hachej/boring-data-explorer
```

```tsx
import { DataExplorer, useExplorerState } from "@hachej/boring-data-explorer"
import type { ExplorerDataSource } from "@hachej/boring-data-explorer"

// 1. Implement the adapter against your backend
const customersSource: ExplorerDataSource = {
  async search({ query, facets, page, pageSize }) {
    const res = await fetch(`/api/customers?q=${query}&page=${page}`)
    const { items, total } = await res.json()
    return { items, total }
  },
  async facets({ query }) {
    const res = await fetch(`/api/customers/facets?q=${query}`)
    return res.json()
  },
}

// 2. Mount the explorer
export function CustomersPane() {
  const state = useExplorerState({ source: customersSource, pageSize: 50 })
  return <DataExplorer state={state} />
}
```

The result is a sortable, filterable table — users can search, filter by facets, select rows, and drag rows into other panels.

---

## Installation

```bash
# pnpm
pnpm add @hachej/boring-data-explorer

# npm
npm install @hachej/boring-data-explorer

# from source
cd boring-ui/plugins/data-explorer
pnpm install && pnpm build
```

---

## Architecture

```
┌─────────────────────────────┐
│     <DataExplorer>         │
│  ┌───┬─────┬─────────────┐ │
│  │ 🔍 │ Facets │ Results │ │
│  └───┴─────┴─────────────┘ │
│  ┌───┐ ┌───────────────┐  │
│  │ ← │ │ 1..25 of 430  │  │
│  └───┘ └───────────────┘  │
└──────────────┬─────────────┘
               │ state.source.search()
               │ state.source.facets()
┌──────────────▼─────────────┐
│    ExplorerDataSource      │
│  (your adapter impl)       │
│                            │
│  search({ query, facets,   │
│          page, pageSize }) │
│                            │
│  facets({ query })         │
└──────────────┬─────────────┘
               │
┌──────────────▼─────────────┐
│   Any Backend              │
│   PostgreSQL · REST API    │
│   Elasticsearch · In-memory│
│   gRPC · whatever          │
└────────────────────────────┘
```

### Package Surfaces

| Import | Environment | What You Get |
|--------|-------------|--------------|
| `@hachej/boring-data-explorer` | Browser | `<DataExplorer>`, `useExplorerState`, `createSourcesAdapter` |
| `@hachej/boring-data-explorer/shared` | Any | `ExplorerDataSource`, `ExplorerItem`, `FacetValue`, types |
| `@hachej/boring-data-explorer/testing` | Browser | Test utilities and mock data sources |

### Adapter Contract

```ts
interface ExplorerDataSource {
  search(args: {
    query: string
    facets: Record<string, string[]>   // active facet filters
    page: number
    pageSize: number
  }): Promise<{ items: ExplorerItem[]; total: number }>

  facets(args: { query: string }): Promise<FacetValue[]>
}

interface ExplorerItem {
  id: string
  label: string
  data: Record<string, unknown>        // row payload — anything you need
  dragPayload?: unknown                // what gets dragged when user drops the row
}

interface FacetValue {
  facetId: string
  values: { value: string; count: number }[]
}
```

Implement against **any backend**. The component doesn't care whether data comes from SQL, REST, Elasticsearch, or a JSON file.

### Multi-Source Adapter

```tsx
import { createSourcesAdapter } from "@hachej/boring-data-explorer"

const adapter = createSourcesAdapter({
  sources: {
    customers: customersSource,
    invoices: invoicesSource,
    orders: ordersSource,
  },
  defaultSource: "customers",
})

// Now one explorer can switch between all three sources
```

---

## How @hachej/boring-data-explorer Compares

| Feature | @hachej/boring-data-explorer | AG Grid | TanStack Table | Build your own |
|---------|------------------------------|---------|----------------|----------------|
| Built-in search + facets | ✅ One hook | ⚠️ Filter only | ❌ DIY | ❌ |
| Backend adapter contract | ✅ `search` + `facets` | ❌ In-memory | ⚠️ Sorting/filtering | ❌ |
| Drag-and-drop payload | ✅ Built in | ⚠️ Add-on | ❌ | ❌ |
| Agent integration | ✅ Surface resolver | ❌ | ❌ | ❌ |
| Virtualized rows | ✅ | ✅ | ⚠️ Manual | ❌ |
| Complexity | ✅ ~10 lines to mount | ❌ Heavy API | ⚠️ Complex API | ❌ Weeks |

**When to use @hachej/boring-data-explorer:**
- You want a fast, searchable table with facet filters in a boring-ui workbench
- You're building a data catalog plugin for an agent app
- You need drag-and-drop from table rows to other panels

**When it might not fit:**
- You need enterprise-grade data grids (use AG Grid or TanStack Table)
- You need editable cells, pivot tables, or group-by aggregations
- You're building outside of a boring-ui workspace (you'd need the layout shell)

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| No rows showing | `search()` returned empty items | Check your backend query — log the response |
| Facets empty | `facets()` not implemented or returning empty array | Implement the `facets` method on your data source |
| Infinite loading loop | `useExplorerState` deps changing every render | Memoize your `source` object or move it outside the component |
| Drag not working | Row has no `dragPayload` | Ensure your `search()` result items include `dragPayload` |
| Wrong source selected | Multi-source adapter misconfigured | Check `defaultSource` matches a source key |

---

## Limitations

- **Not an enterprise data grid** — No cell editing, pivot tables, or group-by. It's a search-and-filter primitive, not AG Grid.
- **No built-in data fetching** — You implement `search()` and `facets()`. The adapter doesn't cache or debounce.
- **Requires boring-ui workspace chrome** — The component assumes it's mounted inside a workspace panel layout. Standalone use is possible but you lose the drag-to-panel behavior.
- **No column customization UI** — Columns are derived from the row data. No per-column sort configuration or visibility toggles in v1.

---

## FAQ

**Q: What's the difference between `data-explorer` and `data-catalog`?**  
A: `data-explorer` is the primitive — a single table you mount wherever. `data-catalog` is a higher-level plugin: it puts a sidebar tab listing multiple data sources, and clicking a source opens the explorer table.

**Q: Can I use this without the boring-ui workspace?**  
A: Yes. `<DataExplorer>` and `useExplorerState` are standalone React exports. You'll just lose the drag-to-panel integration since there's no workbench to receive the payload.

**Q: How do I customize the table columns?**  
A: The component renders columns from `ExplorerItem.data`. Add a `columns` prop (or map data fields) in your own wrapper. v1 ships with auto-generated columns from the data keys.

**Q: Does it support server-side pagination?**  
A: Yes — `search()` receives `page` and `pageSize`. Your backend can return a slice. The `total` field drives the pager.

**Q: Can I use this for non-tabular data?**  
A: The interface expects `{ items: [...], total }`. You can map any data shape (GraphQL results, CSV rows, API responses) to `ExplorerItem[]`.

---

## Used by

- **[`@hachej/boring-data-catalog`](../data-catalog/README.md)** — configurable catalog tab listing multiple data sources
- Any plugin that needs a faceted, searchable table inside a workbench panel

---

*About Contributions:* Please don't take this the wrong way, but I do not accept outside contributions for any of my projects. I simply don't have the mental bandwidth to review anything, and it's my name on the thing, so I'm responsible for any problems it causes; thus, the risk-reward is highly asymmetric from my perspective. I'd also have to worry about other "stakeholders," which seems unwise for tools I mostly make for myself for free. Feel free to submit issues, and even PRs if you want to illustrate a proposed fix, but know I won't merge them directly. Instead, I'll have Claude or Codex review submissions via `gh` and independently decide whether and how to address them. Bug reports in particular are welcome. Sorry if this offends, but I want to avoid wasted time and hurt feelings. I understand this isn't in sync with the prevailing open-source ethos that seeks community contributions, but it's the only way I can move at this velocity and keep my sanity.

---

## License

MIT
