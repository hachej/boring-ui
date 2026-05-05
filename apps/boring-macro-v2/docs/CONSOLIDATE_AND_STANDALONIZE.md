# Consolidate the macro app + make it portable

**Status:** implemented; historical migration notes retained below
**Owner:** macro
**Last updated:** 2026-05-01

## Current Shape

`apps/boring-macro-v2` is now the single macro app. The app shell stays thin;
macro-specific behavior lives in `src/plugins/macro`.

## Layout

```
apps/boring-macro-v2/
  src/
    front/
      main.tsx
      App.tsx                       — starts WorkspaceAgentFront with macroPlugin
      app.css
    server/
      index.ts                      — starts createWorkspaceAgentServer
      dev.ts                        — boots backend + Vite for local dev
      __tests__/
    plugins/macro/
      front/
        index.tsx                   — front plugin factory and shell options
        catalogs.ts                 — macro series data catalog output
        panels.tsx                  — chart/deck panel definitions
        surfaceResolver.ts          — macro.open-series + deck path routing
        data/                       — macro data client, types, UI helpers
        panels/                     — ChartCanvasPane, DeckPane
        routes/                     — standalone presentation route helper
      server/
        index.ts                    — server plugin factory + provisioning
        config.ts
        routes/macro.ts
        services/
        tools/
        sdk/
        transforms/
        workspace-template/
      shared/
        constants.ts
        types.ts
    eval/
  e2e/
  .pi/APPEND_SYSTEM.md
  index.html
  vite.config.ts
  package.json
```

## Ownership Rules

- App `front/` only renders the workspace composer and passes `macroPlugin`.
- App `server/` only starts the workspace server composer and registers macro
  routes from the plugin.
- Macro catalog selection uses `openSurface` with `macro.open-series`.
- Deck markdown routing is plugin-owned through `surfaceResolver.ts`.
- Python SDK, transforms, and workspace seed templates belong to the macro
  plugin because they are plugin provisioning inputs.
- Generated Python artifacts (`*.egg-info`, `build`, `__pycache__`) are ignored.

## Historical Migration Notes

The remaining phases below record the original consolidation plan. They are not
the current source layout.

## Migration phases

### Phase A — Reconcile the duplicated server files

The in-monorepo backend is the production-shaped one (has Stripe +
fredRefresh + waitlist; the standalone has none). The standalone
backend was a snapshot from earlier. **The in-monorepo wins**; the
standalone backend is discarded after merging any drift back.

1. Diff each duplicated file (`config.ts`, `clickhouse.ts`,
   `macroRoutes.ts` ↔ `routes/macro.ts`, `macroTools.ts`).
2. For each genuine improvement in the standalone (e.g. enriched
   metadata response, `pick("title") ?? pick("s.title")` ClickHouse
   prefix workaround in series route, `series/:id/lineage` route) —
   port to the in-monorepo version.
3. Drop the duplicates in the standalone.

Verifiable end state: `git diff --stat` between the two backends shows
only the in-monorepo additions (Stripe, waitlist, fredRefresh) plus
the merged-in standalone improvements.

### Phase B — Move the frontend in

1. Copy `boring-macro-v2/src/web/` → `apps/boring-macro-v2/src/front/`.
2. Copy `boring-macro-v2/index.html`, `vite.config.ts` → app root.
3. Copy `boring-macro-v2/.pi/APPEND_SYSTEM.md` → app root.
4. Copy `boring-macro-v2/deck/` → app root.
5. Update `apps/boring-macro-v2/package.json`:
   - Add front deps (`react`, `react-dom`, `recharts`, `react-markdown`,
     `remark-gfm`, `lucide-react`).
   - Add `@boring/workspace` and `@boring/core` to runtime deps
     (already has `@boring/agent`).
   - Replace `dev` with the dev launcher pattern from `apps/full-app`
     (`tsx src/server/dev.ts` that boots Fastify then Vite).
6. Update `tsconfig.json` to include `src/front/**` + `src/server/**`.

### Phase C — Drop the standalone shims

Prerequisite: CODE_OWNERSHIP_CLEANUP_PLAN Phase 0 is done
(`@boring/workspace/app/server` actually builds).

