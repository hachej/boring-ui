# Code ownership cleanup — keep packages reusable, apps lean

**Status:** draft
**Owners:** workspace, agent
**Last updated:** 2026-04-28

## Problem

Tests for the `@boring/workspace` chat shell, dock, UI bridge, and `@boring/agent`
plumbing currently live in the standalone macro repo's `e2e/` directory (29
specs — see [`CONSOLIDATE_AND_STANDALONIZE.md`](../../../apps/boring-macro-v2/docs/CONSOLIDATE_AND_STANDALONIZE.md)
for how that repo merges into `apps/boring-macro-v2/e2e/`). That happened
because the macro app was the first non-trivial consumer and the tests caught real
bugs there. But the contents are mixed:

- Some specs assert macro-only things (FRED catalog, ChartCanvasPane tabs, DeckPane
  edit/save, `/api/macro/*`).
- Others test things that should be true for every app built on `@boring/workspace`
  (composer border state, dockview split-shrink, sidebar persistence keys,
  ChatCenteredShell `appTitle`, the bridge accepting `openPanel`).

Two anti-patterns this creates:

1. **Generic regressions only get caught by macro.** If a developer breaks
   `SurfaceShell`'s persisted-width hydration or `ChatCenteredShell.appTitle`, the
   first signal is a macro test failing — even though no macro code changed. The
   blame trail and reproduction loop go through macro instead of workspace.
2. **The playground accumulates app-shaped tests.** When we move generic specs
   into `apps/workspace-playground/e2e/`, the playground's job creeps from "demo
   the chat shell with a couple of mock adapters" to "be the test harness for
   `@boring/workspace`." That's a different artifact: a demo wants to be small and
   readable; a test harness wants to be deterministic and exhaustive. Stuffing
   them into one app makes both worse.

We also currently lack a place to test combinations that aren't representative of
any one app — e.g. `extraPanels` filtering, the bridge dispatcher's
`!surface ? return : run` early-out, two-instance ChatCenteredShells with
distinct `storageKey`s. None of these belong in macro or in the playground.

## Goal

Tests for `@boring/workspace` and `@boring/agent` primitives live INSIDE the
package they test, not in a downstream app. Child apps ship only the specs that
exercise app-specific contracts.

Also: define a concrete repo-wide cleanup boundary so code placement stays sane:

- `packages/*` = reusable primitives, adapters, and framework helpers.
- `apps/*` = composition, branding, product/domain logic, and deploy wiring.
- `apps/workspace-playground` remains demo-first and intentionally lean.

Concretely:

| Lives in… | Tests… | Hits… |
|---|---|---|
| `packages/workspace/e2e/` | chat shell layout, dock split/resize, UI bridge dispatcher, sidebar persistence, composer styling | Browser against a **fixture app** in `packages/workspace/e2e/fixture/` |
| `packages/agent/__tests__/` (existing) | `AgentTool` schema, harness, chat route, sessions | In-process |
| `apps/workspace-playground/` | nothing — playground stays a demo | n/a |
| `apps/boring-macro-v2/e2e/` | macro adapter shape, FRED catalog routes, ChartCanvasPane tabs, DeckPane edit/save, macro tool catalog | Browser against the macro dev server |

## Why a fixture, not the playground

The playground's `App.tsx` exists to demonstrate the package's public API to a
human reading the source. It's tuned for readability:

```tsx
<ChatCenteredShell
  appTitle="Boring"
  data={dataPaneConfig}
  onSurfaceReady={(api) => { surfaceRef.current = api }}
/>
```

A test harness wants different things — known-fixed mock data, a stable storage
key namespace, deterministic agent responses, hooks for `data-testid`, easy
two-tab side-by-side scenarios. Adding any of those to the playground hurts its
"read this to learn the API" job. Forking a small fixture under
`packages/workspace/e2e/fixture/` lets the playground stay clean.

The fixture is roughly:

```
packages/workspace/e2e/
  fixture/
    index.html
    main.tsx
    App.tsx              # uses every public API surface we test, with stable test ids
    mockSeriesAdapter.ts # deterministic, no random IDs
    mockSessions.ts
  helpers/
    boot.ts              # bootClean(page, seed) — same shape as macro's
    pane.ts              # openPaneViaBridge wait-for-tab pattern
  specs/
    composer-border.spec.ts
    chat-shell-topbar.spec.ts
    chat-suggestions.spec.ts        # asserts defaultChatSuggestions render
    dock-split-shrink.spec.ts
    extra-panels.spec.ts
    layout-persistence.spec.ts
    bridge-openpanel.spec.ts
    bridge-openfile.spec.ts
    bridge-no-surface-noop.spec.ts  # the early-out we hit
  playwright.config.ts   # webServer: vite serves fixture/ on a sibling port
  package.json           # internal — `pnpm --filter @boring/workspace test:e2e`
```

