# Runtime Plugin DX — split roadmap

## Status

**Reworked after thermo-nuclear review.** The previous mega-plan mixed error visibility,
data access, workspace navigation, dependency imports, package installation, DuckDB, and writes
into one implementation. That was too complex.

This file is now the index. The work is split by the original plugin-system failures we actually
hit while building `niche-explorer`.

## Ground rule

Ship the smallest fix for each observed pain before building a generic platform.

- Prefer existing CLI/local endpoints over new RPC surfaces.
- Prefer file-backed reads before DB-backed reads.
- Prefer already-installed dependency resolution before arbitrary `npm install`.
- Defer writes until read DX and self-test DX are proven.

## Original failures → focused plans

| Observed failure | Smallest useful fix | Plan |
| --- | --- | --- |
| Agent needed a human to report browser/runtime errors | Plugin health + headless self-test | [01-health-self-test.md](./01-health-self-test.md) |
| Plugin bundled a huge JSON blob to show data | Enhance the existing file endpoint with paginated record reads | [02-file-data-access.md](./02-file-data-access.md) |
| Plugin links needed to open workspace files/panels/surfaces | Front-only `WorkspaceLink` over existing UI effects | [03-workspace-link.md](./03-workspace-link.md) |
| Plugin could not import useful front packages like `DataExplorer` | Resolve already-installed deps while keeping React/workspace singleton | [04-dependency-import.md](./04-dependency-import.md) |
| Plugin needs durable data edits later | Separate DB/write/concurrency plan | [05-writes-and-db.md](./05-writes-and-db.md) |

## Execution order

```txt
1. Health/self-test
   -> agent can see reload, render, network, and blank-pane failures

2. File-backed data reads
   -> niche-explorer stops bundling data and reads paginated records from workspace files

3. Workspace links
   -> rows can open files/surfaces/panels without routes

4. Already-installed dependency imports
   -> plugin can import shared UI packages without dual React

5. Deferred power features
   -> npm install, DuckDB, sqlite/parquet/csv expansion, writes, optimistic concurrency
```

## V1 target

V1 is intentionally modest:

> A CLI runtime plugin can self-test, read paginated records from a workspace file, navigate the
> workspace, and import already-installed UI dependencies without loading a second React.

## Explicitly deferred from V1

- Arbitrary `npm install` from plugin manifests.
- A generic `/api/v1/data/query` route.
- DuckDB as a universal engine.
- SQLite/DuckDB writes.
- Optimistic row concurrency and idempotency.
- Remote/hosted plugin trust modes.
- Bridge RPC migration.

Those may still be good ideas. They are not needed to fix the first-order plugin DX problems.
