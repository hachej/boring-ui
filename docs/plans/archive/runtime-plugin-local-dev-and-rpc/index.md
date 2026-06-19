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
- When a new endpoint is unavoidable, keep it owned by the canonical layer (for self-test, UI panel status belongs under `/api/v1/ui/*`, not a plugin-specific route).
- Prefer file-backed reads before DB-backed reads.
- Match Pi for local plugin dependencies: plugin-local `package.json` + user/agent runs install in the plugin dir; `/reload` never installs.
- Teach generated plugins to use the boring-ui design system before adding third-party UI.
- Defer writes until read DX and self-test DX are proven.

## Original failures → focused plans

| Observed failure | Smallest useful fix | Plan |
| --- | --- | --- |
| Agent needed a human to report browser/runtime errors | Plugin health + live pane-status self-test | [01-health-self-test.md](./01-health-self-test.md) |
| Plugin bundled a huge JSON blob to show data | Enhance the existing file endpoint with paginated record reads | [02-file-data-access.md](./02-file-data-access.md) |
| Plugin links needed to open workspace files/panels/surfaces | Front-only `WorkspaceLink` over existing UI effects | [03-workspace-link.md](./03-workspace-link.md) |
| Plugin could not import useful front packages like charts/maps/etc. | Resolve plugin-local deps while keeping React/workspace/ui-kit singleton | [04-dependency-import.md](./04-dependency-import.md) |
| Generated plugins felt visually bolted-on | Scaffold + prompt agents toward boring-ui-kit and workspace design primitives | [06-generated-plugin-design-system.md](./06-generated-plugin-design-system.md) |
| Plugin needs durable data edits later | Separate DB/write/concurrency plan | [05-writes-and-db.md](./05-writes-and-db.md) |

## Execution order

```txt
1. Health/self-test
   -> agent can reload, open a pane, and read live browser-reported pane status

2. File-backed data reads
   -> niche-explorer stops bundling data and reads paginated records from workspace files

3. Workspace links
   -> rows can open files/surfaces/panels without routes

4. Plugin-local dependency imports
   -> plugin can import packages installed in its own folder without dual React

5. Generated plugin design-system defaults
   -> scaffolded plugins use boring-ui-kit and native pane layout

6. Deferred power features
   -> hosted/cloud install policy, DuckDB, sqlite/parquet/csv expansion, writes, optimistic concurrency
```

## V1 target

V1 is intentionally modest:

> A CLI runtime plugin can self-test through the live workspace UI, read paginated records from a
> workspace file, navigate the workspace, import plugin-local dependencies without loading a second
> React, and start from a native boring-ui-kit pane scaffold.

## Explicitly deferred from V1

- Auto-installing packages during `/reload`.
- A generic `/api/v1/data/query` route.
- DuckDB as a universal engine.
- SQLite/DuckDB writes.
- Optimistic row concurrency and idempotency.
- Remote/hosted plugin trust modes.
- Full Bridge RPC migration. The health/self-test status route should stay narrow and mechanically migratable to WorkspaceBridge later.

Those may still be good ideas. They are not needed to fix the first-order plugin DX problems.