1. Delete `src/server/uiBridge.ts`. Replace with
   `import { createWorkspaceAgentServer } from "@boring/workspace/app/server"`.
2. Delete `src/front/workspace-types.ts`. Replace imports with
   `from "@boring/workspace"`.
3. Replace `tabBus` call sites (6) with `bridge.postCommand` per the
   ownership-cleanup plan.

### Phase D — Wire deploy (swap-in-place)

**Decided 2026-04-28: keep `boring-macro.fly.dev`. Repoint the existing
Fly app at the consolidated codebase. ~1 minute downtime during the
swap is acceptable.**

1. Borrow `apps/full-app/Dockerfile` shape; adapt for macro (different
   env vars, different routes to expose).
2. Reuse the existing `fly.toml` from the standalone (it already
   targets `boring-macro.fly.dev`). Update build context paths to the
   consolidated app folder. Do not change the Fly app name.
3. Check `BM_CH_*` + Stripe + Anthropic secrets are read from env in
   prod; document in `.env.example`. Confirm Fly secrets already set
   on the existing app cover what the consolidated app needs (likely
   yes — same backend code).
4. Reconcile system-prompt files: the standalone has both
   `agent-system-prompt.txt` (legacy) and `.pi/APPEND_SYSTEM.md`. Grep
   the standalone for any code path still reading the `.txt` (likely
   none — pi auto-discovers `APPEND_SYSTEM.md`). Keep only the
   `.pi/APPEND_SYSTEM.md` version in the consolidated app. Delete the
   `.txt`.
5. Deploy from `apps/boring-macro-v2/` (or post-rename
   `apps/boring-macro/` — see Phase E). Smoke against the live URL:
   one session, `macro_search` query, `exec_ui openPanel` chart open.
   Roll back via Fly's previous-release pointer if the smoke fails.

### Phase E — Archive the standalone + rename the app

**Decided 2026-04-28: rename `apps/boring-macro-v2/` →
`apps/boring-macro/` once the standalone is archived. The `-v2` suffix
existed to disambiguate against the standalone repo; with the standalone
gone, it's a misnomer.**

1. Rename `/home/ubuntu/projects/boring-macro-v2/` →
   `/home/ubuntu/projects/.boring-macro-v2-standalone-archive-2026-04-28/`.
2. Add a top-level README to the archive: "merged into
   `boring-ui-v2/apps/boring-macro/` on 2026-04-28; see
   docs/CONSOLIDATE_AND_STANDALONIZE.md for the migration record."
3. Rename `apps/boring-macro-v2/` → `apps/boring-macro/`:
   - `git mv apps/boring-macro-v2 apps/boring-macro`
   - Update `package.json#name` from `@boring/macro` (already correct)
     and any internal references that hardcode the path (search for
     `boring-macro-v2`, expect hits in tsconfig, vite, Dockerfile
     COPY paths, fly.toml, README, this file).
   - Re-run `pnpm install` so workspace resolution updates.
   - Verify `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` from the
     new path.
   - The Fly app name (`boring-macro`) and URL stay the same — only
     the local source folder renames.
4. Delete the standalone archive after one month if nothing's been
   pulled out of it. Move-references to it must be checked first
   (e.g. CLAUDE.md notes about working in `/home/ubuntu/projects/boring-macro-v2/`).

## Portability checklist (so future `git mv` to a separate repo is mechanical)

The unified app must be runnable both *inside* the monorepo (with pnpm
workspace resolution) and *outside* (with `file:` paths or published
package versions). Concretely:

- [ ] All `import` statements reference `@boring/*` package names.
      Zero `import "../../packages/..."` or `import
      "../../../boring-ui-v2/..."` paths.
- [ ] `package.json` deps for `@boring/agent`, `@boring/core`,
      `@boring/workspace` use `workspace:*` (mono); a portable
      template (`file:../boring-ui-v2/packages/...` or pinned
      versions) is documented in `README.md` for extraction.
