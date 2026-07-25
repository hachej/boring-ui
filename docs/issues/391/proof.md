# #391 planning proof index

> Decision 28 supersedes the former Decision 26 planning-reset proof, domain/
> Workspace-type topology, `o0b.*` execution commands, and old R1–R6 graph.
> Git history preserves that evidence. Nothing in this file independently
> dispatches implementation.

## Current authority

- Decision 28: `docs/DECISIONS.md`.
- Product gates: [`plan.md`](plan.md).
- Normative package contracts/DAG:
  [`../805/runtime-refactor/work/A1-agent-authoring/WORKSPACE-AGENT-FLEET-PLAN.md`](../805/runtime-refactor/work/A1-agent-authoring/WORKSPACE-AGENT-FLEET-PLAN.md).
- Consumption modes: [`AGENT-CONSUMPTION-MODES.md`](AGENT-CONSUMPTION-MODES.md).
- Ownership: [`OWNERSHIP.md`](OWNERSHIP.md).
- Alignment: [`ROADMAP-ALIGNMENT.md`](ROADMAP-ALIGNMENT.md).

## Retained merged evidence

- PR #846 / `085836f53`: historical Decision 26 ownership recut; retained
  Workspace authorization/layering research only.
- PR #864 / `7669483c1`: historical graph; superseded by Decision 28 replacement
  Beads.
- PR #869 / `9dbd40165`: R0 publication/consumer audit; F0b refreshes facts.
- PR #885 / `a553c17ae`: closed R4 declarative-authoring correction; retained.
- PR #844 / `e3494d4d2`: landed `workspaceTypeId`; F4 corrective input.
- PR #845 / head `e6bd0e723`: unmerged typed-product implementation; F0a/F5
  record salvage and closure.

## F0 planning proof

The Decision 28 authority PR records:

1. owner-approved architecture premise and durable decision;
2. changed authority/historical banners;
3. code/provider/consumer/publication inventory packet;
4. iterative strong-model review rounds;
5. up to three compact owner-authorized Fable packet reviews;
6. self-contained replacement Beads with acceptance/proof/review/rollback;
7. graph lint, dependency-cycle, and robot-insight proof;
8. document-link, authority-scan, golden-path, and whitespace checks.

## Validation

```bash
git diff --check
pnpm check:golden-path
br lint <Decision-28 replacement Bead IDs>
br dep cycles
bv --robot-insights | jq '{cycles:.Cycles,status:.status}'
br ready --json
```

Historical Decision 26 matches are allowed only inside clearly marked decisions,
snapshots, evidence, or explicit rejection/supersession text. Active authority
must not dispatch domain-selected Workspace types, product membership,
type-filtered portfolios, per-type Agent policy, combined Core/CLI hosting,
competing canonical filesystems, or Agent-coupled final Sandbox backends.

## Runtime-proof waiver for F0

F0 changes planning/docs/tracker state only. Runtime implementation tests are
waived. Link/authority scans, graph proof, golden-path checks, diff checks, and
independent plan review are the relevant gates. Each implementation Bead names
its own focused and package/product proof.
