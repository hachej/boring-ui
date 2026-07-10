# @hachej/boring-data-bridge

Trusted WorkspaceBridge-backed data query plugin. It registers `data.v1.query.run`
so dashboard/runtime callers can execute either:

- `language: "bsl"` — a BSL/Ibis expression string evaluated by BSL `safe_eval`.
- `language: "sql"` — read-only SQL routed through a host-registered adapter.

It also exposes a `query_data` agent tool with the same two modes, so chat agents
can answer reporting/dashboard questions without falling back to shell commands,
database CLIs, or ad hoc scripts.

This package intentionally does not define a separate dashboard JSON-to-BSL query DSL.
