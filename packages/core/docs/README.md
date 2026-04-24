# @boring/core Docs

User-facing docs for `@boring/core`. Status: **pre-implementation** — specs are locked but no runtime code has landed yet. Every doc below describes the planned v1 surface; items not yet shipped are marked `(planned)`.

## Start Here

- [QUICKSTART](./QUICKSTART.md) — wire core into a new app end-to-end.
- [API](./API.md) — export surface and contract status.
- [CONFIG](./CONFIG.md) — env vars, `boring.app.toml`, runtime config bridge.
- [AUTH](./AUTH.md) — better-auth wiring, providers, swapping.
- [DB](./DB.md) — Drizzle schema, migrations, local-vs-Postgres.
- [MIGRATION](./MIGRATION.md) — migrating from v1 `@boring/core` + `@boring/cloud`.

## Scope

Core owns **DB, user + workspace management, auth, config, server app factory, and frontend app shell**. It does not own panes (that's `@boring/workspace`) or agent runtime (that's `@boring/agent`).

## Canonical design

See [`./plans/core-package-spec.md`](./plans/core-package-spec.md) for the full design, locked decisions, dependency direction, and 14-day milestone plan.
