# `@hachej/boring-core`

`@hachej/boring-core` is the foundation package for boring-ui v2 apps.

## What it owns

- Postgres + Drizzle persistence
- auth via better-auth
- config loading and validation
- Fastify app factory
- frontend provider shell via `CoreFront` (and the higher-level `CoreWorkspaceAgentFront`)
- users, workspaces, members, invites, capabilities

## What it is for

Use core when you are building the full app shell and need:

- real user identity
- workspace membership rules
- invite flows
- app config
- a server factory that other packages can mount into

## Main server entrypoints

- `createCoreApp()`
- `loadConfig()`
- `validateConfig()`
- `buildRuntimeConfigPayload()`

## Frontend role

Core also ships the application shell used by frontend apps (via `@hachej/boring-core/front`):

- `CoreFront` (top-level providers + auth pages) and `CoreWorkspaceAgentFront` (full composed shell, via `@hachej/boring-core/app/front`)
- auth pages and auth gate
- `ConfigProvider` / `ThemeProvider` and config/theme/auth hooks
- user/workspace hooks, menus, and settings pages

## Key boundary

Core is the only package in this repo that owns persistence and identity.

If a feature depends on durable user/workspace records, it belongs here.

## Typical usage

```ts
import { createCoreApp, loadConfig } from '@hachej/boring-core/server'

const config = await loadConfig()
const app = await createCoreApp(config)
```

## Related docs

- canonical docs: `packages/core/docs/README.md`
- [Composition guide](../guides/composition.md)
- [Glossary](../reference/glossary.md)
