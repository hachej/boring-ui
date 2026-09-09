# [Production Deps Group Retry] Plan, visually

PR #1572 stays on its existing Dependabot branch. This plan repairs the grouped upgrades, proves the exact integration candidate, and routes the final diff by the owner-approved risk rules.

## Structure

```text
PR #1572
├── package.json + pnpm-lock.yaml       # nine grouped production upgrades
├── apps/* + plugins/* manifests        # resolved dependency versions
├── packages/cli/vite.config.ts         # remove prior bump-only source accommodation
├── tests + CI/budget commands          # exact-head behavior and resource proof
└── docs/issues/1572 + .handoff/        # review, show-me, present-pr evidence
```

## Delivery behavior

```mermaid
sequenceDiagram
    participant W1 as Repair Worker
    participant CI as Tests / CI
    participant R as Independent Reviewer
    participant W2 as Admission Worker
    participant PR as Existing PR #1572
    W1->>PR: read every failed job and comment
    W1->>W1: merge current main; bisect every retained bump
    W1->>CI: targeted checks, invariants, budgets
    CI-->>W1: drop every bump that breaks a required check
    W1->>R: exact-SHA standards + thermo + abstraction review
    W1->>PR: push same branch and hand off
    W2->>CI: current-main integration and exact-head full checks
    W2->>R: final exact-SHA review; fix and repeat until PASS
    W2->>PR: proof + present-pr + risk classification
    alt automatic-eligible
      W2->>PR: factory: MERGE-READY <sha>
    else protected boundary
      W2->>PR: prepare one exact-SHA owner merge gate
    end
```

## Shape of the change

```diff
 dependabot grouped version/lockfile update
+  inspect every failed GitHub job and prior Factory verdict
+  merge current origin/main without force-push
+  never modify product source to accommodate a dependency
+  remove prior bump-only product-source accommodations
+  preserve budgets and assertions
+  drop every bump that breaks any required check; name each with evidence
+  exact-SHA standards/spec + thermo + explicit abstraction PASS
+  exact-head CI and current-main integration proof
+  present-pr artifact and deterministic risk classification
+  MERGE-READY comment or one protected merge card
```

## Risks and controls

| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| Multiple upgrades obscure the root cause | Medium | High | Read each job log; isolate failures by API/caller and retain per-package rationale. |
| Prior workaround changed product source | High | High | Remove bump-only source accommodations; retain only dependency metadata that passes unchanged product checks. |
| Bundle/resource regression | Medium | High | Run existing budget checks; do not raise limits without an owner decision. |
| Stale branch-green result | Medium | High | Merge current main, then validate and review the exact final SHA/integration candidate. |
| UI behavior changes indirectly | Low | Medium | If source repair changes UI behavior, add revision-bound Playwright before/after video and assertions. |

## Proof path

1. GitHub failed-job logs and all review/comment surfaces.
2. Affected lint, typecheck, unit, invariant, budget, E2E/UI commands at committed SHA.
3. Independent standards/spec, thermo, and explicit package-abstraction PASS at exact final SHA (≤4 rounds).
4. Exact-head CI plus current-main integration evidence.
5. Durable `.handoff/pr-1572-presentation.html`, proof comment, and final risk-size classification.

Beads: `factory-plugin-rvrw.1` (bisect/drop) → `factory-plugin-rvrw.2` (verify/admit), under epic `factory-plugin-rvrw`.

Plan review: no host-provided independent plan-review mechanism is available in this Orchestrator session; the owner decides at Gate 1 under the explicit host requirement.