The fixture is a real Vite app (because we need a real browser + real dockview),
but it's not exported from the package and never published. It runs only when
`pnpm test:e2e` is invoked from the workspace package.

## Why not extend `boring-ui-v2/e2e/`

The repo root already has `boring-ui-v2/e2e/` with its own playwright config and
`spawnBackend` fixtures (`fixtures.ts`). That suite tests the agent backend with
isolated tmp workspaces and is geared toward **headless API + harness** behavior
(sessions persistence, mode flips, bridge protocol). It does not boot a frontend.

Mixing browser-driven UI specs into that infrastructure would duplicate Vite
boot logic and conflate "test the backend in isolation" with "test the chat
shell in a real DOM." Two suites with two configs and two purposes is cleaner:

- `boring-ui-v2/e2e/` — backend-focused, in-process, no browser, no Vite.
- `packages/workspace/e2e/` — browser-focused, real Vite + fixture app, real
  dockview + recharts.

Each can evolve at its own pace.

## Repository findings (2026-04-28 scan)

### A) `apps/boring-macro-v2` (child app)

**Keep in app (macro-specific):**

- `src/server/routes/billing.ts` (Stripe tiers, checkout/webhook, quota policy)
- `src/server/routes/waitlist.ts` (macro landing behavior)
- macro tool semantics and system prompt in `src/server/tools/macroTools.ts`
- macro env policy in `src/server/config.ts` (`BM_*`, FRED defaults)

**Extract to reusable package surfaces:**

- `src/server/services/tabBus.ts` → **delete, not extract.** The
  `@boring/workspace` UI bridge (`exec_ui` + `openPanel` command) already
  covers everything tabBus does (push a "show this series" command from
  the agent to the workbench). Migrate the macro call sites that still
  push to tabBus over to `bridge.postCommand({kind:"openPanel", ...})`
  and delete the file. Adding tabBus's API to workspace would duplicate
  the bridge surface.
- reusable pieces from `src/server/services/clickhouse.ts`
  (generic CH adapter/cache/read-only SQL guard pattern)
- reusable queue/rate-limit scaffolding from `src/server/services/fredRefresh.ts`
  (keep FRED provider app-local; move generic queue core)
- small parsing helpers in `routes/macro.ts` (`clampInt`, `optionalInt`, etc.)

### B) `apps/full-app` (integration app)

**Keep in app:**

- composition UI (`src/front/main.tsx`) and app branding
- deployment/runtime entry wiring

**Extract to `@boring/core/server` helpers:**

- auth proxy forwarding pattern from `src/server/main.ts`
- SPA static fallback + safe path checks
- CSP nonce HTML injector utility
- mixed `/auth/*` API-vs-frontend routing pattern

### C) `apps/workspace-playground` (demo app)

**Keep in app:**

- showcase seed data/messages/session stories

**Move/replace with package utilities:**

- dedupe `apps/workspace-playground/src/mockApi.ts` against
  `packages/workspace/src/testing/mockApi.ts`
- avoid growing app-local infra for fake FS/api when package testing utility
  already exists

### D) `packages/workspace` + `packages/agent`

- own all generic UI bridge behavior + its e2e/spec harness
- own generic chat-shell/dock persistence behavior tests
- avoid depending on macro for regressions in generic surfaces

## Migration plan

### Phase 0 — Build the workspace `./server` and `./shared` entries (prerequisite)

`packages/workspace/package.json` declares five subpath exports:

```jsonc
{
  ".":           "./dist/workspace.js",   // main API (ChatCenteredShell, panes, hooks, …)
  "./testing":   "./dist/testing.js",     // test helpers (TestWorkspaceProvider, mocks)
  "./ui-shadcn": "./dist/ui-shadcn.js",   // shadcn primitives (Button, Card, …)
  "./shared":    "./dist/shared.js",      // UiBridge / UiCommand / UiState types
  "./server":    "./dist/server.js"       // createWorkspaceAgentApp, uiRoutes, uiTools
}
```

…but `vite.config.ts`'s `build.lib.entry` only emits **three** of them:
`workspace`, `testing`, `ui-shadcn`. The `./server` and `./shared`
entries are declared in the package.json but never produced — so any
consumer outside the monorepo (or any tool that bypasses Vite's path
aliases) gets a broken import.

This is why earlier work had to **inline `createWorkspaceAgentApp` into
the consuming app** (`boring-macro-v2/src/server/uiBridge.ts` is a
copy-paste of `packages/workspace/src/server/createWorkspaceAgentApp.ts`
+ `uiTools.ts` + `uiRoutes.ts`). Phase 1's "import from
`@boring/workspace/server`" doesn't actually work today; it has to be
made to work first.

