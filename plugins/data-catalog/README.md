# @hachej/boring-data-catalog

A configurable data catalog as a workbench tab. Built on [`@hachej/boring-data-explorer`](../data-explorer/README.md).

```bash
pnpm add @hachej/boring-data-catalog
```

---

## What it provides

- **Left-tab catalog** — a persistent sidebar tab listing data sources, with search, facets, and row selection
- **Surface resolver** — agent can request "open this row in the workbench" via a typed open-request
- **Server hooks** — server-side adapter contract so the catalog can be backed by any database, warehouse, or API
- **Pre-wired with `data-explorer`** — search + facets + drag-out behaviour comes for free

---

## Quickstart

Front (workbench):

```ts
import { createDataCatalogPlugin } from "@hachej/boring-data-catalog/front"

const catalogPlugin = createDataCatalogPlugin({
  sources: [
    { id: "customers", label: "Customers", icon: "users" },
    { id: "invoices",  label: "Invoices",  icon: "receipt" },
  ],
})
```

Server (agent runtime):

```ts
import { createDataCatalogServerPlugin } from "@hachej/boring-data-catalog/server"

const catalogServerPlugin = createDataCatalogServerPlugin({
  adapter: yourSourcesAdapter, // implements ExplorerDataSource per source id
})
```

Pass both into `WorkspaceProvider` / `createAgentApp` as plugins.

---

## When to use this vs `data-explorer`

- **`data-explorer`** — when you want a single faceted table inside a custom panel
- **`data-catalog`** — when you want a sidebar tab that lists multiple data sources and lets the user explore any of them

---

## Part of [boring-ui](https://github.com/hachej/boring-ui)
