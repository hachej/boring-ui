# @hachej/data-bridge

Trusted WorkspaceBridge-backed data adapter plugin. It registers `data.v1.query.run`
so dashboard/runtime callers can execute semantic dashboard queries through host-owned adapters.

Adapters included in this package:

- `workspace-file`: reads workspace CSV/JSON/NDJSON through the workspace file APIs and aggregates rows.
- `bsl`: optional Python BSL adapter enabled with `BORING_BSL_MODEL_PATH`; executes BSL's native model query mechanism.
