# Data Bridge query layer hardening plan

## Context

`@hachej/data-bridge` is new in the BI dashboard stack, but the intent is broader than dashboards: it should become the shared trusted query layer for BI dashboards, BSL integrations, and later boring-macro/MacroAnalyst.

Boring Macro already proves the product need. Today Macro owns its own ClickHouse-backed query service and agent tools:

- `execute_sql(query)` — read-only ClickHouse SQL with allowlisted first token and multi-statement rejection.
- `macro_search(...)` — catalog search over `series_catalog`.
- `get_series_data(...)` — typed time-series reads.
- custom macro bridge ops under `macro.v1.*`.

That works locally for Macro, but it leaves BI dashboards, BSL, and future data plugins without a shared query contract.

## Decision

Keep `@hachej/data-bridge` as a separate trusted server plugin, but keep the V0 simple:

1. One generic bridge operation: `data.v1.query.run`.
2. A small typed query union:
   - `bsl-dashboard` for dashboard/semantic aggregate requests.
   - `bsl-python` for trusted runtime/server BSL expression execution.
   - `sql` for read-only adapter-backed SQL execution.
3. A server-side adapter registry supplied by the host/plugin options.
4. No direct ClickHouse dependency in `@hachej/data-bridge` V0.
   - Macro can later register a `macro-clickhouse` SQL adapter that delegates to its existing `DataService.executeSql`.
   - This avoids pulling Macro/ClickHouse concerns into the reusable package.

## V0 scope for this PR

### In scope

- Add `DataBridgeSqlQuery` to shared types.
- Add `DataBridgeSqlAdapter` server contract.
- Add `sqlAdapters?: Record<string, DataBridgeSqlAdapter>` to `createDataBridgeServerPlugin` options.
- Add read-only SQL guard inspired by boring-macro:
  - allow first token: `SELECT`, `WITH`, `EXPLAIN`, `DESCRIBE`, `SHOW`, `DESC`.
  - reject semicolon multi-statements.
  - normalize an effective bounded `limit` before adapter execution.
  - defensively truncate adapter output to the effective limit even if the adapter ignores it.
- Add capability checks:
  - all callers need `data:read` for `data.v1.query.run`.
  - SQL additionally needs `data:sql-query`.
  - SQL source can additionally require adapter-specific capabilities such as `data:macro-clickhouse`.
  - direct `bsl-python` remains runtime/server only with `data:bsl-query-string`.
- Keep browser dashboard callers on safe `bsl-dashboard` / `workspace-file` path unless explicitly granted SQL capability.
- Add focused tests for:
  - current workspace-file dashboard query still works with `data:read`.
  - SQL rejects non-read-only and multi-statement input before adapter execution.
  - SQL requires `data:sql-query` and adapter-specific capabilities.
  - SQL adapter receives normalized query/limit and returns `DataBridgeTableResult`.

### Out of scope

- Migrating boring-macro to data-bridge.
- Adding ClickHouse client dependency here.
- Replacing Macro's existing `macro.v1.*` bridge ops.
- Building a full SQL parser.
- Supporting write SQL.
- Large raw dataset transport/Arrow/Perspective streaming.

## Future Macro migration sketch

After this lands, Macro can add a small adapter in the Macro repo/app:

```ts
createDataBridgeServerPlugin({
  workspaceRoot,
  sqlAdapters: {
    "macro-clickhouse": {
      requiredCapabilities: ["data:macro-clickhouse"],
      execute: async ({ query, limit }) => {
        // Follow-up Macro migration should teach DataService.executeSql to
        // apply the limit at the ClickHouse query layer where possible. Until
        // then, data-bridge also truncates defensively after adapter return.
        const result = await macroDataService.executeSql(query.sql, { limit })
        if (!result.ok) throw new Error(result.error)
        return {
          kind: "data-bridge.table",
          version: 1,
          columns: inferColumns(result.rows ?? []),
          rows: result.rows ?? [],
          rowCount: result.row_count ?? 0,
          source: "macro-clickhouse",
        }
      },
    },
  },
})
```

Then Macro's `execute_sql` tool can become a thin facade over `data.v1.query.run`.

## Why this is simple and robust

- Reuses Macro's proven read-only SQL safety shape without baking Macro into data-bridge.
- Keeps the query transport generic and WorkspaceBridge-native.
- Makes SQL adapter registration explicit and trusted.
- Gives BI dashboard a stable data path now, while leaving Macro migration as a later narrow PR.
