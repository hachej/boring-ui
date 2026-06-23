---
name: loop-implement
description: "Use for /loop-implement or gate:implementation: run one accountable Kanzen implementation lane for one issue or PR, optionally use bounded helpers, review/fix, prove, and stop before merge unless fast-track policy is explicitly satisfied."
---

# Loop Implement

Goal: produce a proved PR. Own one accountable implementation lane and do not
merge by default.

## Lane

| Item | Rule |
| --- | --- |
| scope | one GitHub issue or PR in one repo |
| branch | `codex/issue-<number>-<slug>` unless instructed otherwise |
| helpers | allowed only for bounded subfeatures, review, investigation, or proof |
| proof | must match final head SHA |
| stop | missing owner input, access, destructive action, release/publish, or unsafe merge |

## Flow

| Step | Action |
| --- | --- |
| Read | issue, plan, acceptance, proof requirement, repo invariants |
| Code | make the smallest change; optionally delegate isolated helper work |
| Test | run focused tests and demo workspace proof when UI/workspace behavior changes |
| Review | run review, fix every accepted finding, and re-review until clean or blocked; use thermo-nuclear review for non-trivial code |
| PR | open/update PR with proof, known gaps, and issue link |

## Helpers

Use helper subworkers only when they make the lane clearer or faster:

- isolated subfeature with explicit files, acceptance, and proof;
- thermo-nuclear or second-model review;
- narrow investigation or demo proof.

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
