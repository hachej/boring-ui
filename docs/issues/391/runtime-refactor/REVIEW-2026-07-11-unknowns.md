> **Status: historical snapshot/evidence; non-dispatchable.**
> Decision 28 and `docs/issues/391/plan.md` govern current sequencing. This file
> cannot dispatch work; any retained idea requires explicit adoption by the
> active child plan and Decision 28 Bead graph.

# 391 Runtime Refactor - Plan Review & Unknowns Ledger (2026-07-11)

**Dated snapshot (2026-07-11, pre-#642/#647/#649/#650/#657/#664). INDEX.md is
the live status authority.**

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
- P1 has the real `/core` relocation, terminal local binding disposal, and Pi
  terminal teardown on main via [#626](https://github.com/hachej/boring-ui/pull/626),
  [#627](https://github.com/hachej/boring-ui/pull/627),
  [#630](https://github.com/hachej/boring-ui/pull/630), and
  [#631](https://github.com/hachej/boring-ui/pull/631). The only remaining P1
  recut is fail-closed readiness.
- P2 has one structural runsc preflight on main via
  [#628](https://github.com/hachej/boring-ui/pull/628). It explicitly reports
  `productionReady: false`; it does not prove lifecycle, security policy,
  provider availability, or EU parity.
- M1 has a partial delegate-server tracer on main via #538. Under the owner
  priority ruling it follows the multi-agent host and becomes the ingress for
  priority-2 artifact consumption; old #549/#556 require current-main recuts.
- The binding v1 acceptance is one Docker host with N deployed agents mapped
  through authorized workspaces, while every exact hostname still resolves
  landing/auth -> authorized workspace -> that workspace's deployed `default`.

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
4. **Run a real EU validation spike before P2 claims production-ready.** #628 is structural only.
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
  resolved 2026-07-11 (owner) — #545's close was intentional. Later audit
  found #566's host-global capability snapshot unsafe for N bindings, #568's
  asset registry unenforced, #575 superseded by #626, and #576 lifecycle
  superseded by #627/#630/#631. Recut only #576's live fail-closed readiness
  semantics against post-#631 main; do not replay old commits.
- **#380 / BBA-015 and BBA-016: RETIRED (owner, 2026-07-11).** Their only
  named consumer was issue #380 ("Allow external harnesses to create
  review/question hooks"), which is CLOSED. Per decision 21's re-evaluate
  clause, the beads are retired; revive only if a live, named consumer issue
  reappears. They cannot reintroduce public `runtime: 'none'`.
- **Deployment topology (owner, 2026-07-11).** V1 first proves one clean
  Docker image/compose deployment hosting N agent bundles mapped to authorized
  workspaces/defaults. Running the same artifact in a dedicated tenant VM is
  variant 2, not the first implementation path. Retainer-vs-self-host business
  model remains deferred.

## Owner decisions still open

- **Runsc EU provider:** #628 deliberately leaves production facts unknown.
  This blocks P2 completion, not P6-R or D1, which keep using the existing
  approved in-monolith runtime composition until provider extraction lands.

## Corrected workstream audit

| Workstream | Evidence-backed state on main | Next plan action |
| --- | --- | --- |
| P0 / Decision 21 | Landed through #617 | Keep workspace-first acceptance binding. |
| P1 core/lifecycle | Core/local/Pi/request lifecycle landed through #631 | One fail-closed readiness recut only. |
| P2 runsc | #628 structural preflight only; `productionReady: false` | Keep the Sol recut isolated; validate EU lifecycle/security/provider facts in priority 4, after product increments. |
| P6-D | Minimal identities/digests landed in #623 | Consume from P6-R; do not widen schema speculatively. |
| A1 compile | Deterministic compiler landed in #624 | Add workspace-backed local validate/dev after P6-R. |
| P5a / P6-R / D1 | Not landed | P6-R resolves one authorized workspace/default binding per pure call; D1-R0 specifies the N-binding Docker host; add P5a only for a demonstrated missing seam. |
| M1 / AR1 / M2-E2 | M1 partial tracer (#538); AR1 reserved | After D1, recut #549/#556, specify artifact share/intake, then graduate canonical MCP/consumer seams without P7/T2/E1 gates. |
| T1/T2 | Deferred priority 3 | Recut after priority-2 proof for multi-channel consumption of the same agent. |
| full P3, generic E1 | Deferred | Keep frozen until a second real consumer exists. |
| X1 S3/FUSE | Draft isolated research (#581) | Rerun flawed benchmark; no v1 dependency. |
| P8 | Pending | Add residue grep and measured setup-to-first-run evidence. |

The earlier audit correctly exposed the stacked-PR trap and several operational
unknowns. Its claims that #623/#624 were not on main, that P2 had no landed
implementation, and that P1 -> M1 was the business critical path became stale
or were unsupported by the binding product acceptance; this revision corrects
those claims without weakening the accepted controls.
