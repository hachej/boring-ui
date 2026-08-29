# Feature programs — canonical trackers

Owner triage 2026-08-27: the standalone GitHub epic issues for these programs
are closed. This page is their canonical home; work items exist only as
concrete PRs/issues. Do not reopen umbrella issues for these programs — amend
this page instead.

## Durable streams — restart-safe agent interactions

- Status: **ACTIVE** — P1-A is approved and dispatchable as five beads
  (`9p50.1/.3/.4/.5/.6`); P1-B (`9p50.7`) builds the Boring event backend
  after A2 — the pi wait was removed 2026-08-27 (RECONCILIATION §9c); P1-C
  (`9p50.2`) runs last. See `premises.md` P1 for the slice table.
- Detailed P1-A plan (one section per bead, dispatch order A2→A1→A3→A4→A5):
  [`../durable-streams-p1a-plan.md`](../durable-streams-p1a-plan.md) — draft, in the review ladder.
- Plan: [`../durable-streams-plan.md`](../durable-streams-plan.md) (r3; the
  r2 body's "blocked on the second cross-model review" note applied only to
  the r2 plan body and does not gate P1-A — see the plan's r3 revision
  summary and its review log).
- Ratified basis: `docs/plans/long-term/ratified/recommendations/R-33-02-durable-pause/`.
- Acceptance bug (stays open until this ships): **#1348** — pending owner gates
  are marked abandoned when the hub restarts.
- Scope absorbed from closed items: **#1413** (C5: resume a paused ask_user
  turn after process restart); PR **#1384** (closed — salvage its restart-safe
  gates, thin decision record, and store hardening from its branch rather than
  rewriting; +2160 reviewed lines, CI was green).

## Sandbox worker runtime (was epic #1081)

- Architecture: merged **#1220** (sovereign fleet + sandbox bridge, owner-gated)
  and merged **#1394** (hardened Docker/bwrap runtimes).
- Remaining work: SBX1.3 session-lifetime salvage lands as concrete PRs against
  the merged architecture; no umbrella issue.

## BYOK tenant keys (was epic #1082)

- Front door: the stacked PR pair **#1145** (S1: durable credential
  persistence + externally-anchored rollback protection) → **#1164** (slice B:
  pi-derived startup registry + vault resolver composition). Merge S1 first,
  then retarget slice B to main (stacked-PR rule).
- Slice map (S1, PR-B/C/D) lives in those PR bodies (plan r3 / onboarding r2).

## Executable environments / env-mounts (was epic #1123)

- Slice 1 PR **#1166** was closed; the extracted bwrap dedupe merged as #1359.
- Re-derivation contract for the substrate's return: rebased on the
  upload-era catalog, `stat` TOCTOU wrapped, `globalToolMountArgs` init-cache
  resolved, and bundled with slice 2 so `context.mounts` has a producer.
- Governed by DIRECTION and the ratified plan; environment execution semantics
  per the durable-streams plan's spine authority section.
