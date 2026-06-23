---
name: loop-implement
description: "Use for /loop-implement or gate:implementation: run one Kanzen worker lane for one issue or PR, implement the plan, review/fix, prove, and stop before merge unless fast-track policy is explicitly satisfied."
---

# Loop Implement

Goal: produce a proved PR. Do not spawn workers and do not merge by default.

## Lane

| Item | Rule |
| --- | --- |
| scope | one GitHub issue or PR in one repo |
| branch | `codex/issue-<number>-<slug>` unless instructed otherwise |
| proof | must match final head SHA |
| stop | missing owner input, access, destructive action, release/publish, or unsafe merge |

## Flow

| Step | Action |
| --- | --- |
| Read | issue, plan, acceptance, proof requirement, repo invariants |
| Code | make the smallest change that satisfies acceptance |
| Test | run focused tests and demo workspace proof when UI/workspace behavior changes |
| Review | run review/fix/re-review; use thermo-nuclear review for non-trivial code |
| PR | open/update PR with proof, known gaps, and issue link |

## Exit

| Result | Labels / Gate |
| --- | --- |
| owner input needed | `state:blocked phase:implement gate:clarity` |
| fixes or proof still needed | `state:active phase:review gate:proof` |
| review/proof clean | `state:ready phase:merge gate:merge` |

Fast track only applies after triage confirms `track:fast` and all merge gates
pass.
