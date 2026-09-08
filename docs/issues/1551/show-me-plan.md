# [Changed Workspace Verification] Plan, visually

**Status:** Awaiting Gate 1 · **Epic:** `wt-391-forward-76c7` · **PR:** #1551

The lane turns an already-reviewed but main-stale PR into one exact-SHA, independently verified delivery candidate without changing merge authority.

## Structure — what this lane touches

```diff
 PR #1551 @ 93ca43a93
 ├── changed-workspace scripts + real-Git tests
 ├── repository workflow docs
 └── Workspace hook test cleanup
+
+Delivery lane
+├── integrate current origin/main
+├── repair conflicts/findings only
+├── exact-SHA checks + independent review
+├── explicit package-abstraction PASS
+└── present-pr proof + final risk route
```

## Behavior — how it reaches a terminal state

```mermaid
sequenceDiagram
    participant O as Orchestrator
    participant W as Worker
    participant G as GitHub / CI
    participant R as Independent reviewer
    O->>W: Dispatch wt-391-forward-76c7.1 after Gate 1
    W->>G: Integrate current main; repair; push existing branch
    G-->>W: Exact-head CI results
    W->>R: Standards/spec + thermo + abstraction review
    R-->>W: PASS or concrete findings
    W->>W: Fix findings and re-review (max 4 rounds)
    W-->>O: Handoff with SHA, proof, provenance, present-pr
    O->>O: Reclassify final diff
    O-->>G: MERGE-READY, or one exact-SHA owner gate
```

## Change shape — authority remains bounded

```diff
- Earlier batch evidence at exact SHA 93ca43a93
+ Current-main integration candidate at a newly verified exact SHA

  Worker
+   may repair, test, review, commit, and push the existing epic branch
-   may not merge, force-push, close its own Bead, or touch other worktrees

  Orchestrator
+   reads Bead end-state, classifies risk, and raises the required final route
-   does not implement or merge
```

## Risk and proof

| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| Current main conflicts with the PR | Medium | Medium | Integrate first; rerun all affected proof |
| Prior review becomes stale | Certain if SHA changes | High | Independent review and CI bind to final SHA |
| Abstraction regression is missed | Low | High | Explicit independent PASS inspecting callers/contracts |
| Test cleanup weakens assertions | Low | Medium | Preserve assertions; focused and full Workspace suites |

**Proof path:** changed-workspace regression suite; focused hook test; Workspace build/typecheck/full suite; invariants; final-head CI; independent standards/spec, thermo, and abstraction verdict.

**Plan review:** no host-provided independent plan-review mechanism is available before Gate 1; the owner decides with this bounded one-slice graph.
