# Repo Commands

Run from repo root unless stated otherwise.

## Setup

Use the Node requirement and exact pnpm version in root `package.json`;
CI reads that same package-manager pin. Enable Corepack's shims so nested
`pnpm` calls also use the pinned version, then install the lockfile:

```bash
corepack enable
pnpm --version                          # compare with package.json#packageManager
pnpm install --frozen-lockfile
```

If the global shim directory is not writable, use
`corepack enable --install-directory <writable-bin>` and put that directory
first on `PATH`. Each worktree needs its own install; do not share workspace
`node_modules` links across checkouts.

## Verify a change

```bash
git fetch origin main
pnpm typecheck:changed
pnpm test:changed
pnpm lint
pnpm lint:invariants
```

The changed commands include the branch diff from `origin/main` plus staged,
unstaged, and non-ignored untracked files. They check affected workspaces and
their dependents, prebuilding required packages/plugins. Root build/config,
workflow, runner, and agent-resource changes run the full check once. Review
the printed package selection; these commands still use each package's own
`typecheck`/`test` script. They cannot cover files that those scripts exclude.
For another target branch, set `TYPECHECK_BASE_REF` and `TEST_BASE_REF`.

CI uses these same commands for ordinary PRs; `main`, release branches,
`ci:full`, and `release-candidate` use full checks. For the complete local
gate, run `pnpm ci`. Database tests require a disposable PostgreSQL database
via `DATABASE_URL`; the PostgreSQL service in
[CI](../../.github/workflows/ci.yml) is the reference setup. Provider/browser
checks have additional prerequisites. Report unavailable checks explicitly.
`signoff:local` and `signoff:full` additionally record `gh-signoff` evidence;
the verification commands above work without that extension.

For a fast regression loop, run the relevant test files directly. For example,
the invite path crosses the form, HTTP authorization, idempotency store,
invite persistence, and mail transport. The route/E2E checks are:

```bash
pnpm --filter @hachej/boring-core... run build
pnpm --dir packages/core exec vitest run --no-file-parallelism e2e/v7-platform.test.ts src/server/routes/__tests__/invites.test.ts
pnpm --dir packages/core run typecheck
```

These exercise HTTP behavior with test adapters. They do not prove PostgreSQL
concurrency, browser interaction, or delivery by a real mail provider. Run
the relevant integration checks when those boundaries change. No background
worker participates in invite creation; mail is sent by the route.

To verify changes to the workspace selection runner itself (also run by
`pnpm lint` in CI): `pnpm test:changed-workspaces`.

## Full commands

```bash
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
