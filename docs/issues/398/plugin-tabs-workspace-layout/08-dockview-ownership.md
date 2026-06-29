# 08 — Dockview Ownership

Status: phase-specific design decision

## Phase distinction

There are two different worlds:

```txt
Phase 1/current workspace:
  current workspace rail/menu + shared Dockview panel area

Phase 3/future workspace-tabs:
  1 top-level workspace tab = 1 plugin instance
```

Do not mix those two models in one implementation.

---

## Phase 1/current decision

Do **not** create one Dockview per plugin.

Keep one shared workspace Dockview/surface for panels/artifacts while we are still using the current workspace rail/menu.

```txt
GOOD for current phase:
  one workspace Dockview shared by plugins
  plugins contribute pages and panels
  plugin pages can open panels into shared Dockview

BAD:
  plugin A owns nested Dockview
  plugin B owns nested Dockview
  plugin C owns nested Dockview
```

Nested Dockviews would create focus, persistence, drag/drop, command routing, and agent-state complexity.

---

## Phase 1 mental model

A plugin can contribute two different kinds of UI:

```txt
workspace-page:
  plugin-owned full page/control surface
  regular React layout
  phase 1 can be hosted as a shared Dockview panel with current workspace left pane auto-collapsed
  not a plugin-owned Dockview host

workspace-panel:
  artifact/detail/editor/chart panel opened in the shared Dockview
  shared by all plugins
```

ASCII:

```txt
┌──── workspace page rail/menu ───┬──── plugin page ────┬──── shared Dockview ────┐
│ Files                           │ Data Catalog        │ Chart: GDPC1            │
│ Data Catalog                    │ search/facets/list  │ PR Detail #123          │
│ PR Tracker                      │                     │ Markdown Preview        │
└─────────────────────────────────┴─────────────────────┴────────────────────────┘
```

The plugin owns the page content. The current workspace owns the Dockview.

---

## Registration model

### Workspace page

```ts
{
  id: "data-catalog.page",
  label: "Data Catalog",
  placement: "workspace-page",
  component: DataCatalogPage,
}
```

### Shared Dockview panel

```ts
{
  id: "macro.chart",
  label: "Chart",
  placement: "center",
  component: MacroChartPanel,
}
```

Both use the same `panels[]` registration path. Placement decides host.

---

## Plugin page opens shared panels

Example: Macro page owns the catalog/list UI, then opens chart panels into shared Dockview.

```tsx
function MacroSeriesPage({ containerApi }: PaneProps<LeftTabParams>) {
  return (
    <DataExplorer
      adapter={macroAdapter}
      onActivate={(row) => {
        containerApi.addPanel({
          id: `chart:${row.id}`,
          component: "macro.chart",
          title: row.title,
          params: { seriesId: row.id },
        })
      }}
    />
  )
}
```

Equivalent agent-driven path:

```txt
exec_ui openSurface kind=macro.open-series target=GDPC1
  -> macro surface resolver
  -> shared Dockview panel chart:GDPC1
```

---

## Phase 1 routing rule

When a UI command resolves to a registered panel, the shell routes by placement:

```txt
placement: "workspace-page"
  open/focus shared Dockview panel for now
  auto-collapse current workspace left pane on open/activation
  update page params if same page already open

placement: "shared-dockview" / "center" or other Dockview placement
  open/focus shared Dockview panel without page auto-collapse
  update panel params if same id already open
```

This keeps one API and one Dockview for the current workspace.

---

## Phase 3/future workspace-tabs model

In the future model, the semantic invariant changes:

```txt
1 top-level workspace tab = 1 plugin instance
```

Examples:

```txt
[ File: AGENTS.md ]
  Files plugin instance
  owns filetree + editor for that file/current selection

[ Macro Catalog ]
  Macro/DataExplorer plugin instance
  owns catalog browsing UI

[ Series: GDPC1 ]
  Macro plugin instance for one selected series
  owns chart/details for GDPC1

[ PR Tracker ]
  PR plugin instance
  owns PR list/detail UI
```

In that world, Files and Series do not share a visible global Dockview panel area as peers inside one workbench. They are sibling top-level plugin instances.

```txt
┌────────────────────────────────────────────────────────────────────┐
│ [ File: AGENTS.md ] [ Macro Catalog ] [ Series: GDPC1 ] [ + ]      │
├────────────────────────────────────────────────────────────────────┤
│ active plugin instance owns everything inside this area             │
└────────────────────────────────────────────────────────────────────┘
```

A plugin instance may still render internal splits/lists/details itself. But the shell-level navigation is top-level plugin instances, not a shared pool of Dockview panels.

---

## Agent UI capability rule

A plugin surface resolver can target either:

```txt
workspace page:
  open/focus plugin page and update params, e.g. selectedEntryId

shared Dockview panel:
  open/focus artifact/detail panel, e.g. chart:GDPC1
```

Examples:

```txt
data-catalog.entry:
  could focus data-catalog.page and set selectedEntryId

macro.open-series:
  opens shared Dockview chart panel
```

Both use `exec_ui openSurface`; resolver output + registered placement decides routing.

---

## What happens to Dockview in phase 3?

Dockview may still be used internally as an implementation detail for top-level workspace tabs, but the user/agent semantic model should be plugin instances.

```txt
Do not expose:
  global shared Dockview panel pool + plugin instance tabs at the same time

Do expose:
  top-level workspace tabs representing plugin instances
```

If a specific plugin wants split panes inside its own instance, it can render its own layout. It should not expect the shell shared Dockview to be its internal navigation surface.

## When would a plugin own its own Dockview?

Almost never.

Only allow as an escape hatch if a plugin is itself a full IDE-like app and accepts responsibility for:

```txt
- its own persistence
- its own focus model
- its own keyboard shortcuts
- its own drag/drop behavior
- no expectation that agent get_ui_state sees inner tabs automatically
```

This is not the default and not a framework feature for this project phase.

---

## Acceptance

```txt
[ ] There is one shared workspace Dockview/surface
[ ] Plugins register workspace pages with placement: "workspace-page"
[ ] Plugins register shared Dockview panels with placement: "center" or existing Dockview placements
[ ] openPanel/openSurface route by registered panel placement
[ ] Plugin pages can open shared Dockview panels through containerApi/openSurface
[ ] No per-plugin Dockview is introduced by default
```
