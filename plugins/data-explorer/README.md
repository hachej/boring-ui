# @hachej/boring-data-explorer

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

</div>

Searchable, faceted data tables for the workbench. The headless primitive that `data-catalog` and other explorer-style plugins build on top of.

```bash
git clone https://github.com/hachej/boring-ui.git && cd boring-ui && pnpm install
```

> **Note:** This plugin is workspace-private (`"private": true`) — install from source within the monorepo.

---

## TL;DR

**The Problem**: You have data — customers, invoices, logs, metrics — and you want users to search, filter, and explore it inside an agent app. But building faceted tables with virtualization, paging, and selection from scratch is tedious.

**The Solution**: `@hachej/boring-data-explorer` provides a controlled `<DataExplorer>` component + `useExplorerState` hook + an `ExplorerDataSource` adapter contract. You implement `search(args)` (and optionally `fetchFacets(args)`) against any backend. The component handles the rest.

### Why Use @hachej/boring-data-explorer?

| Feature | What It Does |
|---------|--------------|
| **`<DataExplorer>` component** | Search box, faceted filters, virtualized rows, row selection, drag-and-drop payload |
| **`useExplorerState` hook** | Manages query, facets, paging, and selection state |
| **Adapter contract** | `search(args)` + optional `fetchFacets(args)` — implement once, plug any backend (SQL, REST, in-memory, gRPC) |
| **Agent-driven** | Rows expose a `DragPayload`; the agent can open any row via surface resolver |
| **Headless + styled** | Use the hook alone for custom UI, or mount the full component out of the box |

---

## Quick Example

```tsx
import { DataExplorer, useExplorerState } from "@hachej/boring-data-explorer/front"
import type { ExplorerDataSource, SearchArgs, SearchResult } from "@hachej/boring-data-explorer/shared"

// 1. Implement the adapter against your backend
const customersSource: ExplorerDataSource = {
  async search({ query, filters, limit, offset, signal }): Promise<SearchResult> {
    const res = await fetch(`/api/customers?q=${query}&limit=${limit}&offset=${offset}`, { signal })
    const { items, total } = await res.json()
    return { items, total, hasMore: offset + items.length < total }
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

## Adapter Contract

```ts
// Explorer item shape rendered by the DataExplorer
export type ExplorerItem = {
  id: string
  title: string
  subtitle?: string          // muted second line (truncates with title)
  group?: string             // group key — matches a facet value for grouping
  leading?: Badge            // leading mono chip (e.g. type code)
  trailing?: Badge[]         // trailing chips for status flags
  meta?: string              // right-aligned plain text (e.g. "1.2M")
}

export type Badge = {
  code: string               // 1-4 char mono code rendered as a chip
  tooltip?: string
}

// Search arguments from the explorer to your adapter
export type SearchArgs = {
  query: string
  filters: Record<string, string[]>   // active facet filters
  group?: { key: string; value: string }  // scope to single group (paging inside a group)
  limit: number
  offset: number
  signal?: AbortSignal
}

// Search result your adapter returns
export type SearchResult = {
  items: ExplorerItem[]
  total: number               // total count for the current scope (query + filters + optional group)
  hasMore: boolean            // whether there are more pages
}

// Facets — optional. When omitted, the explorer renders flat (no facet popover)
export type Facets = Record<string, FacetValue[]>
export type FacetValue = { value: string; count: number }

export type FacetsArgs = {
  filters: Record<string, string[]>
  signal?: AbortSignal
}

// The adapter contract
export interface ExplorerDataSource {
  search(args: SearchArgs): Promise<SearchResult>
  fetchFacets?(args: FacetsArgs): Promise<Facets>   // optional
}
```

Implement against **any backend**. The component doesn't care whether data comes from SQL, REST, Elasticsearch, or a JSON file.

### Static Data Adapter

```tsx
import type { ExplorerDataSource, ExplorerItem } from "@hachej/boring-data-explorer/shared"

const entries: ExplorerItem[] = [
  { id: "customers", title: "Customers", subtitle: "Customer records", leading: { code: "tbl" } },
  { id: "invoices", title: "Invoices", subtitle: "Invoice records", leading: { code: "tbl" }, group: "finance" },
]

