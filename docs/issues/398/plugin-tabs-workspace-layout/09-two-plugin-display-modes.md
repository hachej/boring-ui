# 09 — Two Plugin Display Modes

Status: proposed simplification

## Core decision

Support two plugin display modes:

```txt
1. shared-dockview
2. workspace-page
```

These are placement/display modes, not app `mainMode`.

```txt
shared-dockview:
  plugin contributes panels/artifacts/details into the shared workspace Dockview

workspace-page:
  plugin gets a full workspace page slot and owns everything inside it
  phase 1 implementation may be a shared Dockview panel that auto-collapses the current workspace left pane
```

---

## Why this is the right split

Some plugin UI is naturally an artifact/detail panel:

```txt
chart panel
PR detail panel
markdown preview
single visualization
```

Some plugin UI is naturally a full page/app surface:

```txt
Data Explorer/Catalog browser
PR Tracker dashboard
ccusage dashboard
Macro Series browser
Files with filetree + editor, future
```

One model for both creates awkwardness. Two explicit modes keeps it clear.

---

## Public API

Use existing `panels[]` registration with clearer placement names.

```ts
type PluginPanelPlacement =
  | "workspace-page"
  | "shared-dockview"
```

Example full page:

```ts
definePlugin({
  id: "data-catalog",
  panels: [
    {
      id: "data-catalog.page",
      label: "Data Catalog",
      placement: "workspace-page",
      component: DataCatalogPage,
    },
  ],
})
```

Example shared Dockview panel:

```ts
definePlugin({
  id: "macro",
  panels: [
    {
      id: "macro.chart",
      label: "Chart",
      placement: "shared-dockview",
      component: MacroChartPanel,
    },
  ],
})
```

Compatibility mapping:

```txt
workspace-page     -> current shared Dockview host + auto-collapse workspace left pane for now
shared-dockview    -> current shared Dockview host without page auto-collapse for now
```

Old names can be internally supported if needed, but public docs should teach the new names.

---

## UX behavior

### Shared Dockview mode

```txt
plugin page/control can open many panels into shared Dockview
panels can sit beside panels from other plugins
best for artifacts/details/visualizations
```

ASCII:

```txt
┌──── workspace page ────┬──────── shared Dockview ─────────────────────┐
│ Macro Catalog          │ [ Chart: GDPC1 ] [ Chart: CPIAUCSL ]         │
│ Data Explorer          │ [ Markdown Preview ]                         │
└────────────────────────┴──────────────────────────────────────────────┘
```

### Workspace page mode

```txt
plugin owns full page
plugin renders normal React layout
phase 1: current workspace left pane auto-collapses when opened/activated
best for dashboards/browsers/tool surfaces
```

ASCII:

```txt
┌──── workspace page rail/menu ───┬──────── plugin-owned page ──────────┐
│ Data Catalog                    │ search/facets/list/detail           │
│ PR Tracker                      │                                      │
│ Usage                           │                                      │
└─────────────────────────────────┴──────────────────────────────────────┘
```

Future top-level workspace tabs can use the same semantic mode:

```txt
[ Data Catalog ] [ Series: GDPC1 ] [ File: AGENTS.md ]
```

Each `workspace-page` is a plugin instance tab/page.

---

## Agent routing

Surface resolver decides what opens.

```ts
resolve(request) {
  return {
    id: "data-catalog.page",
    component: "data-catalog.page",
    params: { selectedEntryId: request.target },
  }
}
```

The registered component placement decides routing:

```txt
component placement = workspace-page
  focus workspace page and update params

component placement = shared-dockview
  open/focus shared Dockview panel and update params
```

Agent still calls one thing:

```json
{
  "kind": "openSurface",
  "params": {
    "kind": "macro.open-series",
    "target": "GDPC1"
  }
}
```

---

## Boring Macro examples

### Macro Catalog as workspace page

```ts
{
  id: "macro.catalog",
  label: "Macro Catalog",
  placement: "workspace-page",
  component: MacroSeriesCatalogPage,
}
```

This page can use `DataExplorer`.

### Series chart as shared Dockview panel, current phase

```ts
{
  id: "macro.chart",
  label: "Chart",
  placement: "shared-dockview",
  component: MacroChartPanel,
}
```

### Series as workspace page, future phase

Later, if we want `1 tab = 1 plugin instance`:

```ts
{
  id: "macro.series",
  label: "Series",
  placement: "workspace-page",
  component: MacroSeriesPage,
}
```

Resolver can choose the mode by component:

```txt
current:
  macro.open-series -> macro.chart (shared-dockview)

future:
  macro.open-series -> macro.series (workspace-page)
```

---

## Filetree / Files

Current phase:

```txt
Files/filetree remains built-in/current behavior.
```

Future workspace-page phase:

```txt
Files can become workspace-page mode:
  File tab owns filetree + editor
```

Do not do this now.

---

## Rule of thumb

```txt
Use workspace-page when the plugin needs a home/control surface.
Use shared-dockview when the plugin creates artifacts/details/results.
```

Examples:

```txt
Data Catalog browser       -> workspace-page
PR Tracker dashboard       -> workspace-page
ccusage dashboard          -> workspace-page
Macro Catalog browser      -> workspace-page
Macro chart result         -> shared-dockview now; maybe workspace-page later
Markdown preview           -> shared-dockview
Files editor + filetree    -> future workspace-page
```

---

## Acceptance

```txt
[ ] Public docs describe two display modes: workspace-page and shared-dockview
[ ] panels[] placement supports workspace-page
[ ] panels[] placement supports shared-dockview
[ ] workspace-page maps to current workspace page host for now
[ ] shared-dockview maps to current Dockview center host for now
[ ] openSurface routes based on resolved component placement
[ ] No per-plugin Dockview is introduced
```
