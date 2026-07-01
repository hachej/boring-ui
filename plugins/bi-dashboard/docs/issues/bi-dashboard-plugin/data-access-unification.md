# Data Access Unification Plan

## Status

Draft plan. This plan supersedes the current split-brain prototype where:

- `@hachej/boring-data-bridge` parses workspace CSV/JSON/NDJSON files itself.
- BI dashboard falls back to `/api/v1/files/records` and repeats aggregation in the browser.
- Perspective-like panels render JSON rows in an HTML table instead of using a real Perspective/Arrow preparation path.

## Goal

Unify local file data, semantic queries, database-backed queries, DuckDB workspace files, and Perspective preparation behind a clean set of responsibilities:

1. **Workspace file APIs own file-backed tabular reads.**
2. **`data-bridge` owns semantic/query execution and adapter routing.**
3. **Perspective consumers negotiate transport; server selects the safe transport.**
4. **DuckDB/SQLite workspace files are file-backed databases: preview via file API, query via data bridge.**

The end state should make dashboards, data explorer, agents, and future report/notebook plugins share one data model instead of each plugin inventing its own CSV parser, query runner, or Perspective loader.

## Current Findings

### Existing `/api/v1/files/records`

Implemented in:

- `packages/agent/src/server/http/routes/file.ts`
- `packages/agent/src/server/http/routes/fileRecords.ts`

Current behavior:

- Supports JSON array, NDJSON/JSONL, and CSV.
- Accepts `path`, `offset`, `limit`, `q`.
- Enforces maximum file bytes, output bytes, row scan limits, returned row limits, column sampling limits.
- Uses the workspace adapter (`workspace.stat`, `workspace.readFile`) rather than raw filesystem paths.
- Returns:

```ts
interface FileRecordsResult {
  source: { kind: "file"; path: string; format: "json-array" | "ndjson" | "csv" }
  path: string
  format: string
  columns: { name: string; type: string }[]
  rows: Record<string, unknown>[]
  total: number
  hasMore: boolean
  offset: number
  limit: number
  mtimeMs?: number
}
```

### Current `data-bridge` prototype

Implemented in:

- `plugins/data-bridge/src/server/index.ts`

Current behavior:

- Registers `data.v1.query.run` through WorkspaceBridge.
- Has a workspace-file adapter that reads files directly from `workspaceRoot`.
- Has its own CSV/JSON/NDJSON parsing and aggregation.
- Has BSL subprocess execution.
- Has realpath containment checks, but still duplicates file API behavior.

### Current BI dashboard runtime

Implemented in:

- `plugins/bi-dashboard/src/front/dashboardData.ts`

Current behavior:

- Calls `data.v1.query.run` first for each dashboard query.
- Falls back to `/api/v1/files/records` if bridge fails and `dataRef.kind === "workspace-file"`.
- Browser fallback pages file records and aggregates client-side.
- `BSLPerspectiveViewer` renders a plain table from JSON rows.

## Architecture Decision

### Responsibility Split

| Data/source shape | Owner | API |
| --- | --- | --- |
| Plain workspace CSV/JSON/NDJSON | workspace file subsystem | `/api/v1/files/records` and future file data endpoints |
| Plain workspace Parquet/Arrow | workspace file subsystem | future `/api/v1/files/data`/`arrow`/`perspective` endpoints |
| DuckDB/SQLite file preview | workspace file subsystem | future preview endpoints |
| DuckDB/SQLite query execution | `data-bridge` adapter | `data.v1.query.run` |
| BSL semantic model query | `data-bridge` adapter | `data.v1.query.run` |
| Remote DB/warehouse query | `data-bridge` adapter | `data.v1.query.run` |
| Perspective-ready data | negotiated server operation | file API for local files, `data.v1.perspective.prepare` for query/adapters |

### Why not put everything in file APIs?

File APIs should answer: “read this workspace file as data.”

They should not become a general SQL/BSL/warehouse execution surface. Query execution needs adapter policy, credentials, trusted callers, timeouts, capabilities, and runtime tokens. That belongs in `data-bridge`.

### Why not put workspace-file reads only in `data-bridge`?

