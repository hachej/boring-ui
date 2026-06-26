---
name: boring-orchestration
description: "Use to run /triage for boring-ui: refresh GitHub state, apply triage gates, run the first needed loop, collect proof, and merge only fast-track-safe PRs."
---

# Boring Orchestration

Run scheduled `/triage`. One issue gets one next action. Do not invent extra
states.

Canonical model: `../../../docs/kanzen/boring-loop.md`.
How-to details: `../../../docs/kanzen/procedures/` and
`../../../docs/procedures/proof-of-work.md`.

## Sweep

1. Refresh GitHub issues, PRs, comments, labels, CI, reviews, proof, head SHA,
   and session comments.
2. Read newest Julien/owner instruction first.
3. Run `boring-triage` on queued or stale items.
4. Execute only the first unmet gate.
5. Record labels, gate, proof/reviewed SHA, next action, and session comments.

## Gates

| Gate | Action |
| --- | --- |
| `intake` | repair issue body: context, redaction note, first plan |
| `clarity` | `/loop-grill`; use grill-me plus ask-user when async |
| `risk` | keep `track:owner`; upgrade only when fast-track rules pass |
| `flag` | require `not-needed`, safe feature flag, or abstraction path |
| `plan` | `/loop-plan`; use issue-linked plan file for risky or multi-PR work |
| `implementation` | `/loop-implement`; one parent lane owns one issue/PR |
| `proof` | tests, CI, proof-of-work comment, screenshots, and demo proof when useful |
| `merge` | fast-track merge if all gates pass, otherwise owner review |

## Rules

- Labels and fields follow `boring-loop.md`; labels are only `state:*`,
  `phase:*`, `track:*`, plus optional `source:feedback`.
- Sessions are comments, not fixed fields. Comment id, purpose, scope, and
  replacement reason when a session is created, reused, or replaced.
- One lane means one parent thread/run, one checkout context, and one GitHub
  item. Bounded subagents may implement a slice or review, then return findings
  to the parent lane.
- Trunk, feature-flag, worktree, issue-plan, commit-prefix, and 1,500-line
  review-budget rules live in
  `../../../docs/kanzen/procedures/trunk-flags-review-budget.md`,
  `../../../docs/kanzen/procedures/issue-plans.md`, and
  `../../../docs/kanzen/procedures/coding-rules.md`.
- For non-trivial work, run review/fix/re-review and thermo check until clean
  or blocked; proof, review, and thermo check must match the current head SHA.
- For non-trivial owner review, prepare `visual-review` material using
  `../../../docs/kanzen/procedures/visual-review.md`.

## Merge

Auto-merge only when `state:ready phase:merge track:fast`, the PR is non-draft
on a worker-owned branch, CI/tests/review/thermo/proof are current, the GitHub
proof-of-work comment is posted, no restricted area is touched, and any required
visual review is approved for the current artifact. Otherwise prepare the owner
review brief and keep `track:owner`.
