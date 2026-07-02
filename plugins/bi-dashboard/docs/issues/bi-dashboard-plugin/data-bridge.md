# Data Bridge Plugin Plan

## Status

Draft plan for a reusable `@hachej/boring-data-bridge` plugin built on top of
WorkspaceBridge RPC v1 from PR #71. This plugin should replace ad-hoc product
bridges such as Macro's custom workspace bridge over time, while keeping the
workspace package domain-neutral.

## Goal

Create a trusted, reusable data-access plugin that exposes stable semantic data
operations through WorkspaceBridge, implemented by provider adapters.

The bridge answers one question:

> Given a semantic data request, which installed adapter can satisfy it safely,
> and what portable result/artifact should the caller receive?

## Non-goals

- Do not add a new generic `/api/data-request/*` HTTP endpoint.
- Do not make `@hachej/boring-workspace` understand SQL, BSL, Macro, or
  Perspective. Plain tabular file parsing should live in a separate server-only
  `@hachej/file-data` package or a deliberately accepted workspace file-data
  module, not inside data-bridge itself.
- Do not expose provider-bound operations such as `clickhouse.v1.query`,
  `duckdb.v1.query`, or `bsl.v1.execute` as the BI/dashboard API.
- Do not let generated/user runtime plugins self-register host bridge handlers.
- Do not make agents generate raw Perspective, ECharts, DuckDB, or ClickHouse
  configs.

## Dependencies

- PR #71 WorkspaceBridge RPC v1:
  - `/api/v1/workspace-bridge/call`
  - registered `workspaceBridgeHandlers`
  - `WorkspaceBridgeClient.fromEnv()` for runtime callers
  - runtime env: `BORING_WORKSPACE_BRIDGE_URL`, `BORING_WORKSPACE_BRIDGE_TOKEN`,
    `BORING_WORKSPACE_ID`, `BORING_AGENT_SESSION_ID`
  - caller classes, capabilities, schema limits, timeouts, idempotency
- BSL's existing LLM query mechanism:
  - `BSLTools.query_model` accepts an Ibis-style BSL query string such as
    `sm.group_by("origin").aggregate("flight_count")`
  - this should be used by the BSL adapter rather than inventing a second JSON
    DSL for BSL execution
- BSL Perspective artifact contract, used by the BSL adapter as an internal/nested payload rather than the top-level WorkspaceBridge response:
  - `kind: bsl.perspective.dataset` for inline data
  - `kind: bsl.perspective.artifact` with `data_ref` for external JSON/Arrow

## Package shape

```txt
plugins/data-bridge/
  package.json
  src/shared/
    contracts.ts
    adapters.ts
    index.ts
  src/server/
    index.ts
    handlers.ts
    registry.ts
    adapters/
      staticFileAdapter.ts
      bslAdapter.ts
      duckdbAdapter.ts
      perspectiveAdapter.ts
  skills/data-bridge-usage/SKILL.md
```

Package name:

```json
"name": "@hachej/boring-data-bridge"
```

The package is primarily a **trusted server plugin**. It may also export shared
client helpers, but the transport is WorkspaceBridge.

## Core contract

### Data bridge request identity

Every data request should be provider-neutral and adapter-routable:

```ts
interface DataBridgeRequestBase {
  requestId?: string
  source?: string        // optional adapter id or logical source id
  workspaceId?: string   // normally inferred by WorkspaceBridge context
}
```

The caller may set `source` when the dashboard/model knows a logical source
(`bsl`, `playground`, `macro`). If omitted, the bridge asks adapters whether they
can satisfy the request.

### Portable tabular result

```ts
interface DataBridgeColumn {
  name: string
  type: "string" | "integer" | "float" | "boolean" | "date" | "datetime" | "json"
  role?: "dimension" | "measure" | "time" | "unknown"
}

interface DataBridgeTableResult {
  kind: "data-bridge.table"
  version: 1
  columns: DataBridgeColumn[]
  rows: Record<string, unknown>[]
  rowCount: number
  truncated?: boolean
  source?: string
}
```

