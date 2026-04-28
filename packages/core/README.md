# @boring/core

Foundation package for boring-ui-v2 apps: DB, auth, config, HTTP app factory, and frontend shell. Every child app imports `@boring/core/server` (Fastify + Postgres + better-auth) and wraps its frontend in `<BoringApp>` from `@boring/core/front`.

v7 adds managed workspace provisioning via `WorkspaceProvisioner` / `createFsProvisioner`, built-in workspace settings, members, invites, and invite-accept pages inside `<BoringApp>`, `getWorkspaceCommands(workspaceId, navigate)` for command-palette wiring, invite TTL config, and operational docs for workspace-settings key rotation. See [`docs/CORE.md`](docs/CORE.md) for the authoritative reference and [`CHANGELOG.md`](CHANGELOG.md) for the shipped-vs-deferred v7 summary.

Reference app: [`apps/full-app`](../../apps/full-app/) — the canonical production-ready example, also serves as the dev surface.
