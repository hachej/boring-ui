---
github: https://github.com/hachej/boring-ui/pull/1524
issue: 1524
state: ready-for-agent
updated: 2026-09-07
track: fast
---

# [Transcription Quality] Deliver PR #1524

## Problem

PR #1524 is mergeable and green at `aa959cfd3b7721d7cb42a4d43a7e6ed2562cd542`, with an independent Factory review approving standards/spec, thermo, assertion preservation, and package abstraction. Its only known admission gap is missing revision-bound Playwright before/after video for the changed live-transcription UI flow. The branch is also 23 commits behind current `origin/main`, so the final integration candidate must be refreshed and re-verified.

Lineage: canonical batch Bead `wt-391-forward-clu5.10` under `pr-review-batch`; this lane does not modify that batch epic.

## Solution

1. Merge current `origin/main` into the owned branch without force-pushing, preserving settled behavior and repairing only real conflicts or failed checks.
2. Run one deterministic live-transcription journey against the real base and final candidate with identical fixtures and viewport, capturing labeled before/after video plus interaction and accessibility/layout/focus assertions.
3. Re-run exact-SHA package checks and independent standards/spec, thermo, and explicit cross-package abstraction review; build the `present-pr` artifact; classify the final diff and route it according to the risk policy.

## Decisions

- Keep the existing PR and branch; no replacement PR or force-push.
- Do not reopen settled review findings unless current-main integration, proof, or fresh review produces a concrete failure.
- UI evidence must be real before/after Playwright video; screenshots or claims do not substitute.
- Final classification is revision-bound. The diff is currently plugin-only and has zero `packages/` production churn, but classification is repeated after integration.

## Flag / Abstraction

- Needed?: No new flag; delivery proof only.
- Path: Existing live-transcription plugin seams.
- Rollback: Revert the PR merge commit; no deletion, migration, release, or deployment is authorized.

## Test Seams

- Highest public seam: live-transcription user journey from capture/control through streamed/refined transcript display.
- Existing prior art: plugin unit tests, Python service tests, CI run `34108801575`, and Factory review session `0a688055-601f-4fb9-94f4-926bf3a02554`.
- Avoid testing: private implementation with fake success in place of the real UI journey; do not weaken assertions.

## Acceptance

- Branch is clean and conflict-free against current `origin/main`.
- Revision-bound Playwright before/after video and deterministic assertions are durable and linked from the PR proof.
- Relevant typecheck, unit, invariants, and integration-candidate checks pass at the final SHA.
- Independent review records standards/spec, thermo, and explicit abstraction PASS at that SHA.
- `.handoff/pr-1524-presentation.html` is generated and owner-openable.
- Final risk route is recorded; automatic eligibility produces `factory: MERGE-READY <sha>`, while a protected trigger produces exactly one merge-approval card.

## Proof

- Exact commands: package typecheck/unit/invariants plus deterministic Playwright scenario, all naming environment and SHA.
- Screenshot/demo: labeled before/after video, scenario report, and present-pr HTML.
- Manual steps: open the live-transcription surface, start the same fixture session, observe streamed speaker labels and completion/refinement in both revisions.
- Waiver: None.

## Slices

### Slice: Integrate main and capture UI proof
**Bead:** `wt-391-forward-2o4d.1`  
**Delivers:** Current-main integration and revision-bound before/after Playwright evidence.  
**Blocked by:** None.  
**Proof:** Clean merge candidate, package checks, deterministic assertions, videos, and independent exact-SHA review.  
**Review budget:** Inside; first of at most four review rounds.

### Slice: Re-verify, present, and classify delivery
**Bead:** `wt-391-forward-2o4d.2`  
**Delivers:** Exact-SHA re-verification/review, present-pr artifact, full proof record, and risk-based terminal route.  
**Blocked by:** `wt-391-forward-2o4d.1`.  
**Proof:** CI and sandbox links, review provenance, artifact path, package churn count, current-main candidate proof, and terminal PR comment/card.  
**Review budget:** Inside; remaining rounds are reserved for concrete findings.

## Out of Scope

New transcription behavior, deployment, release, branch deletion, force-push, merge execution, or edits to `pr-review-batch`.

## Open Questions

None. The gate is required by the host's final explicit instruction despite the earlier lane note saying Gate 1 was pre-granted.
