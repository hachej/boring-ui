# BI Dashboard Plugin Runtime Plan

## Status

Follow-up plan for `@hachej/boring-bi-dashboard` after the dashboard authoring
skeleton PR. This plan assumes WorkspaceBridge RPC v1 from PR #71 and the new
`@hachej/boring-data-bridge` plugin.

## Goal

Turn agent-authored `boring.generated-pane` JSON specs with `profile: "bi-dashboard"` into live dashboards while keeping
agents and UI components provider-neutral.

The BI dashboard plugin owns dashboard authoring/rendering. It does **not** own
provider credentials, raw SQL execution, BSL server setup, or Perspective server
transport. Those are supplied by data-bridge adapters.

## Current state

The current plugin skeleton provides:

- controlled component catalog:
  - `DashboardGrid`
  - `BSLMetric`
  - `BSLChart`
  - `BSLPerspectiveViewer`
  - `BSLFilter`
  - `BSLText`
- shared generated-pane dashboard TypeScript types
- runtime validation before rendering untyped pane params
- `bi-dashboard-authoring` skill
- workspace-playground eval where the agent simply creates a dashboard

It currently renders placeholders and a query manifest. It does not execute data
queries.

## Non-goals

- Do not add BI-dashboard-specific data endpoints.
- Do not make dashboard specs provider-specific.
- Do not ask agents to write raw React, ECharts, Perspective JS, or SQL.
- Do not duplicate data-bridge adapter logic inside the dashboard plugin.
- Do not require live Perspective server mode for the first runtime version.

## Dashboard contract evolution

Keep the authoring contract high-level:

```json
{
  "kind": "boring.generated-pane",
  "profile": "bi-dashboard",
  "version": 1,
  "title": "Orders Revenue",
  "queries": {
    "revenue_by_month": {
      "id": "revenue_by_month",
      "model": "orders",
      "groupBy": ["month"],
      "measures": ["revenue"]
    }
  },
  "root": "dashboard",
  "elements": {
    "dashboard": { "type": "DashboardGrid", "props": { "columns": 2 }, "children": ["chart"] },
    "chart": {
      "type": "BSLChart",
      "props": { "queryId": "revenue_by_month", "renderer": "echarts", "chartType": "line", "x": "month", "y": "revenue" }
    }
  }
}
```

This query shape compiles to data-bridge query input:

```ts
{
  language: "bsl-dashboard",
  model: "orders",
  groupBy: ["month"],
  measures: ["revenue"]
}
```

The data-bridge dashboard query shape must stay isomorphic with
`BslDashboardQuerySpec`: `filters` are `{ field, op, value }[]`, and `orderBy` is
`[field, direction][]`. The BSL data-bridge adapter can then compile to BSL's
native query string:

```python
sm.group_by("month").aggregate("revenue")
```

Use BSL's existing query-string parser/executor rather than creating a second
BSL execution DSL. Direct `bsl-python` strings are a trusted data-bridge feature,
not what dashboard browser rendering sends by default.

## Runtime architecture

```txt
Dashboard JSON file / pane params
  ↓ validate boring.generated-pane + bi-dashboard profile
BiDashboardPane
  ↓ collect queryIds used by visible components
DataBridge browser/runtime client
  ↓ WorkspaceBridge RPC data.v1.*
DataBridge trusted server plugin
  ↓ per-query source resolution by host config/model id or explicit spec dataSource
  ↓ selected adapter: BSL / DuckDB / Macro / static file
Portable result / Perspective descriptor
  ↓
BSLMetric, BSLChart, BSLPerspectiveViewer render live UI
```

## Data source resolution

Runtime work must choose a deterministic source routing rule before fetching
data. Use this order:

1. Optional future `spec.dataSource` if the dashboard author/host provides one.
2. Host-configured model routing, e.g. `orders -> bsl-main`, `macro_series -> macro`.
3. A single default data-bridge adapter if the host configured exactly one.
4. Otherwise fail closed with an actionable "ambiguous data source" error.

Do not silently try every adapter for live dashboards unless the host explicitly
enables adapter probing for that workspace; probing can leak model names and make
failures non-deterministic. Source resolution is per query, not per dashboard,
because a valid dashboard may combine models routed to different adapters.

## Data access

### Metrics and charts

Use `data.v1.query.run`:

```ts
const query = spec.queries[queryId]
bridge.call("data.v1.query.run", {
  source: resolveDashboardDataSource(spec, query),
  query: compileDashboardQuery(query),
})
```

Return:

```ts
DataBridgeTableResult
```

Rendering rules:

- `BSLMetric`: first row + `valueField`.
- `BSLChart`: rows + declarative chart props → ECharts option generated inside
  plugin.
- `BSLFilter`: updates local dashboard filter state and re-runs affected query
  ids.

### Perspective panels

For plain `workspace-file` dashboard queries, use the file data/Perspective endpoint once available. For semantic, BSL, DuckDB, SQL, or remote-adapter queries, use `data.v1.perspective.prepare`:

```ts
const query = spec.queries[component.props.queryId]
if (query.dataRef?.kind === "workspace-file") {
  fileData.preparePerspective({ path: query.dataRef.path, viewer, transport })
} else {
  bridge.call("data.v1.perspective.prepare", {
  source: resolveDashboardDataSource(spec, query),
  datasetId: component.props.queryId,
  query: compileDashboardQuery(query),
  viewer: {
    plugin: component.props.plugin,
    columns: component.props.columns,
    group_by: component.props.groupBy,
    split_by: component.props.splitBy,
    sort: component.props.sort,
    filter: compilePerspectiveFilters(component.props.filters, activeDashboardFilters),
  },
  transport: {
    preferred: "auto",
    accepted: ["inline", "artifact", "websocket"],
    payloadFormat: "arrow",
    maxInlineBytes: 1_000_000,
  },
  })
}
```