Because `/api/v1/files/records` already exists, is paginated, enforces file limits, uses the workspace adapter abstraction, and is useful outside BI dashboards. Duplicating CSV/JSON parsing in `data-bridge` creates inconsistent semantics and security drift.

## Target APIs

## 1. File Records API: keep and extract shared implementation

Keep existing HTTP endpoint:

```http
GET /api/v1/files/records?path=data.csv&offset=0&limit=100&q=engineer
```

Extract the core logic into a reusable server module that can be called by both HTTP routes and trusted server plugins.

Suggested package location:

```txt
packages/file-data/src/server/
  records.ts          // parser + paging + type inference, no Fastify
  workspaceRecords.ts // workspace adapter integration
  formats/
    csv.ts
    json.ts
    ndjson.ts
  leases.ts           // read-only local materialization for DB files
```

The reusable implementation must live in a domain-neutral server-only package, **not** in `@hachej/boring-agent/server` and preferably not in workspace core unless the team explicitly decides that tabular workspace-file parsing is part of the workspace file subsystem. Recommended package: `@hachej/file-data` under `packages/file-data/`.

Rationale: `@hachej/boring-data-bridge` is a workspace server plugin; making it depend on the agent HTTP layer would couple reusable data adapters to the host app/agent package. Conversely, making `@hachej/boring-workspace` understand CSV/Arrow/Perspective risks violating the workspace package's domain-neutral boundary. A small server-only file-data package lets the agent route, workspace file APIs, and data-bridge share implementation without teaching workspace about BSL/SQL/Perspective.

Public/server exports from `@hachej/file-data/server`:

```ts
export async function readWorkspaceFileRecords(args: {
  workspace: WorkspaceFileAdapter
  path: string
  offset?: number
  limit?: number
  q?: string | null
  maxFileBytes?: number
  maxRowsScanned?: number
}): Promise<FileRecordsResult>

export function buildFileRecordsResult(args: {
  path: string
  content: string
  mtimeMs?: number
  offset: number
  limit: number
  q: string | null
}): FileRecordsResult
```

Then move both the HTTP route and data-bridge adapter to use this same implementation.

Acceptance:

- Existing `/api/v1/files/records` tests remain green.
- `data-bridge` no longer contains a separate CSV parser.
- BI dashboard fallback and bridge produce the same rows/columns for the same workspace file.

## 2. File data negotiation API

Add a file-centric endpoint for tabular data transport negotiation.

Preferred shape:

```http
GET /api/v1/files/data?path=data.csv&representation=records&offset=0&limit=100
GET /api/v1/files/data?path=data.parquet&representation=arrow
GET /api/v1/files/data?path=data.csv&representation=perspective&transport.preferred=auto
```

Alternative: separate endpoints:

```http
GET /api/v1/files/records
GET /api/v1/files/arrow
GET /api/v1/files/perspective
```

Recommendation: use one negotiated endpoint once we add Arrow/Perspective, but keep `/records` as a stable compatibility endpoint.

Request:

```ts
type FileDataRepresentation = "records" | "arrow" | "perspective"
type DataTransport = "inline" | "artifact" | "websocket"
type PreferredDataTransport = "auto" | DataTransport
type PayloadFormat = "arrow" | "json"

interface FileDataRequest {
  path: string
  representation?: FileDataRepresentation
  transport?: {
    preferred?: PreferredDataTransport
    accepted?: DataTransport[] // never includes "auto"
    payloadFormat?: PayloadFormat
    maxInlineBytes?: number
  }
  offset?: number
  limit?: number
  q?: string
  table?: string // source-specific preview selector for DB-like files; no arbitrary SQL
  sheet?: string // future spreadsheet selector
}
```

Response variants:

```ts
type FileDataResponse =
  | FileRecordsResult
  | FileArrowResponse
  | FilePerspectiveResponse
```

Arrow response:

```ts
interface InlinePayloadDescriptor {
  bytes?: number
  data?: unknown
  base64?: string
}

interface ArtifactPayloadDescriptor {
  url: string
  contentType: string
  expiresAt?: string
  bytes?: number
}

interface FileArrowResponse {
  kind: "workspace-file.arrow"
  version: 1
  transport: "inline" | "artifact"
  payloadFormat: "arrow"
  contentType: "application/vnd.apache.arrow.file" | "application/vnd.apache.arrow.stream"
  inline?: InlinePayloadDescriptor
  artifact?: ArtifactPayloadDescriptor
  schema?: Array<{ name: string; type: string }>
  rowCount?: number
  source: { kind: "file"; path: string; fileFormat: string }
}
```

