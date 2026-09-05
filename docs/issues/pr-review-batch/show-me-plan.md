# [PR Review Batch] Plan, visually

This epic changes no product code. Eight independent Workers each inspect and prove one external PR; the Orchestrator turns each completed handoff into an owner merge-decision request.

## Structure — what the epic owns

```text
[PR Review Batch] Epic (wt-391-forward-clu5)
├── .1  PR #1542 — Handle Persistence
├── .2  PR #1543 — Plugin Exports
├── .3  PR #1544 — Chat Event Ownership
├── .4  PR #1547 — Invite Idempotency
├── .5  PR #1545 — Gateway Retry
├── .6  PR #1546 — Host Drain
├── .7  PR #1540 — Package Cleanup
└── .8  PR #1541 — Toast Delivery

No dependencies between review slices · maximum two Workers in flight
```

## Behavior — one identical review flow per PR

```mermaid
sequenceDiagram
    participant O as Orchestrator
    participant W as Worker
    participant S as Exact-SHA sandbox
    participant R as fresh_review
    participant G as GitHub PR
    participant U as Owner Inbox
    O->>W: dispatch pull-based Worker
    W->>W: claim one ready, unassigned Bead
    W->>G: fetch and inspect exact PR head
    W->>S: focused tests + changed packages + typecheck + invariants
    W->>R: adversarial review at exact SHA
    W->>G: post verdict, proof, and findings
    W-->>O: complete Bead handoff
    O->>U: request per-PR merge decision
```

## Diff-shaped outcome — what is added around existing PRs

```diff
 External PR #n at exact SHA
+├── mergeability and CI receipt
+├── dedicated-sandbox proof receipt
+├── independent fresh_review receipt
+├── [PR Review Batch] GitHub review comment
+├── complete Bead handoff and merge recommendation
+└── owner Inbox merge-decision request

 Product source on epic/pr-review-batch
+└── no changes
```

## Gate 2 proof

- Eight non-epic Beads have complete handoff comments.
- Eight PR review comments exist.
- Eight per-PR Inbox decisions have been requested.
- Final Gate 2 summarizes verdicts and owner decisions received so far.
- Agents never merge or close any reviewed PR.