### Semantic BSL query request

Prefer BSL's existing Python/Ibis-style query string mechanism:

```ts
interface DataBridgeSemanticQuery {
  language: "bsl-python"
  model: string
  query: string // e.g. 'sm.group_by("month").aggregate("revenue")'
  parameters?: Record<string, unknown>
  limit?: number
}
```

Direct `language: "bsl-python"` is **not** the default browser/runtime dashboard
path. It is a code-like semantic query language and must be separately gated:

- allowed caller classes: `server` and trusted `runtime` only by default
- required capability: `data:bsl-query-string` in addition to `data:read`
- never accepted from generic browser dashboard rendering calls
- parsed/validated by the BSL adapter before execution; unsupported names,
  imports, attributes outside the BSL query surface, multi-statements, and file/OS
  access are rejected

Dashboard/browser usage should send `language: "bsl-dashboard"`; the trusted BSL
adapter compiles that safe structured query into the native BSL query-string path.

### Dashboard query request

For agent-authored dashboards, keep the high-level shape and compile in the
adapter/plugin layer:

```ts
interface DataBridgeFilterExpression {
  field: string
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "contains" | "between"
  value: unknown
}

type DataRef =
  | { kind: "workspace-file"; path: string; fileFormat?: "csv" | "json" | "ndjson" | "parquet" | "arrow"; limit?: number }
  | { kind: "duckdb-file"; path: string; table?: string }
  | { kind: "sqlite-file"; path: string; table?: string }
  | { kind: "semantic-model"; model: string }

interface DataBridgeDashboardQuery {
  language: "bsl-dashboard"
  model: string
  dataRef?: DataRef
  groupBy?: string[]
  measures?: string[]
  dimensions?: string[]
  filters?: DataBridgeFilterExpression[]
  orderBy?: Array<[field: string, direction: "asc" | "desc"]>
  limit?: number
}
```

The BSL adapter compiles this to the BSL query string form, for example:

```txt
sm.group_by("month", "region").aggregate("revenue", "order_count")
```

This keeps dashboard specs easy for agents while still using BSL's real query
mechanism under the hood. The `filters` and `orderBy` shapes intentionally match
`BslDashboardQuerySpec` so the BI dashboard compiler is lossless. Filter mapping
is explicit: `eq/neq/gt/gte/lt/lte` compile to scalar comparisons, `in` compiles
to membership, `contains` compiles to the adapter's supported string contains
operation, and `between` requires a two-value tuple/array and compiles to
`gte && lte`.

## WorkspaceBridge operations

Use stable `data.v1.*` operation names. These are not provider actions; they are
semantic data bridge capabilities implemented by adapters.

### `data.v1.catalog.search`

Search available datasets/models/series.

```ts
input: {
  source?: string
  query: string
  limit?: number
  filters?: Record<string, string | string[]>
}
output: {
  items: Array<{ id: string; title: string; subtitle?: string; source?: string; tags?: string[] }>
  total?: number
  hasMore?: boolean
}
```

### `data.v1.dataset.preview`

Preview a dataset by id/path/model without requiring a semantic query.

```ts
input: { source?: string; datasetId: string; limit?: number; offset?: number }
output: DataBridgeTableResult
```

### `data.v1.query.run`

Run a semantic query and return tabular data.