File Perspective response:

```ts
interface FilePerspectiveResponse {
  kind: "workspace-file.perspective"
  version: 1
  transport: DataTransport
  payloadFormat: PayloadFormat
  schema?: Array<{ name: string; type: string }>
  rowCount?: number
  source: { kind: "file"; path: string; fileFormat: string }
  inline?: InlinePayloadDescriptor
  artifact?: ArtifactPayloadDescriptor
  websocket?: { url: string; protocol: "perspective" | "data-bridge-arrow-delta"; sessionId: string }
  viewer?: PerspectiveViewerConfig
}
```

## 3. Data bridge query API

Keep:

```ts
data.v1.query.run
```

Use it for:

- BSL semantic queries.
- Remote DB/warehouse queries.
- DuckDB/SQLite file-backed queries.
- Structured dashboard queries over queryable sources.

Do **not** use it as the primary implementation for plain CSV/JSON file previews. If a dashboard query points directly at a plain workspace file, the bridge may delegate to shared file-record services internally, but the canonical file data surface remains the file API.

Request direction:

```ts
type DataRef =
  | { kind: "workspace-file"; path: string; fileFormat?: "csv" | "json" | "ndjson" | "parquet" | "arrow"; limit?: number }
  | { kind: "duckdb-file"; path: string; table?: string }
  | { kind: "sqlite-file"; path: string; table?: string }
  | { kind: "semantic-model"; model: string }

interface DataBridgeQueryRunInput {
  source?: string
  query:
    | DataBridgeDashboardQuery
    | DataBridgeSemanticQuery
    | DataBridgeSqlQuery
}

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

Response remains:

```ts
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

Important: `data.v1.query.run` should generally return small/medium aggregated JSON table results for metrics/charts. Large raw datasets should not come through this path for visualization.

## 4. Data bridge Perspective prepare API

Add:

```ts
data.v1.perspective.prepare
```

This is the query/adapter equivalent of file perspective preparation. It handles BSL, DuckDB, SQL, remote DB, or any adapter-backed source.

Request:

```ts
type DataTransport = "inline" | "artifact" | "websocket"
type PreferredDataTransport = "auto" | DataTransport
type PayloadFormat = "arrow" | "json"

interface PerspectiveViewerConfig {
  plugin?: "Datagrid" | "Y Line" | "X Bar" | string
  columns?: string[]
  group_by?: string[]
  split_by?: string[]
  sort?: Array<[string, "asc" | "desc"]>
  filter?: unknown[][]
  aggregates?: Record<string, string>
}

interface DataBridgePerspectivePrepareInput {
  source?: string
  datasetId?: string
  query: DataBridgeQueryRunInput["query"]
  viewer?: PerspectiveViewerConfig
  transport?: {
    preferred?: PreferredDataTransport
    accepted: DataTransport[] // never includes "auto"
    payloadFormat?: PayloadFormat
    maxInlineBytes?: number
  }
}
```

Response:

```ts
interface DataBridgePerspectiveResult {
  kind: "data-bridge.perspective"
  version: 1
  transport: DataTransport
  payloadFormat: PayloadFormat
  schema?: DataBridgeColumn[]
  rowCount?: number
  source?: string
  viewer?: PerspectiveViewerConfig
  inline?: InlinePayloadDescriptor
  artifact?: ArtifactPayloadDescriptor
  websocket?: {
    url: string
    protocol: "perspective" | "data-bridge-arrow-delta"
    sessionId: string
  }
}
```

### Transport negotiation rule

The consumer advertises capability and preference; the server decides.

Consumer controls:

- `preferredTransport`
- `acceptedTransports`
- `format`
- `maxInlineBytes`
- viewer configuration hints

Server controls:

- actual transport
- whether inline is allowed
- maximum bytes/rows
- whether Arrow conversion is available
- artifact lifetime
- websocket availability
- security/auth/capability policy

