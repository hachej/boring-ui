# 07 — Agent UI Capabilities

Goal: let a plugin expose UI actions to the agent without the agent knowing React components or shell internals.

Example user intent:

```txt
"open the data catalog entry for series GDPC1"
```

Desired agent behavior:

```txt
1. find/know target id: series:GDPC1
2. call exec_ui openSurface with a stable plugin-defined kind
3. plugin resolver opens/focuses its pane/page and selects that entry
```

---

## Core model

A plugin exposes agent-addressable UI actions as **surface resolvers**.

```txt
agent does not know React component
agent knows capability kind + target
plugin maps kind/target -> UI pane params
```

Existing mechanism:

```txt
exec_ui openSurface
  params: { kind: string, target: string, meta?: object }
```

Use that. Do not invent a plugin-specific agent UI protocol unless `openSurface` proves insufficient.

---

## Metadata extension

Enrich existing `registerSurfaceResolver` metadata so the agent can discover what can be opened.

```ts
export interface BoringFrontSurfaceResolverRegistration {
  id?: string
  kind: string
  source?: string

  /** Agent/user-facing title. */
  title?: string

  /** Explains when to use this UI action. Included in get_ui_state/prompt. */
  description?: string

  /** Human hint for target format, e.g. "series:<id>". */
  targetHint?: string

  /** Optional JSON schema for meta. */
  metaSchema?: JSONSchema

  /** Examples for the agent/tool docs. */
  examples?: Array<{
    target: string
    meta?: Record<string, unknown>
    label?: string
  }>

  resolve: (request: SurfaceOpenRequest) => SurfacePanelResolution | null | undefined
}
```

`get_ui_state` should eventually include:

```ts
availableSurfaces: Array<{
  kind: string
  title?: string
  description?: string
  targetHint?: string
  examples?: Array<{ target: string; meta?: Record<string, unknown>; label?: string }>
  pluginId?: string
}>
```

This lets the agent discover domain UI actions without hardcoding component ids.

---

## Data Catalog example

### Plugin registration

```ts
const DATA_CATALOG_PAGE_ID = "data-catalog.page"

export default definePlugin({
  id: "data-catalog",
  label: "Data Catalog",
  panels: [
    {
      id: DATA_CATALOG_PAGE_ID,
      label: "Data Catalog",
      placement: "workspace-page",
      component: DataCatalogPage,
    },
  ],
  surfaceResolvers: [
    {
      id: "data-catalog.open-entry",
      kind: "data-catalog.entry",
      title: "Open data catalog entry",
      description: "Open the Data Catalog page and select a dataset, table, series, or catalog entry.",
      targetHint: "entry id, e.g. series:GDPC1 or table:orders_daily",
      examples: [
        { target: "series:GDPC1", label: "Open GDP series" },
        { target: "table:orders_daily", label: "Open orders_daily table" },
      ],
      resolve(request) {
        return {
          id: DATA_CATALOG_PAGE_ID,
          component: DATA_CATALOG_PAGE_ID,
          title: "Data Catalog",
          params: {
            selectedEntryId: request.target,
            view: typeof request.meta?.view === "string" ? request.meta.view : "detail",
          },
        }
      },
    },
  ],
})
```

### Agent call

```json
{
  "kind": "openSurface",
  "params": {
    "kind": "data-catalog.entry",
    "target": "series:GDPC1",
    "meta": { "view": "detail" }
  }
}
```

### UI behavior

The data catalog page receives/updates params:

```ts
type DataCatalogParams = {
  selectedEntryId?: string
  view?: "detail" | "preview" | "lineage"
}

function DataCatalogPage({ params, api }: PaneProps<DataCatalogParams>) {
  const [selectedEntryId, setSelectedEntryId] = useState(params.selectedEntryId)

  useEffect(() => {
    return api.onDidParametersChange((event) => {
      setSelectedEntryId(event.params.selectedEntryId as string | undefined)
    }).dispose
  }, [api])

  // render page with selected entry
}
```

Resolver uses stable `id: DATA_CATALOG_PAGE_ID`, so repeated agent requests reuse/focus the same data catalog pane and update its selected entry.

---

## Single-pane vs entry-specific panes

Two valid patterns:

### Single-pane page with mutable selection

Best for Data Catalog.

```txt
id: data-catalog.page
params.selectedEntryId = series:GDPC1
```

Agent opens different entries by updating params on same pane.

### Entry-specific panes

Best when each entry deserves its own tab/pane.

```txt
id: data-catalog.entry:series:GDPC1
params.selectedEntryId = series:GDPC1
```

Use only if multiple entries side-by-side is genuinely valuable.

Default recommendation for Data Catalog: **single-pane page with mutable selection**.

---

## Search/discovery vs opening UI

Opening UI and finding target ids are separate concerns.

```txt
search/discovery:
  agent tool or data catalog capability returns ids like series:GDPC1

opening UI:
  surface resolver opens/focuses UI for a known id
```

Data Catalog should expose both eventually:

```ts
// Agent/tool side
searchDataCatalog(query) -> [{ id: "series:GDPC1", title: "GDP" }]

// UI side
openSurface({ kind: "data-catalog.entry", target: "series:GDPC1" })
```

Do not make the agent guess ids from UI-only labels when a search tool can return canonical ids.

---

## Rules

```txt
- Agent-facing UI capability = surface resolver kind + metadata.
- Agent calls exec_ui openSurface, not component-specific React APIs.
- Plugin resolver maps domain target to pane id/component/params.
- Use stable pane id when one plugin page should update selection.
- Use entry-specific pane ids only when side-by-side entries matter.
- Page must respond to params changes via api.onDidParametersChange.
- get_ui_state should expose available surface capabilities for agent discovery.
```

---

## Acceptance

```txt
[ ] Surface resolver registration supports title/description/targetHint/examples metadata
[ ] get_ui_state exposes available surface capabilities
[ ] Data Catalog registers data-catalog.entry resolver
[ ] Agent can call exec_ui openSurface for a catalog entry id
[ ] Data Catalog page opens/focuses and selects requested entry
[ ] Repeated opens update existing Data Catalog pane rather than duplicating by default
[ ] Data Catalog search/tool returns canonical ids for the agent to pass as targets
```
