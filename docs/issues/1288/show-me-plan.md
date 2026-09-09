# Durable Factory Dispatch Retry — plan, visually

## Structure

```text
PR #1288 / br-1276-orchestrator-plugin
├── merge origin/main                 # conflict-free integration base
├── plugins/boring-automation/
│   ├── server/routes + operations    # PATCH complete Automation contract
│   ├── store/reconciliation          # bounded durable occupancy behavior
│   └── tests                         # parent-red contract + channel regressions
├── exact-SHA checks + GitHub CI
├── independent fresh review          # standards + thermo + abstraction PASS
└── present-pr + final risk route
```

## Behavior

```mermaid
sequenceDiagram
    participant W as Worker
    participant G as Git/origin main
    participant A as Automation API
    participant C as CI + Review
    W->>G: merge current origin/main
    W->>A: repair PATCH complete Automation response
    W->>A: repair outstanding exact-head failures
    W->>C: exact-SHA tests, invariants, CI
    W->>C: fresh review + explicit abstraction verdict
    C-->>W: PASS or bounded findings
    W->>G: push exact reviewed SHA
    W-->>O as Orchestrator: complete Bead handoff + proof
```

## Change shape

```diff
 PR #1288
-  conflict-dirty at 14e64561f
-  PATCH may return AutomationSummary and drop promptRef
-  exact-head unit/channel CI red
-  latest abstraction review BLOCKED
+  current origin/main merged normally and pushed
+  PATCH returns complete Automation with regression proof
+  all exact-head CI green without weakened assertions
+  fresh independent standards/thermo review
+  Abstraction review: PASS at the exact final SHA
+  durable present-pr proof and final risk classification
```