Server must never honor `inline` blindly for large results.

## DuckDB Workspace Files

DuckDB files are physically workspace files but semantically queryable databases.

### Preview path: file API

Use file API for discovery and preview:

```http
GET /api/v1/files/duckdb/tables?path=analytics.duckdb
GET /api/v1/files/duckdb/records?path=analytics.duckdb&table=orders&offset=0&limit=100
GET /api/v1/files/data?path=analytics.duckdb&representation=records&table=orders
```

The file subsystem should enforce:

- path validation through workspace adapter
- read-only mode
- table name validation
- page limits
- no arbitrary SQL in preview endpoints

### Query path: data bridge

Use data bridge for SQL/semantic queries:

```ts
data.v1.query.run({
  source: "duckdb-file",
  query: {
    language: "sql",
    dialect: "duckdb",
    sql: "select role, count(*) as count from people group by role",
    dataRef: { kind: "duckdb-file", path: "analytics.duckdb" }
  }
})
```

Safer dashboard query shape:

```ts
data.v1.query.run({
  query: {
    language: "bsl-dashboard",
    model: "orders",
    groupBy: ["month"],
    measures: ["revenue"],
    dataRef: {
      kind: "duckdb-file",
      path: "analytics.duckdb",
      table: "orders"
    }
  }
})
```

DuckDB adapter requirements:

- Obtain the DB file through a workspace-owned `materializeWorkspaceFileReadOnly()`/`WorkspaceFileLease` abstraction rather than raw `workspaceRoot` paths.
- The lease resolves path through adapter policy, rejects symlink escapes, creates an immutable temp copy or read-only local path when needed, works for remote/sandbox workspaces, and is scoped to request/session lifetime.
- Open DuckDB against the lease in read-only mode and prevent WAL/sidecar writes to the workspace.
- Disable extension auto-install/loading unless explicitly allowed.
- Restrict filesystem/network functions.
- Run with timeout/cancellation.
- Enforce output row/byte limits.
- For dashboard structured queries, compile to parameterized/quoted DuckDB SQL.
- For direct SQL, require stronger capability such as `data:sql-query` and trusted caller class depending on policy.

## BI Dashboard Runtime Changes

### Metrics and charts

Use `data.v1.query.run` for non-file semantic/query sources.

For plain `workspace-file` dataRefs:

- Near-term: `data.v1.query.run` may be used, but the bridge must delegate to the shared file-record service so semantics match the file API.
- The existing browser-side `/files/records` aggregation fallback is temporary compatibility debt. Remove it in Phase 2 or guard it behind an explicit dev-only feature flag with a tracked removal criterion.

Avoid two independent parsers and avoid permanent dashboard-local query execution.

### Perspective panels

For `BSLPerspectiveViewer`:

1. If query `dataRef.kind === "workspace-file"`, call file data/perspective endpoint.
2. Else call `data.v1.perspective.prepare`.
3. Load the result into real Perspective:
   - inline JSON/Arrow for small results
   - artifact Arrow for larger static results
   - websocket once server-side replicated Perspective is available

Do not route large raw Perspective datasets through `data.v1.query.run` JSON rows.

### Eval/E2E stitching

Add a true end-to-end workflow test:

1. Run the BI dashboard agent eval.
2. Locate generated `*.dashboard.json` in the eval workspace.
3. Start playground against that workspace.
4. Open the generated dashboard in browser.
5. Assert:
   - dashboard title visible
   - at least one metric has non-placeholder value
   - at least one chart/table has rows
   - no “No live data source configured yet” placeholder
   - if Perspective component exists, it loads through Perspective prepare path

## Implementation Phases

### Phase 0 — Document and freeze architecture

- Add this plan.
- Update existing data-bridge and dashboard plans to reference this split.
- Mark current `data-bridge` workspace-file parser as temporary.

Acceptance:

- Reviewers agree on file API vs data bridge ownership.

### Phase 1 — Extract file records core

- Move file-record parsing/paging/type inference into reusable server module.
- Keep existing `/api/v1/files/records` behavior unchanged.
- Add unit tests around extracted module.
- Add contract tests proving `/api/v1/files/records` and `data-bridge` delegated workspace-file reads return compatible rows/columns/limits.

