# 06 — Data Catalog / Data Explorer Composition

Status: align with current implementation

## Current reality

Data catalog already exists as reusable composition. Do not invent a new shell-level dependency model for it.

Current packages:

```txt
@hachej/boring-data-explorer
  generic UI component + adapter contract
  exports DataExplorer

@hachej/boring-data-catalog
  plugin builder around DataExplorer
  exports createDataCatalogPlugin(options)
  exports createDataCatalogServerPlugin(options)
  exports open/surface/query helpers
```

So the right model is:

```txt
regular plugin page can use DataExplorer directly
or compose createDataCatalogPlugin(options)
or depend on/coordinate with a specific app-local data catalog plugin if needed
```

No special framework concept is required.

---

## What Data Catalog currently provides

`createDataCatalogPlugin(options)` contributes up to four things:

```txt
left/workspace page:
  searchable/faceted row list using DataExplorer

visualization panel:
  center panel for selected row, replaceable with custom component

catalog entry:
  command-palette-searchable catalog integration

surface resolver:
  maps exec_ui openSurface -> opens selected row visualization panel
```

Flags:

```txt
includeLeftTab
includeVisualizationPanel
includeCatalog
includeSurfaceResolver
```

Current naming still says `leftTab`; future public naming should converge to:

```txt
placement: "workspace-page"
```

---

## How boring-macro uses it today

Boring Macro does **not** use Data Catalog as a shell capability.

It composes the data catalog plugin builder inside the macro plugin.

```ts
const macroSeriesCatalogPlugin = createDataCatalogPlugin(
  createMacroSeriesCatalogOptions(onSeriesSelect),
)

return definePlugin({
  id: MACRO_PLUGIN_ID,
  setup(api) {
    macroSeriesCatalogPlugin(api)
  },
})
```

Macro options:

```ts
createDataCatalogPlugin({
  id: "macro-series",
  label: "Data",
  adapter: macroAdapter,
  facets: MACRO_FACETS,
  groupBy: "frequency",
  onSelect: (row) => openSeriesPane(row.id),
  leftTabId: "macro-series",
  leftTabTitle: "Data",
  catalogId: "macro-series",
  catalogLabel: "Macro Series",
  includeVisualizationPanel: false,
  includeSurfaceResolver: false,
})
```

Meaning:

```txt
Macro owns the app/plugin.
Macro composes Data Catalog UI for browsing FRED series.
Selecting a row calls macro-owned openSeriesPane(row.id).
openSeriesPane uses macro's own surface resolver to open chart panel.
```

This is the pattern to preserve.

---

## Correct model

```txt
DataExplorer = reusable UI component
DataCatalog = reusable plugin builder using DataExplorer
App/plugin can compose DataCatalog builder
Plugin owns what row selection does
Agent UI actions are exposed through surface resolvers
```

Not:

```txt
Data Catalog = special workspace shell capability
Data Catalog = framework-level left pane system
Data Catalog = required dependency service for all plugins
```

---

## Plugin-owned page using DataExplorer directly

A plugin can just use `DataExplorer` inside its own page.

```tsx
import { DataExplorer } from "@hachej/boring-data-explorer/front"

function MacroSeriesPage({ className }: PaneProps<LeftTabParams>) {
  return (
    <div className={cn("h-full", className)}>
      <DataExplorer
        adapter={macroAdapter}
        facets={MACRO_FACETS}
        groupBy="frequency"
        onActivate={(row) => openSeriesPane(row.id)}
        className="h-full"
      />
    </div>
  )
}
```

This is the simplest dependency story:

```txt
plugin imports reusable UI package
plugin owns page behavior
```

---

## Plugin composing Data Catalog builder

A plugin can also compose `createDataCatalogPlugin(options)` like boring-macro does.

```ts
const catalogPlugin = createDataCatalogPlugin({
  id: "macro-series",
  label: "Data",
  adapter: macroAdapter,
  onSelect: (row) => openSeriesPane(row.id),
})

export default definePlugin({
  id: "macro",
  setup(api) {
    catalogPlugin(api)
  },
})
```

This contributes an additional workspace page/category from the composed plugin.

---

## Agent-openable behavior

There are two current patterns.

### Data Catalog default pattern

Data Catalog's own surface resolver opens a visualization panel for a row.

```txt
kind: data-catalog.open-row
meta: { catalogId, row }
```

### Boring Macro pattern

Macro disables Data Catalog visualization/surface resolver and owns row activation.

```txt
DataExplorer row select
  -> openSeriesPane(row.id)
  -> exec_ui openSurface kind=macro.open-series target=<seriesId>
  -> macro surface resolver opens chart panel
```

That is clean: DataExplorer/DataCatalog supplies browsing UI; Macro owns domain-specific action.

---

## Future rename / API cleanup

Current Data Catalog builder still talks in `leftTabId`, `leftTabTitle`, `includeLeftTab`.

For the new naming, add aliases rather than a whole new concept:

```ts
workspacePageId?: string
workspacePageTitle?: string
includeWorkspacePage?: boolean
```

Map aliases internally:

```txt
workspacePageId -> leftTabId for old implementation
includeWorkspacePage -> includeLeftTab
placement: "workspace-page" -> current workspace page host
```

Eventually remove old public `leftTab*` names if we are willing to break API.

---

## Filetree policy

Do not extract Filetree/filesystem as plugin dependency now.

```txt
Filetree stays current/built-in behavior.
Plugins use existing openFile / expandToFile / openPanel flows.
```

---

## Acceptance

```txt
[ ] Specs treat DataExplorer as reusable UI component
[ ] Specs treat DataCatalog as reusable plugin builder, not shell capability
[ ] Boring Macro pattern is preserved: compose DataCatalog builder, own onSelect behavior
[ ] DataCatalog builder gets workspacePage* aliases or direct placement: "workspace-page" support
[ ] No new framework dependency registry is required for Data Catalog phase
[ ] Filetree/filesystem is not extracted as plugin dependency in this phase
```
