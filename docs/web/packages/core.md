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
- the default composed app surfaces for server + frontend

## Main entrypoints

**Common app-shell path**
- `@hachej/boring-core/app/server` → `createCoreWorkspaceAgentServer()`
- `@hachej/boring-core/app/front` → `CoreWorkspaceAgentFront`

**Lower-level core-only path**
- `@hachej/boring-core/server` → `createCoreApp()`, `loadConfig()`, `validateConfig()`, `buildRuntimeConfigPayload()`
- `@hachej/boring-core/front` → `CoreFront`

## Frontend role

Core ships two front surfaces:

- `@hachej/boring-core/front` → `CoreFront`, auth pages, config/theme/auth hooks, user/workspace hooks, menus, and settings pages
- `@hachej/boring-core/app/front` → `CoreWorkspaceAgentFront`, the higher-level composed shell for the common full-app path

## Key boundary

Core is the only package in this repo that owns persistence and identity.

If a feature depends on durable user/workspace records, it belongs here.

## Typical usage

Common full-app path:

```ts
import { createCoreWorkspaceAgentServer } from '@hachej/boring-core/app/server'

const app = await createCoreWorkspaceAgentServer({
  // config, plugins, stores, runtime options
})
```

Use `createCoreApp()` only when you intentionally want the lower-level core-only server factory.

## Related docs

- canonical docs: `packages/core/docs/README.md`
- [Design FAQ](../reference/design-faq.md)
- [Troubleshooting map](../reference/troubleshooting.md)
- [Composition guide](../guides/composition.md)
- [Glossary](../reference/glossary.md)
