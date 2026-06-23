---
name: loop-implement
description: "Use for /loop-implement or gate:implementation: run one accountable Kanzen implementation lane for one issue or PR, optionally use bounded helpers, review/fix, prove, and stop before merge unless fast-track policy is explicitly satisfied."
---

# Loop Implement

Goal: produce a proved PR. Own one accountable implementation lane and do not
merge by default.

## Procedures

| Need | Read |
| --- | --- |
| branch/worktree | `docs/procedures/branch-worktree.md` |
| review loop | `docs/procedures/review-loop.md` |
| proof | `docs/procedures/proof-of-work.md` |
| owner handoff | `docs/procedures/owner-review-card.md` |

## Flow

| Step | Action |
| --- | --- |
| Read | issue, plan, acceptance, proof requirement, repo invariants |
| Prepare | use the branch/worktree procedure |
| Code | make the smallest change; optionally delegate isolated helper work |
| Test | run focused tests and proof-of-work demo steps when UI/workspace behavior changes |
| Review | follow the review-loop procedure until clean or blocked |
| Proof | post final proof using the proof-of-work procedure |
| PR | open/update PR; use owner-review-card procedure when human review is needed |

## Helpers

The lane owner remains responsible for branch, commits, final diff, proof, PR
body, labels, and state. Helpers return findings, diffs, or proof to the lane.
Helpers must not merge, change labels, ask the owner directly, or spawn more
helpers. If the work needs multiple accountable branches or PRs, stop and return
a split or stacked-PR plan to triage.

## Exit

| Result | Labels / Gate |
| --- | --- |
| owner input needed | `state:blocked phase:implement gate:clarity` |
| accepted review finding remains | `state:active phase:review gate:implementation` |
| proof still needed | `state:active phase:review gate:proof` |
| review/proof clean | `state:ready phase:merge gate:merge` |

Fast track only applies after triage confirms `track:fast` and all merge gates
pass.