**Tasks:**

1. Add `tsup` to `packages/workspace/devDependencies` (already in
   `agent` and `core` — copy that pattern).
2. Add a `tsup.config.ts` that emits `dist/server.js` + `dist/server.d.ts`
   from `src/server/index.ts`, and `dist/shared.js` + `dist/shared.d.ts`
   from `src/shared/index.ts`.
3. Update `package.json` `build` script:
   `"build": "tsup && vite build"` (mirrors `agent`).
4. Add `assert-build-artifacts.mjs` parity check (`agent` already has
   one) so a missing entry fails the build instead of shipping a broken
   package.
5. Confirm `pnpm --filter @boring/workspace build` produces all five
   entries declared in the exports map.
6. Delete `boring-macro-v2/src/server/uiBridge.ts` and replace with
   `import { createWorkspaceAgentApp } from "@boring/workspace/server"`.
   This is the ground-truth verification that the build works.

Phase 0 is a prerequisite for Phase 1 (the fixture would otherwise have
to inline the same code), Phase 4 (extractions that target package
surfaces require the targets to actually be buildable), and the macro
consolidation work in
[`apps/boring-macro-v2/docs/CONSOLIDATE_AND_STANDALONIZE.md`](../../../apps/boring-macro-v2/docs/CONSOLIDATE_AND_STANDALONIZE.md)
(its Phase C drops the inlined `uiBridge.ts` workaround).

Estimated cost: half a day. Adds zero behavioural change — just makes
the package's declared API match what's shipped.

### Phase 1 — Set up the workspace fixture (one PR)

1. `packages/workspace/e2e/fixture/{index.html, main.tsx, App.tsx}` — minimal
   ChatCenteredShell with a tiny mock series adapter and 2-3 panel registrations
   (`code-editor`, `markdown-editor`, plus a stub `chart-canvas` that renders a
   recharts `LineChart` against synthetic data so dockview-shrink tests have
   something to clip).
2. `packages/workspace/e2e/playwright.config.ts` — webServer boots Vite on
   `localhost:5300` (sibling to whatever else may be running).
3. `packages/workspace/e2e/helpers/{boot.ts, pane.ts}` — port `bootClean` and
   the `openPaneViaBridge` waiter from `boring-macro-v2/e2e/helpers.ts`,
   parameterized on storage key.
4. `pnpm --filter @boring/workspace test:e2e` script.
5. Add fixture-only deterministic adapters; do **not** reuse playground app code.

### Phase 2 — Move generic specs from boring-macro

> **Coordination with the macro consolidation plan:** the 29 specs live in
> the *standalone* macro today. The macro plan's Phase B copies them into
> `apps/boring-macro-v2/e2e/`. Sequencing: do macro Phase B FIRST (move
> 29 specs in), then this Phase 2 (split — generic ones move to
> `packages/workspace/e2e/`, leaving ~14 macro-only). This avoids
> retroactively touching standalone files we're about to archive.

Specs that come over (one per file, lightly adapted to the fixture's storage key
and pane registry):

- `composer-border.spec.ts` — direct copy.
- `topbar.spec.ts` → `chat-shell-topbar.spec.ts` — assert `appTitle` prop is
  rendered. Adapted from `"boring.macro"` to `"Workspace"` (whatever the
  fixture sets).
- `split-no-clip.spec.ts` → `dock-split-shrink.spec.ts` — open two panes, drag
  bottom split, measure that the recharts wrapper inside the second group
  doesn't overflow. Uses the fixture's stub chart pane (no FRED).
- `layout-persistence.spec.ts` — sidebar collapsed/width persistence under
  `<storageKey>:surface:*`, drawer/surface flags under `<storageKey>:*`.
- `agent.spec.ts` (the workspace half) → `bridge-openpanel.spec.ts` /
  `bridge-no-surface-noop.spec.ts` — `POST /api/v1/ui/commands` accepts
  `openPanel`, dispatcher noop's when no surface mounted, dispatch fires when it
  does.

After Phase 2, `apps/boring-macro-v2/e2e/` shrinks from 29 → ~14 specs:
- `chat-suggestions.spec.ts` (macro labels)
- `catalog.spec.ts` (FRED catalog UI + 87k count + macro routes)
- `catalog-to-chart.spec.ts` (macro adapter onActivate → chart-canvas)
- `chart-tabs.spec.ts` (ChartCanvasPane Chart/Table/Metadata/Lineage + macro routes)
- `deck.spec.ts` (DeckPane + `/api/macro/deck/*`)
- `agent.spec.ts` (trimmed to assert macro tool catalog: `execute_sql`,
  `macro_search`, `get_series_data`, `persist_derived_series`)