const adapter: ExplorerDataSource = {
  async search({ query, limit, offset }) {
    const normalized = query.trim().toLowerCase()
    const matched = normalized
      ? entries.filter((entry) => `${entry.title} ${entry.subtitle ?? ""}`.toLowerCase().includes(normalized))
      : entries
    const items = matched.slice(offset, offset + limit)
    return { items, total: matched.length, hasMore: offset + items.length < matched.length }
  },
}
```

---

## Installation

```bash
# From source (workspace-only — not published to npm)
cd boring-ui/plugins/data-explorer && pnpm install && pnpm build
```

---

## Package Surfaces

| Import | Environment | What You Get |
|--------|-------------|--------------|
| `@hachej/boring-data-explorer` | Browser | `<DataExplorer>`, `useExplorerState`, all types re-exported |
| `@hachej/boring-data-explorer/front` | Browser | Same as top-level (explicit subpath) |
| `@hachej/boring-data-explorer/shared` | Any | `ExplorerDataSource`, `ExplorerItem`, `Facets`, `SearchArgs`, `DragPayload`, `Badge` — no React deps |
| `@hachej/boring-data-explorer/testing` | Browser | Test utilities and mock data sources |

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
               │ source.search(args)
               │ source.fetchFacets?(args)
┌──────────────▼─────────────┐
│    ExplorerDataSource      │
│  (your adapter impl)       │
│                            │
│  search({ query, filters,  │
│          limit, offset })  │
│                            │
│  fetchFacets?({ filters }) │
└──────────────┬─────────────┘
               │
┌──────────────▼─────────────┐
│   Any Backend              │
│   PostgreSQL · REST API    │
│   Elasticsearch · In-memory│
│   gRPC · whatever          │
└────────────────────────────┘
```

---

## How @hachej/boring-data-explorer Compares

| Feature | @hachej/boring-data-explorer | AG Grid | TanStack Table | Build your own |
|---------|------------------------------|---------|----------------|----------------|
| Built-in search + facets | ✅ One hook | ⚠️ Filter only | ❌ DIY | ❌ |
| Backend adapter contract | ✅ `search` + `fetchFacets` | ❌ In-memory | ⚠️ Sorting/filtering | ❌ |
| Drag-and-drop payload | ✅ `DragPayload` type | ⚠️ Add-on | ❌ | ❌ |
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
| Facets empty | `fetchFacets()` not implemented | Add the optional `fetchFacets` method to your adapter |
| Infinite loading loop | `useExplorerState` deps changing every render | Memoize your `source` object or move it outside the component |
| Drag not working | Row has no `DragPayload` | Pass `getDragPayload` prop to `<DataExplorer>` |
| Wrong source selected | Adapter returns the wrong item ids or payload | Check your adapter's `search()` mapping |

---

## Limitations

- **Workspace-private** — `"private": true` in package.json. Not published to npm. Install from source within the monorepo.
- **Not an enterprise data grid** — No cell editing, pivot tables, or group-by. It's a search-and-filter primitive, not AG Grid.
- **No built-in data fetching** — You implement `search()` and optionally `fetchFacets()`. The adapter doesn't cache or debounce.
- **Requires boring-ui workspace chrome** — The component assumes it's mounted inside a workspace panel layout. Standalone use is possible but you lose the drag-to-panel behavior.
- **No column customization UI** — Column shape is derived from `ExplorerItem` (title / subtitle / leading / trailing / meta) — no arbitrary column projection.

---

## FAQ

**Q: What's the difference between `data-explorer` and `data-catalog`?**  
A: `data-explorer` is the primitive — a single table you mount wherever. `data-catalog` is a higher-level plugin: it puts a sidebar tab listing data sources, and clicking a source opens the explorer table.

**Q: Can I use this without the boring-ui workspace?**  
A: Yes. `<DataExplorer>` and `useExplorerState` are standalone React exports. You'll just lose the drag-to-panel integration since there's no workbench to receive the payload.

**Q: How do I customize the table columns?**  
A: Columns are derived from `ExplorerItem` fields: `title` (primary), `subtitle` (secondary), `leading` (mono chip), `trailing` (status badges), `meta` (right-aligned text). There is no per-column projection API.

**Q: Does it support server-side pagination?**  
A: Yes — `search()` receives `limit` and `offset`. Your backend can return a slice. `total` and `hasMore` drive the pager.

**Q: Can I use this for non-tabular data?**  
A: Yes — map any data shape (GraphQL results, CSV rows, API responses) to `ExplorerItem[]`. The adapter is backend-agnostic.

---

## Used by

- **[`@hachej/boring-data-catalog`](../data-catalog/README.md)** — configurable catalog tab listing multiple data sources
- Any plugin that needs a faceted, searchable table inside a workbench panel

---

*About Contributions:* Please don't take this the wrong way, but I do not accept outside contributions for any of my projects. I simply don't have the mental bandwidth to review anything, and it's my name on the thing, so I'm responsible for any problems it causes; thus, the risk-reward is highly asymmetric from my perspective. I'd also have to worry about other "stakeholders," which seems unwise for tools I mostly make for myself for free. Feel free to submit issues, and even PRs if you want to illustrate a proposed fix, but know I won't merge them directly. Instead, I'll have Claude or Codex review submissions via `gh` and independently decide whether and how to address them. Bug reports in particular are welcome. Sorry if this offends, but I want to avoid wasted time and hurt feelings. I understand this isn't in sync with the prevailing open-source ethos that seeks community contributions, but it's the only way I can move at this velocity and keep my sanity.

---

## License

MIT