- [ ] `vite.config.ts` aliases `@boring/workspace` → `packages/workspace/src/index.ts`
      for HMR, and re-points the alias when the app moves to its own
      repo. **Re-decided 2026-04-28 (revising the earlier "built dist
      only" call):** during the consolidation phase the team is
      iterating on workspace and macro at the same time; rebuilding
      workspace's dist after every edit was the dominant cost in the
      Phase B inner loop. Aliases bring HMR back. The portability
      cost is one config-line update at extraction time (alias path
      changes from `../../packages/workspace/src/index.ts` to
      `../node_modules/@boring/workspace/src/index.ts` or similar) —
      cheap relative to the daily DX win.
- [ ] No imports from sibling apps (`apps/full-app/...`,
      `apps/workspace-playground/...`).
- [ ] Tests (`e2e/`, `__tests__/`) don't reference monorepo-root
      paths (`/home/ubuntu/projects/boring-ui-v2/node_modules/...`).
      Use relative paths inside the app and standard package
      resolution.
- [ ] `.pi/APPEND_SYSTEM.md` lives in the app root, not under monorepo
      root.
- [ ] `Dockerfile` build context is the app folder; doesn't reach up.
      (For monorepo CI today, Dockerfile may pull in workspace
      packages from a parent `COPY` — document the difference.)
- [ ] `pnpm-lock.yaml` reflects all macro deps even if pnpm
      workspaces resolve them transitively (so a fresh checkout of an
      extracted repo can `pnpm install` and resolve every package).
- [ ] `tsconfig.json` does not extend a monorepo-root config without
      a portable fallback.
- [ ] CI scripts (`test:e2e`, `build`, `typecheck`) work from inside
      the app folder alone — `cd apps/boring-macro-v2 && pnpm
      typecheck` shouldn't require pnpm to traverse up.

A green checklist is the **definition of done** for "could `git mv`
this to a new repo tomorrow."

## What this plan is NOT

- **Not** moving the macro app out of the monorepo today. That happens
  later, manually, when there's a reason. The portability checklist
  exists so the move is cheap when it happens — not to do the move
  now.
- **Not** changing the `@boring/*` package boundaries — those are
  governed by `CODE_OWNERSHIP_CLEANUP_PLAN.md`. This plan only
  consolidates the consumer (macro app), not the libraries.
- **Not** rewriting macro's tools/UI from scratch — every file
  documented under "What stays where" already exists in one of the two
  current macros. The work is reconcile-and-merge, not greenfield.

## Open questions

- **The standalone has its own e2e suite (29 specs)** that already
  hits the macro frontend + ClickHouse. Sequence: this plan's Phase B
  copies all 29 into `apps/boring-macro-v2/e2e/` as-is.
  `CODE_OWNERSHIP_CLEANUP_PLAN.md` Phase 2 then splits them — generic
  specs (~15) move to `packages/workspace/e2e/` against the workspace
  fixture; macro-only specs (~14) stay. The cleanup plan owns the
  generic-vs-macro classification; this plan just delivers the 29 to
  the right starting point. Do not pre-trim during Phase B — that
  would force a generic-vs-macro decision twice.
- **`apps/boring-macro-v2`'s `__tests__/` (vitest) suite** — currently
  has 214 LOC of macroTools tests. Keep as-is; no merge needed (the
  standalone never had a vitest equivalent for tools).
- **Deploy target** — which Fly app? Today Fly app name `boring-macro`
  is the standalone's deployed instance (`boring-macro.fly.dev`).
  After consolidation, point the same Fly app at the unified codebase
  so the URL doesn't change. Backups: keep the standalone running
  during cutover, swap DNS / Fly target, then archive.

## Estimated cost

- Phase A (server reconcile): 2-3 hours. Mostly diff-and-port.
- Phase B (move frontend in): 1-2 hours. Lots of file copies + path
  fixups.
- Phase C (drop shims): blocked on `CODE_OWNERSHIP_CLEANUP_PLAN.md`
  Phase 0; ~30 minutes once unblocked.
- Phase D (wire deploy): 2-3 hours including a real deploy + smoke.
- Phase E (archive): 5 minutes.

**~1 day of focused work** end-to-end, gated on Phase 0 of the
ownership-cleanup plan.
