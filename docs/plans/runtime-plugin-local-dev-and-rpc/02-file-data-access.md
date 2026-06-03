# Runtime Plugin File Data Access Plan

## Problem

`niche-explorer` had no clean way to read its dataset. It ended up bundling a large JSON blob into
the plugin front. That is the anti-pattern to fix first.

## Key simplification

Do **not** introduce a new generic `/api/v1/data/query` service in V1.

Instead, add a sibling **paginated records endpoint** under the existing file API.
The data is still just a workspace file; the host parses and slices it safely.

Existing behavior stays unchanged:

```txt
GET /api/v1/files?path=data/niches.json
-> { content, mtimeMs }
```

New V1 behavior:

```txt
GET /api/v1/files/records?path=data/niches.json&offset=0&limit=50&q=climate
-> { source, path, format, columns, rows, total, hasMore, offset, limit, mtimeMs }
```

The records envelope is intentionally generic: `path` identifies the workspace file, while
`source.recordSet` is reserved for future multi-record-set files such as sqlite/duckdb tables or
spreadsheet sheets. V1 uses a single default record set for JSON/NDJSON/CSV.

This keeps the route in the file subsystem and avoids a premature DB/data platform.

## V1 scope

Supported file formats:

- JSON array (`[{...}, {...}]`)
- NDJSON (`{"id":1}\n{"id":2}`)
- CSV with a header row (`id,name\n1,Climate`)

Parquet/sqlite/duckdb are deferred.

Supported operations:

- bounded pagination: `offset`, `limit`
- optional free-text search: `q`
- basic, best-effort column metadata for display/debug UIs

V1 semantics:

- `total` means the number of rows after applying `q` when `q` is present; otherwise all rows in the file.
- `q` is case-insensitive substring search over scalar row values (`string`, `number`, `boolean`), with values stringified for matching. Nested objects/arrays are ignored in V1.
- `columns` is metadata only, not a schema contract. Plugin UIs that know their data shape should render from `rows` directly.
- Column metadata is derived deterministically from a bounded sample, e.g. the union of keys from the first N matching rows, sorted by name. It may be incomplete.
- `recordSet` is omitted for V1 single-record-set files. If provided in V1, reject it with a validation error rather than silently ignoring it.

Not supported in V1:

- writes
- raw SQL
- grouped facets
- arbitrary structured filters
- sort expressions
- cross-file joins
- DB connections

## Contract

```ts
type FileRecordsFormat = "json-array" | "ndjson" | "csv"

type FileRecordsSourceKind = "file"

interface FileRecordsSource {
  kind: FileRecordsSourceKind
  path: string
  format: FileRecordsFormat
  /**
   * Optional logical record set inside the file.
   * V1 JSON/NDJSON/CSV readers ignore this and expose one default record set.
   * Later sqlite/duckdb/spreadsheet support can use this for table/view/sheet names.
   */
  recordSet?: string
}

interface FileRecordsQuery {
  path: string
  recordSet?: string // reserved for future multi-record-set files; unsupported in V1
  offset?: number    // default 0
  limit?: number     // bounded by host max, e.g. 100
  q?: string         // optional free-text search over scalar values
}

interface FileRecordsResult {
  source: FileRecordsSource
  /** Compatibility aliases for simple callers. */
  path: string
  format: FileRecordsFormat
  columns: { name: string; type: string }[]
  rows: Record<string, unknown>[]
  total: number
  hasMore: boolean
  offset: number
  limit: number
  mtimeMs?: number
}
```

Errors use the existing stable file-route error vocabulary:

- invalid path / traversal → path validation error / path rejected
- unsupported format → validation error
- malformed JSON/NDJSON/CSV → validation error
- file too large / scan too large / output too large → validation error in V1
- missing file → not found

## Front helper

Add a small workspace front helper; do not couple workspace to `@hachej/boring-data-explorer`.

```ts
declare function readFileRecords(opts: {
  path: string
  recordSet?: string
  offset?: number
  limit?: number
  q?: string
}): Promise<FileRecordsResult>
```

`niche-explorer` can use this directly with its existing hand-rolled list.

A later data-explorer-specific adapter can live in the data-explorer plugin package, not in base
workspace.

## Implementation notes

- Keep normal `GET /api/v1/files` response untouched.
- Add records reads at `GET /api/v1/files/records` rather than overloading `/api/v1/files`.
- Reuse the existing `Workspace` parameter and adapter path validation.
- JSON arrays are fully parsed only when the file is under the host byte cap.
- NDJSON and CSV pages may require a bounded full-file scan to compute `total`, especially with `q`; this is acceptable in V1 under the scan/file-size caps.
- CSV V1 assumes a header row and returns object rows keyed by header name. Values stay strings in V1; no type coercion beyond column metadata inference.
- Keep the result envelope stable enough for later database-like files:
  - sqlite/duckdb/parquet readers can still live behind `GET /api/v1/files/records` because the source is a workspace file.
  - `recordSet` can select an allowlisted table/view/sheet when a file contains multiple tabular record sets.
  - Later DB support should return the same `columns`, `rows`, `total`, `hasMore`, `offset`, and `limit` envelope before considering a separate query API.
  - Do not expose raw SQL through this interface; use host-owned readers and bounded operations first.
- Enforce host bounds:
  - max file bytes parsed/scanned
  - max rows scanned
  - max rows returned
  - max output bytes
- Do not read binary files through this view.
- Do not parse from browser/plugin code.
- Cache by `path + mtimeMs + size` only if needed; do not add cache first.

## Tasks

- **F1.** Add `GET /api/v1/files/records` parser for JSON array + NDJSON + CSV.
- **F2.** Add `readFileRecords()` front helper.
- **F3.** Migrate `niche-explorer` off bundled data to paginated file records.

## Acceptance

- Existing `GET /api/v1/files?path=x` clients receive the same shape as before.
- `GET /api/v1/files` clients receive the same shape as before; records use only `/api/v1/files/records`.
- `/api/v1/files/records` returns `source`, `path`, `format`, first page, total, columns, and `hasMore` for JSON array.
- `/api/v1/files/records` returns pages for NDJSON.
- `/api/v1/files/records` returns pages for CSV files with a header row.
- `recordSet` is part of the query/result contract but rejected in V1 until a multi-record-set file reader exists.
- `q` filters rows case-insensitively, paginates the filtered result, and returns `total` as the filtered count.
- `limit` is clamped to host max.
- File/scan/output bounds are enforced with stable validation errors.
- Invalid path traversal is rejected by the existing workspace path validation.
- `niche-explorer` renders from workspace data with no bundled dataset.
- No `/api/v1/data/query` route is introduced in this phase.