Acceptance:

- Existing file route tests pass unchanged.
- Extracted module can be imported without Fastify.

### Phase 2 — Make `data-bridge` delegate workspace-file reads

- Replace local CSV/JSON/NDJSON parser in `plugins/data-bridge` with shared file-record service.
- Preserve path/security semantics via workspace adapter, not raw `workspaceRoot` reads.
- Keep traversal/symlink tests or adapt them to workspace adapter semantics.

Acceptance:

- `@hachej/boring-data-bridge` has no custom CSV parser.
- Bridge and `/files/records` agree on rows/columns/limits.
- BI dashboard no longer has a permanent browser aggregation fallback; if retained temporarily, it is feature-flagged and documented for removal.

### Phase 3 — Add file data negotiation endpoint

- Add `/api/v1/files/data` or explicit `/files/arrow` + `/files/perspective` endpoint.
- Initially support `representation=records` and small `representation=perspective` with `transport.preferred=inline` and `payloadFormat=json`.
- Add Arrow support behind capability/dependency detection.

Acceptance:

- File endpoint can return records and a Perspective inline descriptor.
- Large inline requests are rejected or downgraded to artifact when artifact support exists.

### Phase 4 — Add `data.v1.perspective.prepare`

- Add shared contract to `@hachej/boring-data-bridge`.
- Implement inline JSON first for small results.
- Add Arrow artifact once artifact storage exists.
- Add websocket later.

Acceptance:

- `BSLPerspectiveViewer` no longer calls `data.v1.query.run` for large/raw Perspective loads.
- Server chooses actual transport from accepted transports.

### Phase 5 — DuckDB file support

- Add file API table discovery and paginated preview for `.duckdb`.
- Add `duckdb-file` data bridge adapter for query execution.
- Add `WorkspaceFileLease`/read-only materialization support for local and non-local workspace adapters.
- Add direct SQL gating policy.
- Add structured dashboard query compiler for DuckDB tables.

Acceptance:

- A workspace `.duckdb` file can be previewed without SQL.
- A dashboard can query a DuckDB table through `data.v1.query.run`.
- Direct SQL requires explicit capability and respects timeouts/output limits.

### Phase 6 — True generated dashboard render E2E

- Extend eval harness or add a script that runs agent eval then browser render against generated output.
- Assert real data rendering, not just valid JSON.

Acceptance:

- CI can prove: agent creates dashboard → file exists → dashboard opens → data renders.

## Security Requirements

- File APIs must use workspace adapter path validation, not raw filesystem reads.
- Symlink traversal must remain impossible for local filesystem workspaces.
- Direct SQL must be gated separately from structured dashboard queries.
- DuckDB/SQLite workspace files must be accessed through read-only leases/materialized snapshots, never raw unchecked paths.
- Direct BSL Python query strings remain trusted-only with `data:bsl-query-string`.
- Inline transports must enforce byte/row limits server-side.
- Websocket transports must bind to workspace/session auth and expire.
- Artifacts must have content type, no-sniff headers, expiry, and workspace/session authorization.

## Open Questions

1. Should `/api/v1/files/data` replace `/api/v1/files/records` long term, or should `/records` stay as the simple stable API?
2. Where should Arrow conversion live: `@hachej/boring-agent`, `@hachej/boring-data-bridge`, or a dedicated optional package?
3. What artifact store should be used for Arrow artifacts in local/dev/serverless modes?
4. Should DuckDB direct SQL be available to browser callers with a constrained read-only policy, or only runtime/server callers?
6. Should `WorkspaceFileLease` live in `@hachej/file-data/server` or as a minimal workspace adapter capability consumed by that package?
5. Should Perspective websocket mode live in `data-bridge`, the workspace server, or a dedicated `perspective-bridge` plugin?

## Recommended Immediate Next Step

Do **Phase 1 + Phase 2** before adding more dashboard features:

- Extract the existing file-record implementation.
- Make `data-bridge` delegate workspace-file reads to it.
- Keep `data.v1.query.run` for current dashboard metrics/charts.

This removes duplicated parsers and gives a safe foundation for Arrow/Perspective transport negotiation.
