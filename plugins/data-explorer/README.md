# @hachej/boring-data-explorer

Searchable, faceted data tables for the workbench. This is the headless
primitive that `@hachej/boring-data-catalog` and other explorer-style plugins
build on. It is **not** a workspace plugin itself — it ships a React component,
a hook, and an adapter contract.

## What it does

- Renders a `<DataExplorer>` table: search box, faceted filter popover, optional
  group/tree mode, row activation, and drag-out payloads.
- Manages query / facet / paging / selection state via `useExplorerState`.
- Defines the `ExplorerDataSource` adapter contract: you implement
  `search(args)` (and optionally `fetchFacets(args)`) against any backend.

## Usage

`<DataExplorer>` is self-contained — it calls `useExplorerState` internally, so
you pass the **adapter** (not a state object):

```tsx
import { DataExplorer } from "@hachej/boring-data-explorer/front"
import type { ExplorerDataSource } from "@hachej/boring-data-explorer/shared"

const customers: ExplorerDataSource = {
  async search({ query, filters, limit, offset, signal }) {
    const res = await fetch(`/api/customers?q=${query}&limit=${limit}&offset=${offset}`, { signal })
    const { items, total } = await res.json()
    return { items, total, hasMore: offset + items.length < total }
  },
}

export function CustomersPane() {
  return <DataExplorer adapter={customers} pageSize={50} />
}
```

Use `useExplorerState({ adapter, facets, groupBy, pageSize })` directly only
when you need to drive a fully custom UI.

### `<DataExplorer>` props

`adapter` (required), `facets`, `groupBy`, `onActivate(row)`,
`getDragPayload(row)`, `emptyState`, `searchPlaceholder`, `toolbarTitle`,
`toolbarIcon`, `searchable`, `query` + `onQueryChange` (controlled search),
`pageSize`, `debounceMs`, `className`. Facets render only when the adapter
implements `fetchFacets`. `groupBy` enables tree mode (the key must match a
facet key); an active query/filter forces flat mode.

## Adapter contract

```ts
type ExplorerItem = {
  id: string
  title: string
  subtitle?: string        // muted second line
  group?: string           // group key — must match a facet value
  leading?: Badge          // leading mono chip
  trailing?: Badge[]       // trailing status chips
  meta?: string            // right-aligned plain text (e.g. "1.2M")
}
type Badge = { code: string; tooltip?: string }   // code = 1–4 char chip

type FacetConfig = {
  key: string
  label: string
  order?: string[]                       // explicit display order
  formatValue?: (value: string) => string
}

type SearchArgs = {
  query: string
  filters: Record<string, string[]>
  group?: { key: string; value: string } // set when paging inside a group
  limit: number
  offset: number
  signal?: AbortSignal
}
type SearchResult = { items: ExplorerItem[]; total: number; hasMore: boolean }

type FacetsArgs = { filters: Record<string, string[]>; signal?: AbortSignal }
type Facets = Record<string, { value: string; count: number }[]>

interface ExplorerDataSource {
  search(args: SearchArgs): Promise<SearchResult>
  fetchFacets?(args: FacetsArgs): Promise<Facets>   // optional
}

type DragPayload = { mimeType: string; value: string }
```

The adapter is backend-agnostic — SQL, REST, in-memory, anything that can return
`ExplorerItem[]`. A static in-memory adapter just filters and slices an array
inside `search()`.

## Package surfaces

| Import | Exports |
|--------|---------|
| `@hachej/boring-data-explorer` / `/front` | `DataExplorer`, `useExplorerState`, all types |
| `@hachej/boring-data-explorer/shared` | contract types only (no React) |
| `@hachej/boring-data-explorer/testing` | `createMockSeriesAdapter`, `createMockTablesAdapter` |

## Notes

- Not an enterprise grid: no cell editing, pivots, group-by aggregation, or
  per-column projection. Columns are derived from `ExplorerItem` fields.
- No built-in caching/debounce of fetches beyond the explorer's own search
  debounce — cache at the adapter layer if needed.
- Drag-to-panel only works inside a boring-ui workspace (which receives the
  payload); standalone use still renders the table.

## Used by

- `@hachej/boring-data-catalog` — wraps this into a configurable catalog tab +
  visualization panel + agent tool.

## Validation

```bash
pnpm --filter @hachej/boring-data-explorer typecheck
pnpm --filter @hachej/boring-data-explorer test
pnpm --filter @hachej/boring-data-explorer build
```

## License

MIT
