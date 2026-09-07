---
github: https://github.com/hachej/boring-ui/pull/1544
issue: 1544
state: ready-for-agent
updated: 2026-09-07
track: owner
---

# [Chat Event Ownership] Deliver PR #1544

## Problem

PR #1544 is green at `c3a721509c57c63cf02a81f47d6a01573c7536af`, but its latest independent review found that `RemotePiSession` treats cursor advance as event acceptance. The reducer may advance its cursor while rejecting a stale-turn or contradictory terminal event, so `onEvent` can reach `onTurnComplete` for an event the state machine did not accept. Exact-SHA sandbox and before/after Playwright evidence are also missing, and the branch must be validated against current `origin/main`.

Canonical lineage is batch Bead `wt-391-forward-clu5.3` under `pr-review-batch`; this lane does not modify that epic.

## Solution

Keep the existing public callback intent unless inspection proves it must change. Make reducer acceptance explicit enough that the transport invokes callbacks only for accepted events, cover rejected terminal-event cases at the reducer/session/real caller seams, reconcile current main, capture revision-bound browser evidence, then obtain independent standards/thermo/abstraction review of the final SHA. Update existing PR #1544 only; never merge from this lane.

## Decisions

- Preserve callback/public-contract semantics by default; this is an implementation repair, not authority to redesign the callback.
- If correctness genuinely requires a public contract or package-ownership change, stop at the protected boundary and identify the precise owner decision rather than silently widening scope.
- Proof precedes final independent review so the reviewer can inspect actual revision-bound evidence.
- Delivery routing is determined from the complete final diff and current `origin/main`, not the current 218-addition/22-deletion snapshot.

## Flag / Abstraction

- Needed?: No feature flag; this repairs event acceptance and callback ownership on an existing path.
- Path: `RemotePiSession` stream → reducer acceptance → callback → `PiChatPanel` turn completion.
- Rollback: revert the PR's Chat Event Ownership commits; no migration or persisted-data transform is involved.
- Protected trigger to re-check: public API/callback contract and package-boundary ownership. Current package production churn is 46 lines (37 in `PiChatPanel.tsx`, 5 in `remotePiSession.ts`, 6 in `piChatPanelHooks.ts`, additions+deletions), below the >500 trigger; tests are excluded from that numeric trigger only.

## Test Seams

- Highest public seam: `RemotePiSession` event callback observed through `PiChatPanel`'s `onTurnComplete` behavior.
- Existing prior art: `remotePiSession.test.ts` stream/recovery cases and `PiChatPanel.test.tsx` real remote transport case.
- Avoid testing: cursor movement alone as a proxy for reducer acceptance; mocks that bypass the real reducer/callback path.

## Acceptance

- Stale-turn and contradictory terminal events do not trigger callback-owned completion behavior.
- Accepted events are still dispatched before callback observation, duplicates/gaps remain fenced, and valid terminal events complete once.
- Branch is conflict-free and verified against current main.
- Exact final SHA has package checks, deterministic before/after Playwright video, present-pr artifact, independent standards/spec + thermo verdicts, and an explicit abstraction PASS.
- Existing PR #1544 receives complete revision-bound proof and either `factory: MERGE-READY <sha>` when eligible/enforced or one protected merge-approval card. The lane never merges.

## Proof

- `pnpm --filter @hachej/boring-agent exec vitest run src/front/chat/__tests__/PiChatPanel.test.tsx src/front/chat/pi/__tests__/remotePiSession.test.ts <focused reducer tests>`
- `pnpm --filter @hachej/boring-agent typecheck`
- `pnpm lint:invariants` and applicable import/package checks
- Exact-SHA sandbox execution plus same-fixture Playwright before/base and after/candidate recording with deterministic assertions
- GitHub CI and controlled integration validation against the then-current `origin/main`
- Independent `fresh_review`: standards/spec, thermo, and explicit package-abstraction PASS

## Slices

### Slice: Repair accepted-event callback semantics
**Bead:** `wt-391-forward-3brt.1`  
**Delivers:** reducer/session/caller repair, focused regressions, and current-main reconciliation.  
**Blocked by:** None.  
**Proof:** focused Vitest, agent typecheck, invariants, clean current-main relationship.  
**Review budget:** Inside one implementation/review round; stop for a genuine public-contract decision.

### Slice: Capture exact-revision browser proof
**Bead:** `wt-391-forward-3brt.2`  
**Delivers:** exact-SHA sandbox checks, deterministic before/after Playwright video, and present-pr artifact.  
**Blocked by:** `wt-391-forward-3brt.1`.  
**Proof:** artifact/report paths, commands, assertions, base/head SHAs.  
**Review budget:** Inside one proof session.

### Slice: Obtain independent final review
**Bead:** `wt-391-forward-3brt.3`  
**Delivers:** exact-SHA standards/spec and thermo verdicts plus explicit abstraction PASS; fixes and re-review if needed.  
**Blocked by:** `wt-391-forward-3brt.2`.  
**Proof:** reviewer session/model/provenance, SHA, findings and dispositions.  
**Review budget:** Maximum four rounds for the SHA lineage.

### Slice: Validate integration and route delivery
**Bead:** `wt-391-forward-3brt.4`  
**Delivers:** current-main candidate validation, final risk classification, complete PR proof/show-me/handover, and authorized terminal route.  
**Blocked by:** `wt-391-forward-3brt.3`.  
**Proof:** base/main/head SHAs, CI, package churn calculation, review/proof links, final PR comment or owner-card-ready record.  
**Review budget:** Inside one integration session; any code change invalidates affected evidence and loops back.

## Out of Scope

- Merging PR #1544, force-pushing, creating a replacement PR, changing unrelated chat behavior, modifying `pr-review-batch`, or weakening tests/proof requirements.

## Open Questions

- **Worker/reviewer:** Can reducer acceptance be exposed internally while preserving the current public callback contract? If no, record the exact protected owner decision.
- **Final classifier:** Does the actual final diff match any protected boundary after all repairs and current-main reconciliation?

## Plan review

The latest independent repair review (`6dc9126c-3edb-4c3c-8b61-5278271881a9`, `openai-codex/gpt-5.6-sol`) supplied the central adversarial finding and proof gaps used by this plan. No separate pre-gate independent-review mechanism is exposed to the Orchestrator; the owner decides at Gate 1 with that limitation explicit.
