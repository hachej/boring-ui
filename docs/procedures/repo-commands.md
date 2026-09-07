# Repo Commands

Run from repo root unless stated otherwise.

```bash
pnpm install
pnpm dev
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm lint:invariants
pnpm ci
```

Scoped examples:

```bash
pnpm --filter @hachej/boring-workspace run test
pnpm --filter @hachej/boring-agent run test
pnpm --filter @hachej/boring-workspace run typecheck
pnpm --filter workspace-playground dev
pnpm --filter agent-playground dev
pnpm --filter full-app dev
```

## Running apps concurrently

Each app's `dev` first rebuilds its shared-package deps (`build:deps`), and
those builds are `clean:true` — two app `dev` runs at once race on the same
`dist/` directories and corrupt them.

Root `pnpm dev` is safe: it runs `build:app-deps` once (all shared packages,
topological order, `--workspace-concurrency=1`) and only then starts every app
in parallel via `dev:app`, which never rebuilds shared packages.

`build:app-deps` selects its package set from pnpm's own dependency graph —
`--filter '{./apps/*}...'` (every app plus everything it depends on) minus
`--filter '!{./apps/*}'` (the apps themselves) — so it can never drift out of
sync with what the apps actually import. Note the braces: `'./apps/*...'`
without them is parsed as a literal path pattern and silently selects only the
apps.

To start apps in separate terminals, do the same by hand:

```bash
pnpm build:app-deps                              # once, from repo root
pnpm --filter workspace-playground dev:app       # then one per terminal
pnpm --filter agent-playground dev:app
pnpm --filter full-app dev:app
```

Never run two `dev` (as opposed to `dev:app`) commands at the same time.
Re-run `pnpm build:app-deps` after changing a shared package.

Apps that consume `@hachej/boring-workspace` from source need workspace built
once first:

```bash
pnpm --filter @hachej/boring-workspace build && pnpm --filter workspace-playground test
```

## Package Docs

Start at [`docs/README.md`](../README.md), then descend into the relevant
package:

- Core: `packages/core/docs/README.md`
- Agent: `packages/agent/docs/README.md`
- Workspace: `packages/workspace/docs/README.md`
- Plugin system: `packages/workspace/docs/PLUGIN_SYSTEM.md`
- Plugin layout/code patterns: `packages/workspace/docs/PLUGIN_STRUCTURE.md`
