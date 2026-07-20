---
name: plan
description: Turn an issue or conversation into a spec and, when needed, tracer-bullet implementation slices with blockers and proof.
---

# Plan

Plan before coding. This is a planning loop: produce the first useful spec/plan, run adversarial review when risk is non-trivial, revise once for accepted findings, and exit with a clear state. This is `to-spec` first; use `to-tickets` behavior only when the work is too large for one safe implementation slice.

## Modes

- Spec mode: clarify what should be built.
- Slice mode: split the spec into tracer-bullet vertical slices with blocking edges.

## Process

1. Read `docs/kanzen/MODEL-CARD.md` for reviewer/escalation policy when available.
2. Read the source issue/spec/conversation, comments, related PRs, existing plan files, and relevant code/docs.
2. Produce or update a spec/plan. Prefer issue comments for small work; use `docs/issues/<issue>/plan.md` for risky, broad, or multi-slice work.
3. Identify test seams and proof before implementation starts.
4. If the work is broad, split into vertical slices. Each slice must be demoable/verifiable alone.
5. For wide mechanical refactors, do not force fake vertical slices; use expand → migrate batches → contract.
6. Run an adversarial plan review when triggered by the model card: challenge scope, flag path, blockers, proof, review budget, and whether the plan is too broad.
7. Revise for accepted findings.
8. Mark the next action: `ready-for-agent`, `ready-for-human`, or `needs-info`.
9. If the next action requires human input, use the `ask_user` tool when available so the request appears in the Boring UI inbox. If unavailable, leave a GitHub issue comment.

## Plan Shape

```md
## Problem Statement

## Solution

## User Stories / Scenarios

## Decisions

## Flag / Abstraction
- Needed?:
- Path:
- Rollback:

## Test Seams
- Highest public seam:
- Existing prior art:
- Avoid testing:

## Acceptance

## Proof
- Exact command:
- Screenshot/demo:
- Manual steps:
- Waiver if proof is not possible:

## Slices

### Slice: <name>
**Delivers:**
**Blocked by:** None / <slice or issue>
**Proof:** exact command, screenshot/demo, manual steps, or waiver
**Review budget:** inside / exceeds / why

## Wide Refactor Strategy
Expand → migrate batches → contract, if applicable.

## Out of Scope

## Open Questions
```


## Loop Exit

Exit only with one of:

- `ready-for-agent` — plan is clear enough for one implementation slice.
- `ready-for-human` — human judgment/access/approval is required.
- `needs-info` — specific unanswered questions block safe planning.

Return: state, plan path/comment, slices, blockers, proof path, adversarial review result, and next action. If human input is needed, include the `ask_user` request id or the fallback GitHub comment URL.
