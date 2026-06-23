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
| proof | follow `docs/procedures/proof-of-work.md`; must match final head SHA |
| stop | missing owner input, access, destructive action, release/publish, or unsafe merge |

## Flow

| Step | Action |
| --- | --- |
| Read | issue, plan, acceptance, proof requirement, repo invariants |
| Code | make the smallest change; optionally delegate isolated helper work |
| Test | run focused tests and demo workspace proof when UI/workspace behavior changes |
| Review | run the review loop below until clean or blocked |
| PR | open/update PR with proof, known gaps, issue link, and review card |

## Review Loop

For PR/branch work:

```bash
base=$(gh pr view --json baseRefName --jq .baseRefName 2>/dev/null || echo main)
/home/ubuntu/.agents/skills/coding-autoreview/scripts/autoreview --mode branch --base "origin/$base"
```

Use `--mode local` only for dirty uncommitted work. Use
`--mode commit --commit HEAD` for one finished commit.

For non-trivial code, also run a bounded helper with the
`coding-thermo-nuclear-code-quality-review` skill. Verify each finding in the
real code, fix every accepted finding, rerun affected tests/proof, then rerun
the same review command until it exits clean or the remaining finding is
explicitly rejected or blocked.

## Land The Plane

When human review is needed, leave a review card in the PR and final thread:

```text
PR:
Issue:
What changed:
Why:
Risk:
Proof:
Demo: URL or N/A
Please test:
Decision needed:
```

First post the final proof comment required by
`docs/procedures/proof-of-work.md`. The card's `Proof:` field summarizes or
links to that proof; it does not replace it. Use a demo/dev URL when UI or
workspace behavior can be validated manually. If no demo is available, say why
and list the closest proof. Make `Please test` concrete enough that Julien can
approve or reject without reconstructing the whole PR.

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
