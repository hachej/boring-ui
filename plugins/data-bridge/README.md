# @hachej/boring-data-bridge

Trusted WorkspaceBridge-backed data query plugin. It registers `data.v1.query.run`
so dashboard/runtime callers can execute either:

- `language: "bsl"` — a BSL/Ibis expression string evaluated by BSL `safe_eval`.
- `language: "sql"` — read-only SQL routed through a host-registered adapter.

It also exposes a `query_data` agent tool with the same two modes, so chat agents
can answer reporting/dashboard questions without falling back to shell commands,
database CLIs, or ad hoc scripts.

This package intentionally does not define a separate dashboard JSON-to-BSL query DSL.

For dashboard-style hydration with several independent queries, use `data.v1.query.batch`.
It accepts `{ queries: [{ id, input }] }`, where each `input` is the same shape
as `data.v1.query.run`, and returns ordered per-item success/error results.
BSL execution is served by one persistent Python worker per data-bridge server
plugin instance. The worker starts lazily on the first BSL request, is shared by
`data.v1.query.run`, `data.v1.query.batch`, and the `query_data` tool for that
plugin instance, and is closed by the server lifecycle during shutdown. Loaded
semantic-layer models are cached in that worker, so repeated dashboard refreshes
avoid per-query Python startup and model-load overhead. Set
`BORING_DATA_BRIDGE_PYTHON` to choose a Python executable; otherwise `python3` is
used. BSL model location still comes from plugin options or
`BORING_BSL_MODEL_PATH` / `BSL_MODEL_PATH`; optional profile settings use
`BORING_BSL_PROFILE` and `BORING_BSL_PROFILE_FILE`. The first BSL call pays
Python startup plus model-load latency; later calls reuse the warm worker. BSL
requests are serialized through the single worker for deterministic model/cache
state, and model changes are picked up by restarting the server/plugin instance.
The worker is intentionally plugin-local rather than a process-wide singleton,
so each workspace server owns its own lifecycle and failure domain. Query strings
are still evaluated through BSL `safe_eval`; private/dunder attribute traversal is
blocked by the worker guard, but host deployments should continue to treat BSL as
trusted semantic-layer code rather than arbitrary user Python.