The dashboard advertises supported transports and preferences; the server
selects the actual safe transport. First runtime version may load inline
JSON/Arrow into `@finos/perspective` in browser/WASM; larger static results
should use Arrow artifacts, and live/server mode should use websocket.

Perspective filter mapping is explicit: component `props.filters` and active
`BSLFilter` state are merged as `BslFilterExpression[]`, then converted to
Perspective viewer filters. Scalar comparisons map directly; `in` expands to the
adapter-supported equivalent; `between` maps to two filters (`>=` and `<=`); and
unsupported `contains` behavior must fail visibly instead of being dropped.

Later proper client/server replicated mode follows Perspective's architecture:

```txt
server Perspective table
  ↔ websocket + Arrow deltas
browser Perspective websocket client
  → server_table.view()
  → local WASM worker.table(server_view)
  → <perspective-viewer>.load(client_table)
```

The dashboard plugin should consume a returned descriptor; it should not decide
how the server table is created.

## Frontend components

### `useDashboardData(spec, filters)`

Responsibilities:

- validate spec already passed
- discover query dependencies by component type
- dedupe concurrent requests by query id and filter key
- call data-bridge
- expose `{ dataByQueryId, loadingByQueryId, errorByQueryId, refresh }`

### `BSLMetricRenderer`

- receives `DataBridgeTableResult | undefined`
- formats number/currency/percent
- shows loading/error/empty states

### `BSLChartRenderer`

- receives `DataBridgeTableResult | undefined`
- maps declarative chart props to ECharts options
- keeps chart option generation local and deterministic
- never accepts raw ECharts options from dashboard JSON

### `BSLPerspectiveRuntimeViewer`

- calls `data.v1.perspective.prepare` or consumes prepared descriptor
- supports inline dataset first
- later supports websocket descriptor
- maps camelCase dashboard props to Perspective's `group_by`/`split_by` config

## Server integration

The dashboard plugin should not register its own data handlers. It should depend
on data-bridge being installed by the host. If data-bridge is missing, render a
clear empty state:

```txt
Live data is unavailable because @hachej/boring-data-bridge is not installed.
The dashboard spec is valid and can still be edited.
```

Workspace-playground should install:

```txt
@hachej/boring-bi-dashboard
@hachej/boring-data-bridge
```

and configure data-bridge with a DuckDB/static adapter over fixture CSV files.

BSL-backed apps should configure data-bridge with a BSL adapter using model path
and profile settings.

## Agent skill update

The `bi-dashboard-authoring` skill should stay brief. It should teach:

- create `dashboards/*.dashboard.json`
- use `kind: boring.generated-pane and profile: bi-dashboard`, `version: 1`
- use the controlled components and exact prop names
- author semantic dashboard queries with `model`, `groupBy`, `measures`, etc.
- do not write raw React/ECharts/Perspective

It should not include provider setup details. Provider details belong in a data
source/data-bridge skill if needed.

## Implementation phases

### Phase 0 — Contract validator hardening

- Extend `validateDashboardSpec` before any runtime data execution.
- Validate query `filters`, query `orderBy`, and query `limit` shapes.
- Validate `BSLPerspectiveViewer.props.filters` with the same `BslFilterExpression` rules.
- Add regression tests proving malformed filters/order/limits are rejected before data-bridge compilation.

### Phase 1 — Data-bridge client seam

- Add a tiny dashboard data client abstraction.
- In tests, mock it rather than mocking `fetch` directly.
- Add missing-data empty states.

### Phase 2 — Query execution for metrics/charts

- Compile dashboard query shape to data-bridge `bsl-dashboard` input.
- Fetch `data.v1.query.run` for `BSLMetric` and `BSLChart`.
- Render real metric values.
- Add minimal ECharts runtime for line/bar/heatmap/table, or a placeholder until
  ECharts dependency is explicitly accepted.

### Phase 3 — Filters

- Implement `BSLFilter` state.
- Re-run only target queries.
- Encode filter state in the data-bridge query input.

### Phase 4 — Perspective negotiated runtime

- Add Perspective dependency behind the BI dashboard plugin.
- Call `data.v1.perspective.prepare` with `transport.preferred: "auto"`, accepted transports, payload format, and max inline bytes.
- Load returned inline JSON/Arrow into browser Perspective worker/viewer for small results.
- Load returned Arrow artifacts for larger static results once artifact support exists.

### Phase 5 — Perspective replicated mode

- Accept data-bridge websocket descriptors.
- Use Perspective websocket client + browser WASM replication.
- Keep client/server table lifecycle in data-bridge/Perspective adapter.

### Phase 6 — Evals and validation

- Keep the main eval simple: "Create a BI dashboard...".
- Add separate advanced evals for stress cases, but make them validate generated
  JSON with the shared parser.
- Add runtime tests for invalid specs, data errors, filter updates, and
  Perspective descriptor loading.

## Validation

- `@hachej/boring-bi-dashboard` typecheck/test/build.
- Contract tests for dashboard query compilation.
- Validator tests for query filters/orderBy/limit and Perspective viewer filters.
- Component tests with mocked data-bridge client.
- WorkspaceBridge e2e with data-bridge installed.
- Generated dashboard eval followed by `validateDashboardSpec`.
- Advanced dashboard evals for SaaS, supply chain, finance, and operations.

## Open questions

- Should `dataSource` be added to `BslDashboardSpec` in v1.1, or kept entirely
  host-configured for portability? Runtime v1 should support both explicit and
  host-configured source resolution as described above.
- Which ECharts subset is accepted for v1: line/bar/heatmap/table only, or more?
- Should inline Perspective be allowed for large results, or should data-bridge
  force artifact/websocket above a row threshold?
