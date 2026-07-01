---
description: Create or edit BSL BI dashboard JSON specs for the BI Dashboard plugin.
---

# bi-dashboard-authoring

Use this skill when the user asks to create, edit, or open a BI dashboard for
`@hachej/boring-bi-dashboard`.

## Files

- write dashboard specs as JSON files under `dashboards/`
- use the suffix `.dashboard.json`
- after writing or editing a dashboard, call WorkspaceBridge op `bi-dashboard.v1.validate` with `{ "path": "dashboards/name.dashboard.json" }`; fix error diagnostics before presenting it
- when the user asks to open or view the dashboard and `exec_ui` is available,
  open the file with:

```json
{
  "kind": "openSurface",
  "params": {
    "kind": "workspace.open.path",
    "target": "dashboards/example.dashboard.json"
  }
}
```

## Contract

Write provider-neutral BSL dashboard specs. Do not write React. Do not write raw
ECharts or raw Perspective configs.

Use this top-level shape:

```json
{
  "kind": "boring.generated-pane",
  "profile": "bi-dashboard",
  "version": 1,
  "title": "Dashboard title",
  "queries": {
    "query_id": {
      "id": "query_id",
      "model": "orders",
      "groupBy": [],
      "measures": []
    }
  },
  "root": "dashboard",
  "elements": {
    "dashboard": {
      "type": "DashboardGrid",
      "props": { "columns": 2 },
      "children": []
    }
  }
}
```

## Components

Use only these component types and prop names:

- `DashboardGrid` — layout container with string `children`; optional `props.columns` must be one of `1`, `2`, `3`, `4`, `6`, or `12`
- `BSLMetric` — KPI card; requires `props.queryId`, `props.label`, and `props.valueField`; optional `props.format` is `number`, `currency`, or `percent`
- `BSLChart` — Perspective-backed chart; requires `props.queryId` and `props.chartType`; allowed chart types are `bar`, `line`, `area`, `scatter`, `heatmap`, `treemap`, `sunburst`, and `table`; use `props.x` only for the category/grouping axis and `props.y` only for numeric measure series; do not include the x/category field as a measure/series; optional `props.color` is allowed (not `xField`, `yField`, or `yFields`)
- `BSLPerspectiveViewer` — exploratory table/pivot; use `props.plugin: "Datagrid"` for detail tables; optional `props.columns`, `props.groupBy`, and `props.splitBy` are string arrays; optional `props.sort` is an array of `[field, "asc" | "desc"]` tuples
- `BSLFilter` — filter control targeting one or more query IDs; requires `props.id`, `props.field`, `props.controlType`, and `props.targetQueries`; `controlType` is `select`, `multiSelect`, `dateRange`, `numberRange`, or `search`
- `BSLText` — markdown notes or section text; requires `props.markdown`

## Authoring rules

- put filters/controllers first, then KPI metrics, then charts, then detail/Perspective tables
- keep 2–4 top metrics and avoid clutter; prefer clear titles and business labels
- use Perspective mainly for drill-down tables/pivots, not for every chart
- every component ID referenced in `children` must exist in `elements`
- every `queryId` and filter `targetQueries` entry must exist in `queries`
- use the exact validated prop names above; avoid invented aliases such as `xField`, `yField`, or `yFields`
- keep the spec concise and readable
- choose sensible query IDs and component IDs from the dashboard domain
- prefer semantic BSL fields such as `revenue`, `order_count`, `month`, `region`,
  `customer_id`, and `cohort_month` over UI-specific names
