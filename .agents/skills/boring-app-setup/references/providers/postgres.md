# Provider reference — Postgres

## When to use

Use this for database setup, connection ownership, and migration responsibility.

## Default recommendation

For a real full-app child app, use managed Postgres.

## What it powers

- auth/session/account persistence
- workspaces/members/invites/settings
- app-owned tables

## Need from the user

- provider choice
- connection string source
- owner of DB account/project
- whether the app owns extra tables

## Traps to avoid

- don't treat DB as optional for a real full-app child app
- don't forget migration ownership when app tables are added

## Deeper docs

- `../../manuals/dependencies/EXTERNAL_DEPENDENCY_MAP.md`
- `../../manuals/providers/PROVIDER_SNIPPETS.md`
- `../../manuals/data/PERSISTENCE_AND_MIGRATIONS.md`
