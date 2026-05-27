# Boring App Setup — Persistence and Migrations

Use this file when a child app has its own tables or app-owned persistence.

## Core-owned persistence

Core owns its own schema and migrations.

Core migration commands cover:

- auth tables core owns through its setup
- workspace/member/invite/settings/runtime tables core owns

## Child-app-owned persistence

If the child app has its own tables, it must own:

- its own schema files
- its own Drizzle config
- its own migrations

Core does **not** migrate child-app tables for you.

## Default rule

### If the child app has no extra tables

Use the normal core migration path.

### If the child app has extra tables

State explicitly:

```txt
Persistence ownership
- Core tables: migrated by core path
- Child app tables: migrated by app-owned Drizzle config
```

Also update the actual migration choreography:

- `src/server/migrate.ts` must no longer be core-only by accident
- deploy/release hooks must run app-owned migrations too

If needed, say it plainly:

```txt
The stock core migrate helper only runs core migrations.
This child app must extend/replace the migrate script so app-owned tables are migrated during deploy.
```

## Planning questions

- does this app need tables beyond core’s schema?
- if yes, where do the schema/config/migrations live?
- what command migrates the app-owned schema?
- does deploy need one release step or more than one migration target?

## Deploy/release rule

If deploy uses a release command or a dedicated migrate script, make sure it includes the child-app migrations as well as core migrations.

A sophisticated app with extra tables is not deploy-ready if:

- local migrate works
- but release/deploy still only runs core migrations

## Acceptance rule

A serious child app with its own persistence is not fully specified until the migration ownership is named clearly.