```ts
interface DataBridgeSqlQuery {
  language: "sql"
  dialect: "duckdb" | "sqlite" | string
  sql: string
  dataRef?: Extract<DataRef, { kind: "duckdb-file" | "sqlite-file" }>
  limit?: number
}

input: {
  source?: string
  query: DataBridgeDashboardQuery | DataBridgeSemanticQuery | DataBridgeSqlQuery
}

`DataBridgeSemanticQuery` and `DataBridgeSqlQuery` require handler-level caller/capability checks in addition to the operation definition. Because WorkspaceBridge capabilities are declared per operation, `data.v1.query.run` must still inspect `input.query.language` and reject `bsl-python` unless `context.callerClass` is trusted and `context.capabilities` includes `data:bsl-query-string`. Direct SQL requires a separate `data:sql-query` capability unless the adapter compiles from the safe `bsl-dashboard` shape. Browser dashboard callers are restricted to `DataBridgeDashboardQuery`.
output: DataBridgeTableResult
```

### `data.v1.perspective.prepare`

Prepare a Perspective-compatible dataset or server table descriptor from a
semantic query. The consumer advertises acceptable transports; the server chooses
the safe concrete transport. Keep this descriptor shape aligned with
`plugins/bi-dashboard/docs/issues/bi-dashboard-plugin/data-access-unification.md`.

```ts
type DataTransport = "inline" | "artifact" | "websocket"
type PreferredDataTransport = "auto" | DataTransport
type PayloadFormat = "arrow" | "json"

interface PerspectiveViewerConfig {
  plugin?: string
  columns?: string[]
  group_by?: string[]
  split_by?: string[]
  sort?: Array<[string, "asc" | "desc"]>
  filter?: unknown[][]
  aggregates?: Record<string, string>
}

input: {
  source?: string
  datasetId?: string
  query: DataBridgeSemanticQuery | DataBridgeDashboardQuery | DataBridgeSqlQuery
  viewer?: PerspectiveViewerConfig
  transport?: {
    preferred?: PreferredDataTransport
    accepted: DataTransport[]
    payloadFormat?: PayloadFormat
    maxInlineBytes?: number
  }
}
output: {
  kind: "data-bridge.perspective"
  version: 1
  transport: DataTransport
  payloadFormat: PayloadFormat
  schema?: DataBridgeColumn[]
  rowCount?: number
  source?: string
  viewer?: PerspectiveViewerConfig
  inline?: { bytes?: number; data?: unknown; base64?: string }
  artifact?: { url: string; contentType: string; expiresAt?: string; bytes?: number }
  websocket?: { url: string; protocol: "perspective" | "data-bridge-arrow-delta"; sessionId: string }
}
```

Start with inline JSON/Arrow for small results, add artifact Arrow for larger
static results, and add websocket when a Perspective server runtime is
available.

## Adapter API

```ts
interface DataBridgeAdapter {
  id: string
  label: string
  capabilities: {
    catalog?: boolean
    datasetPreview?: boolean
    semanticQuery?: boolean
    perspective?: boolean
  }

  canHandle(input: unknown, context: DataBridgeContext): boolean | Promise<boolean>
  searchCatalog?(input: CatalogSearchInput, context: DataBridgeContext): Promise<CatalogSearchOutput>
  previewDataset?(input: DatasetPreviewInput, context: DataBridgeContext): Promise<DataBridgeTableResult>
  runQuery?(input: QueryRunInput, context: DataBridgeContext): Promise<DataBridgeTableResult>
  preparePerspective?(input: PerspectivePrepareInput, context: DataBridgeContext): Promise<PerspectivePrepareOutput>
}
```

Adapters are explicitly installed by host/trusted plugins. Provider-specific
credentials stay inside adapters.

## Initial adapters

1. **Static/workspace file adapter**
   - CSV/JSON/NDJSON preview and small dashboard aggregations delegate to the
     shared `@hachej/file-data` implementation used by `/api/v1/files/records`.
   - Never parse CSV/JSON independently and never read raw `workspaceRoot` paths
     directly; use workspace adapter/file-data semantics.
   - Useful for playground/evals and dashboards over local artifacts.

2. **DuckDB adapter**
   - Read-only SQL over registered workspace datasets.
   - This adapter may support `language: "sql"` internally, but BI dashboard
     should prefer semantic/dashboard query inputs.