### Phase 3 — Demo/app boundary cleanup (parallel with e2e migration)

1. Replace playground-local FS mock backend with `@boring/workspace/testing`
   equivalent (or extract common shared helper then consume from both).
2. Keep playground focused on readable composition examples; move test harness
   glue into `packages/workspace/e2e/fixture`.
3. Add boundary guardrails:
   - app-level domain terms (e.g. macro billing/waitlist/FRED policy) never land
     in package runtime paths;
   - generic dock/chat/bridge behaviors never rely on macro app tests.

### Phase 4 — Shared helper extraction from apps

> **Gating:** `@boring/core` is currently WIP — its public surface isn't
> frozen. Don't promote into a moving target. Until core lands, the
> reusable bits below live in `apps/full-app/src/server/_shared/` (or
> equivalent app-local location) and migrate to `@boring/core/server` in
> a single follow-up PR once core's API stabilises. The review checklist
> in **Enforcement** below should reject premature `@boring/core/server`
> promotion until that gate clears.

1. Stage reusable full-app server glue (auth proxy, static SPA fallback,
   CSP nonce HTML transforms) in `apps/full-app/src/server/_shared/`.
   Promote to `@boring/core/server` once core stabilises.
2. Replace macro `tabBus.ts` with `bridge.postCommand({kind:"openPanel", ...})`
   call sites — no extraction needed; the workspace UI bridge already
   owns this surface.
3. Extract generic queue/rate-limit primitive used by macro refresh
   workflows into a package utility (provider-specific fetchers remain
   app-owned). Initial home: `apps/boring-macro-v2/src/server/_shared/`,
   promote later.

### Phase 5 — New tests that don't have a home today

Things we want to lock down but that don't fit any current spec:

- `extra-panels.spec.ts` — passing `extraPanels={["foo"]}` on
  ChatCenteredShell allows `surface.openPanel({component:"foo"})`; omitting it
  blocks. Currently silent.
- `multi-shell.spec.ts` — two ChatCenteredShells on the same page with distinct
  `storageKey` props don't trample each other's persisted state. Smoke-level
  guard for future multi-pane embeds.
- `keyboard-shortcuts.spec.ts` — Cmd+1, Cmd+2, Esc behaviour. Touchy in
  headless; documented separately so it can be skipped on CI matrices that
  have known-flaky keyboards.

Phase 5 is opportunistic — none of it blocks Phases 1–4.

## Enforcement / guardrails

- Add a lightweight ownership checklist to PR template:
  - "Is this reusable across >=2 apps?" → package.
  - "Is this product policy/brand/domain?" → app.
- Add CI boundary lint/audit tasks (initially warning, later fail):
  - detect app-specific domain modules imported into package runtime code
  - detect duplicated mock-api implementations when package testing helpers exist
- Keep `apps/workspace-playground` success metric: tiny, readable demo codebase.

## Non-goals

- **Not** moving `boring-macro-v2`'s 14 macro-only specs upstream. They depend
  on the macro Fastify routes + ClickHouse + the macro app's panes. Putting
  them in workspace would force workspace to either mock those (unfaithful) or
  spawn macro (heavy + wrong scope).
- **Not** generating a "second playground" for tests. The fixture app is a
  test artifact, deliberately ugly and stable; the playground is a
  documentation artifact, deliberately readable and idiomatic.
- **Not** unifying with `boring-ui-v2/e2e/`'s spawnBackend fixtures yet. That
  suite is mature for backend testing; bolting browser specs onto it adds risk
  without removing duplication. Revisit only if the helpers genuinely converge.

## Deliverables

1. `packages/workspace/e2e/fixture/**` + migrated generic specs.
2. Reduced `apps/boring-macro-v2/e2e/**` containing only macro-specific specs.
3. Playground mock backend deduplicated with workspace testing utility.
4. Follow-up extraction tasks:
   - core server helpers from full-app
   - delete macro `tabBus`; route via existing UI bridge
   - generic queue/rate-limit primitive from macro refresh flow
5. Boundary lint/checklist documented and wired into CI.

## Open questions

- Does the fixture need its own `@boring/agent` backend (for the bridge specs),
  or can the bridge run in-process inside the Vite plugin? Probably the
  former, mirroring how the playground already boots `createAgentApp` from
  vite.config.ts.
- Should the fixture export its mock adapter from `@boring/workspace/testing`
  so child apps can reuse it? Tempting. Risk is that "testing" subpath grows
  into another public surface to maintain. Decide after the fixture stabilises.
- CI cost: the fixture suite + macro suite + root e2e all boot Vite. Total
  cold-boot is ~3 minutes of Vite work. If that's too much, share a
  `vite-node-server` process across suites. Out of scope for the initial move.
