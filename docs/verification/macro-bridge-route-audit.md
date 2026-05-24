# Macro WorkspaceBridge route audit

Bead: `boring-ui-v2-reorg-9nki`
Date: 2026-05-24

Source audited: `/home/ubuntu/projects/boring-macro/src/plugins/macro`.

## Command evidence

```bash
cd /home/ubuntu/projects/boring-macro
rg -n "scoped\.(get|post|put)|BORING_MACRO_API_URL|requests\.(get|post)|fetch\(" src/plugins/macro
```

The grep still matches the planned legacy server-route surface and does not reveal additional Macro data/domain routes beyond the table below.

## Route mapping

| Current route/call | Current caller | v1 target | Notes |
|---|---|---|---|
| `GET /api/macro/catalog` | `front/data/macroSeriesAdapter.ts` | `macro.v1.catalog.search` | Preserve `{ items,total,hasMore }`; use `DataService.catalog/search`. |
| `GET /api/macro/facets` | `front/data/macroSeriesAdapter.ts` | `macro.v1.facets.list` | Preserve `{ frequency, source }`; use `DataService.catalogFacets`. |
| `GET /api/macro/catalog/search` | server-only legacy/explicit search | `macro.v1.catalog.search` | Same search service; no separate browser route needed. |
| `GET /api/macro/series/:id` | `front/data/macroSeriesData.ts` | `macro.v1.series.metadata` + `macro.v1.series.data` | Front can compose metadata+data, or a later UI adapter can preserve combined shape headlessly. |
| `GET /api/macro/series/:id/data` | Python SDK `get_series_data_json()` | `macro.v1.series.data` | Runtime SDK should switch to `@hachej/boring-workspace/bridge-client` equivalent/Python client env. |
| `GET /api/macro/series/:id/lineage` | `ChartCanvasPane.tsx` | `macro.v1.series.lineage` | Browser UI uses bridge. |
| `POST /api/macro/sql` | server route | `macro.v1.sql.query` | Guarded read-only SQL only: no `/api/macro/ch-query` bridge mapping. |
| `POST /api/macro/transform/persist` | Python SDK `persist_series()` | `macro.v1.transform.persist` | Mutation should require idempotency key and `macro:transform.persist`. |
| `GET /api/macro/refresh/status` | manual/admin refresh only | optional `macro.v1.refresh.status` | Only if product keeps manual refresh UI. |
| `POST /api/macro/refresh/:seriesId` | manual/admin refresh only | optional `macro.v1.refresh` | Only if product keeps manual refresh UI. |
| `GET/PUT /api/macro/deck*` | `front/panels/DeckPane.tsx` | not Macro bridge | Deck/file behavior stays product/file-owned: use existing workspace file/upload/raw-file mechanisms or separate deck plan. |
| `POST /api/macro/ch-query` | CH proxy route | not bridged | Explicitly excluded; SQL bridge is `macro.v1.sql.query` only. |

## Front adapter coverage

- `front/data/macroSeriesAdapter.ts`
  - `search()` currently fetches `/api/macro/catalog`; target `macro.v1.catalog.search`.
  - `fetchFacets()` currently fetches `/api/macro/facets`; target `macro.v1.facets.list`.
- `front/data/macroSeriesData.ts`
  - `fetchMacroSeries()` currently fetches combined `/api/macro/series/:id`; target bridge composition of `macro.v1.series.data` and `macro.v1.series.metadata`.
- `front/panels/ChartCanvasPane.tsx`
  - lineage fetch target `macro.v1.series.lineage`.
- `front/panels/DeckPane.tsx`
  - deck fetch/write/list remain out of Macro bridge; use workspace file/raw/upload path or separate deck plan.

## Python SDK coverage

- `server/sdk/boring_macro/__init__.py`
  - `get_series_data_json()` -> `macro.v1.series.data`.
  - `persist_series()` -> `macro.v1.transform.persist`.
  - `run_transform()` composes those two SDK calls; no host route requirement after SDK migration.
- Current SDK reads `BORING_MACRO_API_URL`; bridge migration should replace this with WorkspaceBridge env (`BORING_WORKSPACE_BRIDGE_URL`, token, workspace/session ids) and stable bridge errors.

## Shared service extraction points

- Catalog/search/facets: `DataService.catalog`, `DataService.search`, `DataService.catalogFacets`.
- Series: `DataService.seriesData`, `DataService.seriesMetadata`, `DataService.seriesLineage`.
- SQL: `DataService.executeSql` behind read-only SQL guard, timeout, max rows/bytes, and `macro:sql.query` capability.
- Transform persist: `DataService.persistTransform` behind mutation idempotency and `macro:transform.persist` capability.

## Provider/fixture smoke notes

- If ClickHouse/FRED fixtures are unavailable, Macro handlers should return stable bridge errors or empty catalog/facet responses matching current behavior, not require plugin-owned routes.
- Smoke commands after handler implementation:
  - catalog/facets/series bridge calls via browser auth context;
  - Python SDK `get_series_data_json()` and `persist_series()` from runtime env;
  - SQL guard rejects non-read-only/multi-statement SQL with SQL text redacted in logs;
  - deck UI still uses workspace file/raw/upload flow, not `workspace-files.v1.*`.
