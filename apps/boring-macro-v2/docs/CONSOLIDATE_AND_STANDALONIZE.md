# Consolidate the macro app + make it portable

**Status:** draft
**Owner:** macro
**Last updated:** 2026-04-28

## Problem

There are two macro apps today:

1. **`apps/boring-macro-v2/`** (in this monorepo) — server-only Fastify app
   (~2.9k LOC). Has Stripe billing, FRED refresh job, ClickHouse data
   service, agent tools, the macro Fastify routes. **No frontend.**
2. **`/home/ubuntu/projects/boring-macro-v2/`** (separate folder, not in
   this monorepo) — full-stack app built during the migration session.
   Has the React frontend (ChartCanvasPane, DeckPane, App.tsx wired to
   ChatCenteredShell), an inlined `uiBridge.ts` (workaround for
   `@boring/workspace/server` not being built), 29-spec e2e suite,
   `.pi/APPEND_SYSTEM.md`. Has a *copy* of older versions of
   `clickhouse.ts`, `macroTools.ts`, `config.ts`, `macroRoutes.ts`.

The two are diverging:

- Backend changes (e.g. tabBus, billing, fredRefresh) only landed in
  the in-monorepo version.
- Frontend changes (ChartCanvasPane tabs, DeckPane edit, lineage
  routes) only exist in the standalone.
- Both define `clickhouse.ts`, `macroTools.ts`, `config.ts` — same
  filenames, different content. Pure recipe for "fixed in one, broken
  in the other."

## Goal

**Single source of truth at `apps/boring-macro-v2/`** containing the
full stack, depending only on the workspace packages, and structured so
that `git mv apps/boring-macro-v2/` to a sibling-or-external repo is a
mechanical move — not a rewrite.

That means:

1. **Front-end + back-end live together** under `apps/boring-macro-v2/{src/front, src/server}`,
   matching the `apps/full-app/` shape.
2. **All cross-package dependencies go through `@boring/*` package
   names**, never relative paths into other apps or directly into a
   package's `src/`. Inside the monorepo this resolves via pnpm
   workspaces; in a future extracted repo it resolves via `file:` /
   published versions of the same package names.
3. **The standalone repo dies** — its current contents are merged into
   the monorepo app. `/home/ubuntu/projects/boring-macro-v2/` becomes a
   `.boring-macro-v2-standalone-archive-2026-04-28/` rename + reference
   only.
4. **Portability checklist passes** — see the bottom of this doc.
   Anything that today only works because of monorepo Vite path
   aliases or workspace-root tooling gets ported to portable
   equivalents.

## What stays where (final shape)

```
apps/boring-macro-v2/
  src/
    front/                          ← from standalone /src/web/
      main.tsx
      App.tsx                       — ChatCenteredShell + macro panes registered
      panes/
        ChartCanvasPane.tsx         — Chart/Table/Metadata/Lineage tabs
        DeckPane.tsx                — markdown + TimeSeries widgets, edit/save
      macroSeriesAdapter.ts         — DataCatalog adapter → /api/macro/catalog
      sessions.ts                   — localStorage-backed session list
      app.css
    server/                         ← from in-monorepo apps/boring-macro-v2/src/server
      index.ts                      — boots createWorkspaceAgentApp + macro routes + extras
      config.ts                     — BM_* env, ClickHouse + Stripe creds
      routes/
        macro.ts                    — /api/macro/{catalog,facets,series,deck,…}
        billing.ts                  — Stripe checkout/webhook/quota
        waitlist.ts                 — landing email capture
      services/
        clickhouse.ts               — DataService (single canonical version)
        fredRefresh.ts              — daily refresh job
      tools/
        macroTools.ts               — execute_sql, macro_search, …
      __tests__/
  e2e/                              ← from standalone /e2e/
    playwright.config.ts
    helpers.ts
    *.spec.ts                       — only macro-specific (post-cleanup-plan migration: ~14 specs)
  deck/                             ← seed deck files for tests + bootstrap
  .pi/APPEND_SYSTEM.md              — pi system-prompt addendum
  index.html
  vite.config.ts                    — front + agent backend boot
  tsconfig.json (and tsconfig.server.json if needed)
  package.json
  Dockerfile
  fly.toml
  .env.example
  README.md
```

Files that cease to exist:

- `apps/boring-macro-v2/src/server/services/tabBus.ts` — replaced by
  `bridge.postCommand({kind:"openPanel"})` (see CODE_OWNERSHIP_CLEANUP_PLAN
  Phase 4). 6 call sites in `routes/macro.ts` + `tools/macroTools.ts`.
- `boring-macro-v2/src/server/uiBridge.ts` (in the standalone) — the
  hand-inlined `createWorkspaceAgentApp`. Deleted once
  `@boring/workspace/server` is built (CODE_OWNERSHIP_CLEANUP_PLAN
  Phase 0).
- `boring-macro-v2/src/web/workspace-types.ts` (in the standalone) —
  the local type shim used while `@boring/workspace`'s `dist/.d.ts`
  was empty. Deleted once workspace's types are stable.

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
(`@boring/workspace/server` actually builds).

1. Delete `src/server/uiBridge.ts`. Replace with
   `import { createWorkspaceAgentApp } from "@boring/workspace/server"`.
2. Delete `src/front/workspace-types.ts`. Replace imports with
   `from "@boring/workspace"`.
3. Replace `tabBus` call sites (6) with `bridge.postCommand` per the
   ownership-cleanup plan.

### Phase D — Wire deploy

1. Borrow `apps/full-app/Dockerfile` + `fly.toml` shape; adapt for
   macro (different env vars, different fly app name, different routes
   to expose).
2. Check `BM_CH_*` + Stripe + Anthropic secrets are read from env in
   prod; document in `.env.example`.
3. Move `agent-system-prompt.txt` (used today by the standalone) into
   `.pi/APPEND_SYSTEM.md`. Pi auto-discovers it, no code change
   needed.
4. End-to-end smoke against the deployed instance (one session,
   `macro_search` query, `exec_ui openPanel` chart open).

### Phase E — Archive the standalone

1. Rename `/home/ubuntu/projects/boring-macro-v2/` →
   `/home/ubuntu/projects/.boring-macro-v2-standalone-archive-2026-04-28/`.
2. Add a top-level README to the archive: "merged into
   `boring-ui-v2/apps/boring-macro-v2/` on 2026-04-28; see
   docs/CONSOLIDATE_AND_STANDALONIZE.md for the migration record."
3. Delete after one month if nothing's been pulled out of it.

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
- [ ] `vite.config.ts` resolves `@boring/workspace` (and friends)
      through standard Node resolution — *not* through hardcoded
      `resolve(__dirname, "../../packages/workspace/src/index.ts")`
      aliases. Today the standalone uses path aliases for HMR; the
      consolidated app should rely on the package's built `dist/`
      (like `apps/full-app/` does) so it works outside the monorepo.
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

- **Standalone's `agent-system-prompt.txt`** — is it still consumed
  anywhere, or is everything in `.pi/APPEND_SYSTEM.md` now? Check on
  the way through. The standalone has both files at root.
- **The standalone has its own e2e suite (29 specs)** that already
  hits the macro frontend + ClickHouse. After
  `CODE_OWNERSHIP_CLEANUP_PLAN.md` Phase 2 trims it to ~14 macro-only
  specs, those 14 land in `apps/boring-macro-v2/e2e/`. The other ~15
  generic specs go to `packages/workspace/e2e/`. Do this trim during
  Phase B, not later — easier to land lean than to land bloated and
  retroactively split.
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
