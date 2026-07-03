---
description: Create or edit BSL BI dashboard JSON specs for the BI Dashboard plugin.
---

# bi-dashboard-authoring

Use this skill when the user asks to create, edit, or open a BI dashboard for
`@hachej/boring-bi-dashboard`.

## Files

- write dashboard specs as JSON files under `dashboards/`
- use the suffix `.dashboard.json`
- after writing or editing a dashboard, read the JSON you wrote and call WorkspaceBridge op `bi-dashboard.v1.validate` with `{ "spec": <dashboard-json> }`; fix error diagnostics before presenting it
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
    "revenue_by_region": {
      "id": "revenue_by_region",
      "source": "default",
      "sql": "SELECT region, sum(revenue) AS revenue FROM orders GROUP BY region ORDER BY revenue DESC",
      "limit": 1000
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

- `DashboardGrid` — layout container with string `children`; optional `props.columns` must be one of `1`, `2`, `3`, `4`, `5`, `6`, or `12`
- `BSLMetric` — KPI card; requires `props.queryId`, `props.label`, and `props.valueField`; optional `props.format` is `number`, `currency`, or `percent`
- `BSLChart` — native OpenUI/shadcn-style chart by default; requires `props.queryId` and `props.chartType`; `props.chartType` must be exactly one of `bar`, `line`, `area`, `scatter`, `radar`, `radial`, `pie`, `donut`, `heatmap`, `treemap`, `sunburst`, or `table`; never use `gauge`, `histogram`, or other chart types; use `props.renderer: "perspective"` only for advanced manipulation; use `props.x` only for the category/grouping axis and `props.y` only for numeric measure series; do not include the x/category field as a measure/series; optional `props.color` is allowed (not `xField`, `yField`, or `yFields`)
- `BSLPerspectiveViewer` — exploratory table/pivot; use `props.plugin: "Datagrid"` for detail tables; optional `props.columns`, `props.groupBy`, and `props.splitBy` are string arrays; optional `props.sort` is an array of `[field, "asc" | "desc"]` tuples
- `BSLFilter` — filter control targeting one or more query IDs; requires `props.id`, `props.field`, `props.controlType`, and `props.targetQueries`; `controlType` is `select`, `multiSelect`, `dateRange`, `numberRange`, or `search`
- `BSLText` — markdown notes or section text; requires `props.markdown`

## Authoring rules

- put filters/controllers first, then KPI metrics, then charts, then detail/Perspective tables
- layout rule: compact KPI/indicator-only sections may use `props.columns` from 1–5, but any grid containing charts, line charts, bar charts, tables, or exploratory/Perspective views must use `props.columns: 1` or `props.columns: 2` so charts are never denser than two per row
- keep 2–4 top metrics and avoid clutter; prefer clear titles and business labels
- use Perspective mainly for drill-down tables/pivots, not for every chart
- every component ID referenced in `children` must exist in `elements`
- every `queryId` and filter `targetQueries` entry must exist in `queries`
- use the exact validated prop names above; avoid invented aliases such as `xField`, `yField`, or `yFields`
- before writing the final dashboard JSON, self-check every `BSLChart.props.chartType` against the exact allowed enum; use `pie`/`donut` only for small share-of-total charts
- keep the spec concise and readable
- choose sensible query IDs and component IDs from the dashboard domain
- SQL dashboard queries use `{ "id", "source", "sql", "params", "limit" }`; BSL dashboard queries use `{ "id", "model", "query", "limit" }`; do not invent `language`, `groupBy`, or `measures` fields in dashboard JSON
- prefer semantic fields such as `revenue`, `order_count`, `month`, `region`,
  `customer_id`, and `cohort_month` over UI-specific names
