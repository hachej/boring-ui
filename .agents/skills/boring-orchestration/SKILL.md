---
name: boring-orchestration
description: "Use to run /triage for boring-ui: refresh GitHub state, apply triage gates, run grill/plan/implement subloops, collect proof, and merge only fast-track-safe PRs."
---

# Boring Orchestration

Run `/triage`. One issue, one next action. Do not invent extra states.

## Sweep

1. Refresh issues, PRs, comments, labels, CI, reviews, proof, and head SHA.
2. Read newest Julien/owner instruction first.
3. Run `boring-triage` on queued or stale items.
4. Execute the first unmet gate only.
5. Record labels, gate, proof, reviewed SHA, and next action.

## Gate Actions

| Gate | Action |
| --- | --- |
| `clarity` | `/loop-grill`: grill-me plus ask-user; stay `state:blocked phase:grill` |
| `risk` | keep `track:owner`; upgrade to `track:fast` only when all fast-track rules pass |
| `plan` | `/loop-plan`: smallest useful plan; plan file plus thermo review for risky or multi-PR work |
| `implementation` | `/loop-implement`: one worker lane for one issue/PR |
| `proof` | tests, CI, screenshots, demo workspace proof when useful |
| `merge` | fast-track merge or owner review |

## Worker Rule

One lane means one Codex/Kanzen thread/run, one branch/worktree, one GitHub
item. Stop for missing owner input, missing access, destructive actions,
release/publish work, or merge without policy permission.

## Review Rule

For non-trivial work, run review/fix/re-review plus thermo-nuclear
implementation review. Proof and review must match the current head SHA.

## Merge Rule

Auto-merge only when:

- labels include `state:ready phase:merge track:fast`;
- author/agent is trusted by repo policy;
- PR is non-draft on a worker-owned branch;
- CI, tests, review, thermo check, and proof are current;
- no restricted area is touched;
- proof comment is posted.

Otherwise set `track:owner` and prepare a short ask-user/PR review brief for
Julien.
