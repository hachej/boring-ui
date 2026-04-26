# @boring/core

Foundation package for boring-ui-v2 apps: DB, auth, config, HTTP app factory, and frontend shell. Every child app imports `@boring/core/server` (Fastify + Postgres + better-auth) and wraps its frontend in `<BoringApp>` from `@boring/core/front`.

See [`docs/CORE.md`](docs/CORE.md) for the full spec (quickstart, API reference, config, deployment).

Reference apps: [`apps/full-app`](../../apps/full-app/) (production deploy) · [`apps/workspace-playground`](../../apps/workspace-playground/) (dev sandbox).
