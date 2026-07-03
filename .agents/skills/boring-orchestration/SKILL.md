---
name: boring-orchestration
description: "Use for scheduled /triage: refresh GitHub, run the first unmet gate, collect proof, and merge only fast-track-safe PRs."
---

# Boring Orchestration

Run scheduled `/triage`.

Canonical model: `../../../docs/kanzen/boring-loop.md`.
How-to details: `../../../docs/kanzen/procedures/` and
`../../../docs/procedures/proof-of-work.md`.

## Sweep

1. Refresh issues, PRs, comments, labels, CI, reviews, proof, head SHA, sessions.
2. Read newest owner instruction.
3. Run `boring-triage`.
4. Execute first unmet gate only.
5. Record labels, gate, proof/reviewed SHA, next action, sessions.

## Gates

| Gate | Action |
| --- | --- |
| `intake` | repair issue body: context, redaction note, first plan |
| `clarity` | `/loop-grill`; use grill-me plus ask-user when async |
| `risk` | keep `track:owner`; upgrade only when fast-track rules pass |
| `flag` | require `not-needed`, safe feature flag, or abstraction path |
| `plan` | use `boring-loop-plan`; issue-linked plan for risky or multi-PR work |
| `implementation` | use `boring-loop-implement`; one parent lane owns one issue/PR |
| `proof` | tests, CI, proof-of-work comment, screenshots, and demo proof when useful |
| `merge` | fast-track merge if all gates pass, otherwise owner review |

## Rules

- Labels: only `state:*`, `phase:*`, `track:*`, optional `source:feedback`.
- Sessions: comments only; include id, purpose, scope, reason.
- Lane: one parent thread/run, one checkout context, one GitHub item.
- Subagents: allowed for slices/review; return findings to parent lane.
- Trunk/budget: `../../../docs/kanzen/procedures/trunk-flags-review-budget.md`.
- Issue plans: `../../../docs/kanzen/procedures/issue-plans.md`.
- Commit/coding rules: `../../../docs/kanzen/procedures/coding-rules.md`.
- Review: fix/re-review plus thermo until clean or blocked.
- Head SHA: proof, review, thermo must match.
- Owner review: use `../../../docs/kanzen/procedures/visual-review.md`.

## Merge

- Apply fast-track checklist in `../../../docs/kanzen/boring-loop.md`.
- If any item fails: owner review brief, `track:owner`.
