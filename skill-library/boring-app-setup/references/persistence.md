# Persistence and migrations

## When to use

Use this when the child app owns data beyond stock core tables.

## Default recommendation

Decide table ownership and migration ownership explicitly before coding.

## Decision table

| Data area | Owner | Implication |
|---|---|---|
| auth/workspace/core tables | core | stock core migrations may cover this |
| app-specific tables | child app | migration flow usually needs extension |
| external provider sync/cache tables | child app/domain module | release choreography must be explicit |

## Traps to avoid

- don't assume stock core migration helpers cover app-owned tables
- don't hide migration ownership inside ad hoc scripts
- don't ship new tables without release choreography

## Deeper docs

- `../manuals/data/PERSISTENCE_AND_MIGRATIONS.md`
- `providers/postgres.md`