3. **BSL adapter**
   - Executes BSL via existing `BSLTools`/query-string machinery.
   - Accepts `language: "bsl-dashboard"` from normal dashboard/browser calls.
   - Accepts direct `language: "bsl-python"` only after the handler checks
     caller class and `data:bsl-query-string` capability.
   - Compiles `language: "bsl-dashboard"` into BSL query strings.
   - Can produce Perspective inline/artifact outputs using BSL's Perspective
     helpers.

4. **Macro adapter**
   - Wraps Macro's catalog/search/series services behind `data.v1.*` ops.
   - Migration target for Macro's custom `/api/macro/workspace-bridge/call`.

5. **Perspective adapter/decorator**
   - Converts `DataBridgeTableResult` or BSL result into
     `bsl.perspective.dataset`/artifact.
   - Later owns server-side Perspective table registry and websocket descriptor.

## Security and safety

- Register handlers via `workspaceBridgeHandlers` only from trusted server
  plugins.
- Operation definitions set small defaults and explicit max output sizes.
- Runtime calls require `data:read` or narrower capabilities.
- Mutating or artifact-writing operations require idempotency keys.
- No raw provider credentials in bridge inputs/outputs/logs.
- No arbitrary filesystem paths from runtime callers; use workspace-relative ids
  and existing file validation.
- SQL support, where present, is adapter-local and read-only; not part of the
  BI dashboard contract.

## Implementation phases

### Phase 1 — Contracts and in-memory registry

- Add package scaffold.
- Define shared contracts and adapter API.
- Add server registry with deterministic adapter selection.
- Unit-test schema validation, adapter precedence, and error envelopes.

### Phase 2 — WorkspaceBridge handlers

- Register `data.v1.catalog.search`, `data.v1.dataset.preview`, and
  `data.v1.query.run` through `workspaceBridgeHandlers`.
- Use PR #71 `defineTrustedDomainBridgeHandler` if available.
- Add an e2e smoke similar to PR #71 `bridge-e2e.ts`.

### Phase 3 — BSL adapter

- Add compiler from dashboard query shape to BSL query string.
- Add a BSL adapter that executes BSL's native tool/query mechanism.
- Gate direct `language: "bsl-python"` calls behind `data:bsl-query-string` and
  trusted caller classes.
- Validate both direct and generated query strings against an allowlist-style
  parser/builder; never concatenate unchecked user code.

### Phase 4 — Perspective prepare

- Add `data.v1.perspective.prepare`.
- Public output is the `data-bridge.perspective` descriptor. BSL
  `bsl.perspective.dataset` / `bsl.perspective.artifact` objects may appear as
  adapter-internal payloads inside `inline.data` or artifact metadata, but are
  not the top-level WorkspaceBridge output.
- Return inline JSON/Arrow first for small results.
- Add artifact mode when file outputs are needed.
- Defer Perspective websocket server replication until the dataset path is
  stable.

### Phase 5 — Macro/playground migrations

- Adapt playground CSV data and Macro services to data-bridge adapters.
- Keep old Macro routes temporarily as compatibility shims.
- Move dashboard/data-explorer consumers to `data.v1.*` calls.

## Validation

- Unit tests for contracts, adapter registry, and handlers.
- WorkspaceBridge e2e with browser and runtime caller classes.
- BSL adapter tests using a tiny semantic model and query string:
  `sm.group_by("month").aggregate("revenue")`.
- Perspective prepare tests validating the public `data-bridge.perspective` descriptor and, for the BSL adapter, the nested BSL Perspective payload shape.
- Security tests: untrusted plugin cannot register handlers; runtime caller
  without capability is rejected; oversize output is rejected.

## Open questions

- Should direct SQL be exposed to browser callers with `data:sql-query`, or restricted to runtime/server callers only?
- Should Perspective websocket mode live in data-bridge or a separate
  `perspective-bridge` adapter package?
- How should BSL model/profile discovery be configured in child apps?
