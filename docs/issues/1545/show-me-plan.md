# [Gateway Retry] Plan, visually

**Status:** Ready for owner plan decision  
**Orchestrator:** session `463da74c-35e5-49cb-bb7f-78fd4d41c30f`  
**Epic:** `pr-1545-gateway-retry` · `wt-391-forward-uchc`  
**PR:** #1545 · starting head `25b2d76e39650de4b42cc75b7f19a9bfdd5f1075`

The repair replaces serial-looking proof with real SQLite contention, aligns the canonical contract, and then independently validates the exact protected revision.

## Structure — what changes

```diff
 packages/agent/
 ├── src/server/agent-host/
 │   ├── sqliteRequestLedger.ts             # runtime contract stays stable unless real contention exposes a defect
 │   └── __tests__/
-│       └── requestLedger.test.ts           # same-thread Promise.all over synchronous calls
+│       ├── requestLedger.test.ts           # coordinates genuinely parallel SQLite writers
+│       └── <parallel fixture if needed>    # separate worker/process connection
 ├── docs/AGENT_GATEWAY_V0.md                # already carries shipped API
 docs/plans/agent-runtime/gateway/
-└── plan.md                                 # superseded pending-admission wording
+└── plan.md                                 # retry marker + atomic reclaimed ownership
 docs/issues/1545/                            # exact-SHA plan/proof/show-me artifacts
```

## Behavior — risky flow under proof

```mermaid
sequenceDiagram
    participant Setup as Test coordinator
    participant DB as Shared SQLite WAL DB
    participant A as Parallel writer A
    participant B as Parallel writer B
    Setup->>DB: prepare + markAdmissionRetryable
    Setup->>A: release start barrier
    Setup->>B: release start barrier
    par real concurrent calls
      A->>DB: prepare(same key, digest)
    and
      B->>DB: prepare(same key, digest)
    end
    DB-->>A: reclaimed OR existing
    DB-->>B: complementary result
    Note over A,B: exactly one reclaimed owner
    A->>DB: winner accepts/begins effect
    B->>DB: loser remains existing; duplicate effect blocked
```

## Delivery path — dependency and gate

```text
wt-391-forward-uchc.1  Repair proof + plan + current-main integration
  └─blocks→ wt-391-forward-uchc.2  Exact-SHA sandbox proof + fresh review
               └─requires→ standards/spec CLEAN
               └─requires→ thermo CLEAN
               └─requires→ abstraction PASS
               └─produces→ present-pr + PR proof + one protected merge card
```

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| Test still serializes before contention | Medium | High | Separate actors, shared start barrier, observed concurrent overlap, independent review |
| SQLite lock behavior makes the assertion flaky | Medium | High | Deterministic barrier/IPC, bounded busy timeout, repeated focused run in sandbox |
| Canonical plan and implementation diverge again | Low | High | Update exact interface, state union, transitions, and conformance prose together |
| Main moves after proof | Medium | Medium | Record base/head and revalidate the integration candidate before Gate 2 |
| Public ledger seam breaks a caller | Low | High | Full agent tests plus explicit abstraction review of producer, seam, and real callers |

## Decision and proof target

Approve dispatch of the two dependency-ordered Beads. The first performs the bounded repair; the second independently proves and presents the exact final SHA. No worker or Orchestrator merges. The final route is owner approval because the public ledger contract is protected; package production churn is currently 79 lines, below the separate `>500` trigger.
