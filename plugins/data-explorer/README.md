# @hachej/boring-data-explorer

Searchable, faceted data tables for the workbench. This is the primitive — `data-catalog` and other explorer-style plugins build on top of it.

```bash
pnpm add @hachej/boring-data-explorer
```

---

## What it provides

- **`<DataExplorer>`** — controlled React component: search box, faceted filters, virtualized rows, row selection, drag-and-drop payload
- **`useExplorerState`** — hook that manages query, facets, paging, and selection
- **`ExplorerDataSource`** — adapter contract: `search(args)` and `facets(args)`. Plug any backend in.
- **`createSourcesAdapter`** — helper to fan a `DataExplorer` across multiple sources (one explorer, many tables)

---

## Quickstart

```tsx
import { DataExplorer, useExplorerState } from "@hachej/boring-data-explorer"
import type { ExplorerDataSource } from "@hachej/boring-data-explorer"

const source: ExplorerDataSource = {
  async search({ query, facets, page }) { /* fetch your data */ },
  async facets({ query }) { /* compute facet counts */ },
}

export function CustomersPane() {
  const state = useExplorerState({ source })
  return <DataExplorer state={state} />
}
```

The result is a sortable, filterable table the agent can drive (via the surface resolver) and the user can drag rows out of.

---

## Adapter contract

```ts
type SearchArgs = { query: string; facets: Facets; page: number; pageSize: number }
type SearchResult = { items: ExplorerItem[]; total: number }

interface ExplorerDataSource {
  search(args: SearchArgs): Promise<SearchResult>
  facets(args: FacetsArgs): Promise<FacetValue[]>
}
```

Implement against any backend: SQL, REST, in-memory, gRPC. The component does not care.

---

## Used by

- [`@hachej/boring-data-catalog`](../data-catalog/README.md) — configurable catalog tab
- Any plugin that needs a faceted table over agent-readable data

---

## Part of [boring-ui](https://github.com/hachej/boring-ui)
