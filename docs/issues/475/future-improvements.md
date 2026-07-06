---
github: https://github.com/hachej/boring-ui/issues/475
issue: 475
state: shipped-v1
phase: retrospective
track: owner
updated: 2026-07-06
---

# gh-475 — Governance v1: known gaps & future improvements

v1 shipped via the #476→#539 stack, rolled up in PR #544. This records what was
**deliberately left out or deferred**, so future work starts from decisions, not
archaeology. None of these block v1; all failure modes are fail-closed.

## Policy & admin experience

1. **Admin-editable policy.** v1 is YAML file + process restart. Future: edit
   grants/budgets from `GovernanceAdminView` (needs policy persistence, audit
   trail, and a reload path — the plugin owns no DB migrations today, so
   storage design is the real question).
2. **Missing-YAML stance.** Missing policy source silently disables governance
   (safe default, decided). Revisit whether ops needs a louder signal (startup
   log exists; consider a health/readiness surface or admin banner showing
   "governance: disabled — no policy source").
3. **Dedicated error code for model denial.** Model-grant rejection currently
   reuses `TOOL_INVALID_INPUT` (400). A dedicated code (e.g.
   `MODEL_NOT_ALLOWED`, 403) would let the front distinguish "typo" from
   "denied by policy" and message accordingly.

## Company context

4. **Readwrite rules.** v1 rules are readonly-only projections. Readwrite
   grants need conflict/ownership semantics (who wins on concurrent writes,
   how writes interact with the managed-workspace marker) — design before code.
5. **Front discovery.** No affordance in the Files pane advertises that a
   company-context mount exists/is filtered; users find it by exploring.
   Consider a labeled mount node or empty-state hint driven by
   `/governance/me`.
6. **`restore()` lacks a `managedBy` guard.** Workspace restore does not check
   the managed marker the way delete does; a restored workspace could drift
   from bootstrap expectations. Low risk (bootstrap reconciles on boot), but
   the guard should exist for symmetry.
7. **`process.cwd()` fallback in the default company-context root resolver.**
   Explicit `BORING_GOVERNANCE_COMPANY_CONTEXT_ROOT` is the intended prod
   path; the cwd-relative default is a dev convenience that could surprise in
   odd deployments. Consider requiring the env var outside dev.

## Seams & architecture (locked triggers)

8. **Admin surface plurality.** Single `companyAdmin` slot today. When a
   second plugin needs an admin/workspace-management surface, evolve to
   `adminSections: Section[]` — see DECISIONS.md §19 (app array order
   authoritative; no dynamic registration).
9. **Server plugin contract width.** Governance seams (`filterModels`,
   `metering`, `getFilesystemBindings`, `pi`) are hand-spread by the app. When
   a second plugin needs any of these, design seam composition (chaining
   order, sink precedence) from the two real consumers — do not pre-build.
10. **Plugin-owned migrations.** `PostgresModelBudgetStore` + migrations
    0015/0016 live in core because core owns drizzle. If internal plugins
    multiply and need their own tables, revisit plugin-owned migration infra.

## Robustness watch-list (not tasks — review-time attention)

- **Run-context threading** (`createHarness.ts` AsyncLocalStorage +
  queued-follow-up WeakMap) is the most fragile mechanism in the epic: any new
  code path that spawns a run without binding context silently loses identity
  (fails closed to "no access", the right direction, but a debugging tax).
  Treat the #498 test suite as a guardrail; extend it with every new run-spawn
  path.
- **UI/agent parity** rests on both surfaces calling the same
  `getFilesystemBindings` — keep it that way; never add a second decision
  path for "what can this user see".
