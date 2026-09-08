# [Invite Idempotency] Plan, visually

## Structure — what this lane touches

```text
PR #1547 · epic/invite-idempotency
├── packages/core/
│   ├── src/server/middleware/idempotency.ts  # atomic request claim/replay
│   ├── src/server/routes/invites.ts          # invite side-effect boundary
│   ├── src/server/db/schema.ts               # protected schema
│   ├── drizzle/0028_*.sql                    # protected migration
│   └── **/*idempotency*.test.ts              # focused + PostgreSQL proof
├── docs/issues/1547/                          # plan/show-me/proof presentation
└── PR #1547                                   # existing integration surface only
```

## Behavior — delivery flow

```mermaid
sequenceDiagram
    participant W1 as Repair Worker
    participant Main as origin/main
    participant Core as Core test sandbox
    participant W2 as Final Worker/Reviewer
    participant Owner
    W1->>Main: merge current main
    W1->>Core: reproduce and repair full package test
    W1-->>W2: exact-SHA handoff with proof
    W2->>Core: revalidate current-main candidate
    W2->>W2: independent spec + thermo + abstraction review
    W2-->>Owner: durable proof and present-pr
    Owner-->>Owner: decide merge at the named SHA
```

## Diff-shaped plan

```diff
 PR #1547 @ 4ff283b
-  focused tests green; full Core package suite red in clean sandbox
-  prior review cannot approve
+  current origin/main integrated without force-push
+  full Core package suite green at exact committed SHA
+  focused tests, typecheck, build, invariants, and E2E green
+  independent standards/spec review: PASS
+  independent thermo review: PASS
+  package-abstraction review: explicit PASS
+  present-pr + proof linked from the existing PR
+  one protected-boundary owner merge decision at exact final SHA
```
