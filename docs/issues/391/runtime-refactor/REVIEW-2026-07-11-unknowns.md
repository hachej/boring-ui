# 391 Runtime Refactor - Plan Review & Unknowns Ledger (2026-07-11)

Method: full plan-pack synthesis, implementation audit against `origin/main`,
and the scale, security, failure, edge-case, concurrency, migration, and
rollback lenses. Live status below was reverified after merging current main
into this review branch. GitHub PR labels alone are not evidence of ancestry.

## Verified facts

- Decision 21 and the workspace-first correction are on main through
  [#617](https://github.com/hachej/boring-ui/pull/617),
  [#616](https://github.com/hachej/boring-ui/pull/616), and
  [#622](https://github.com/hachej/boring-ui/pull/622).
- P6-D identities and the deterministic A1 directory compiler are on main via
  [#623](https://github.com/hachej/boring-ui/pull/623) and
  [#624](https://github.com/hachej/boring-ui/pull/624).
- P1 has the real `/core` relocation and terminal local binding disposal on
  main via [#626](https://github.com/hachej/boring-ui/pull/626) and
  [#627](https://github.com/hachej/boring-ui/pull/627). The next P1 slices are
  request-binding/service teardown lifecycle and fail-closed readiness; they
  are not recorded as landed until their own PRs are ancestors of main.
- P2 has one structural runsc preflight on main via
  [#628](https://github.com/hachej/boring-ui/pull/628). It explicitly reports
  `productionReady: false`; it does not prove lifecycle, security policy,
  provider availability, or EU parity.
- M1 has a partial delegate-server tracer on main via #538. It is an optional,
  non-blocking outreach leaf. It is not the v1 product acceptance path.
- The binding v1 acceptance is exact hostname -> landing/auth -> authorized
  workspace -> deployed agent selected as that workspace's `default`.

## Accepted actions

1. **Verify ancestry before status changes.** When a stacked base is superseded,
   retarget descendants to main immediately. Record `landed` only after
   `git merge-base --is-ancestor <merge-sha> origin/main` succeeds.
2. **Keep INDEX single-writer.** The owner/orchestrator is the only writer for
   ordering and live status in `INDEX.md`. Other plan files link to it and add
   scoped amendment banners instead of redefining the queue.
3. **Keep pure/no-environment out of v1.** Add a P8 residual grep covering
   `runtime.*none|pure.*mode` in product code and non-historical docs. Explicit
   historical and rejection tests are allowlisted, not silently deleted.
4. **Run a real EU validation spike before D1 locks.** #628 is structural only.
   A time-boxed spike must validate systrap availability, isolation/network
   policy, limits, image handling, lifecycle cleanup, and authenticated facts
   on the intended EU host. Unknown facts fail closed.
5. **Treat X1 thresholds as provisional.** The current benchmark report records
   PATH/ordering defects. Rerun before any threshold becomes an acceptance gate.
6. **Measure the shipping baseline.** P8 records elapsed setup-to-first-run time
   and its breakdown. Fifteen minutes is a target to evaluate, not an asserted
   pre-existing baseline or a pass/fail gate until evidence supports it.

## Resolved owner rulings

- **#545 close intent (raised by the earlier revision of this ledger):**
  resolved 2026-07-11 (owner) — #545's close was an intentional scope drop,
  superseded by recuts #566/#568/#575/#576 — nothing to recover; the P1
  critical path runs through the recuts.
- **#380 / BBA-015 and BBA-016: RETIRED (owner, 2026-07-11).** Their only
  named consumer was issue #380 ("Allow external harnesses to create
  review/question hooks"), which is CLOSED. Per decision 21's re-evaluate
  clause, the beads are retired; revive only if a live, named consumer issue
  reappears. They cannot reintroduce public `runtime: 'none'`.
- **Commercial/operational default: Deferred (owner, 2026-07-11).** Near-term
  requirement instead: v1 must produce a clean, purely-Docker deployable
  state — one image/compose artifact the owner can run in his own prod OR in
  a dedicated tenant VM. D1/provisioning choices must not lock out either
  path; retainer-vs-self-host business model decided later.

## Owner decisions still open

- **Runsc EU provider:** D1 cannot lock its provider/profile until the validation
  spike produces evidence; #628 deliberately leaves those facts unknown.

## Corrected workstream audit

| Workstream | Evidence-backed state on main | Next plan action |
| --- | --- | --- |
| P0 / Decision 21 | Landed through #617 | Keep workspace-first acceptance binding. |
| P1 core/lifecycle | Core/local lifecycle landed through #627 | Finish request-binding/service teardown, then fail-closed readiness. |
| P2 runsc | #628 structural preflight only; `productionReady: false` | Validate lifecycle/security/provider facts on a real EU target before D1 lock. |
| P6-D | Minimal identities/digests landed in #623 | Consume from P6-R; do not widen schema speculatively. |
| A1 compile | Deterministic compiler landed in #624 | Add workspace-backed local validate/dev after P6-R. |
| P5a / P6-R / D1 | Not landed | Execute narrowly in dependency order against the dedicated-site acceptance. |
| R0/M1 | Partial optional tracer (#538) | Recut only if outreach value justifies it; never block v1. |
| T1/T2, full P3, E1 | Deferred/post-v1 | Keep frozen until a named consumer reopens them. |
| X1 S3/FUSE | Draft isolated research (#581) | Rerun flawed benchmark; no v1 dependency. |
| P8 | Pending | Add residue grep and measured setup-to-first-run evidence. |

The earlier audit correctly exposed the stacked-PR trap and several operational
unknowns. Its claims that #623/#624 were not on main, that P2 had no landed
implementation, and that P1 -> M1 was the business critical path became stale
or were unsupported by the binding product acceptance; this revision corrects
those claims without weakening the accepted controls.
