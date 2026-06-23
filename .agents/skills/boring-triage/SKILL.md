---
name: boring-triage
description: "Use for /triage in boring-ui: refresh GitHub state, classify issues/PRs, choose the first unmet gate, route grill/plan/implement/proof/merge, and decide fast-track versus owner-review routing."
---

# Boring Triage

Triage answers: what is the first unmet gate, then does one next action.

## Sweep

1. Refresh issue/PR body, comments, labels, CI, reviews, proof, and head SHA.
2. Read newest Julien/owner instruction before touching the item.
3. Read enough code/docs to know risk and proof path.
4. Pick queued or stale work, then stop at the first unmet gate.
5. Record labels, gate, proof, reviewed SHA, and next action.

## Labels

| Kind | Rule | Values |
| --- | --- | --- |
| `state:*` | exactly one | `queued`, `blocked`, `active`, `ready`, `done` |
| `phase:*` | exactly one | `triage`, `grill`, `plan`, `implement`, `review`, `merge` |
| `track:*` | exactly one | `owner` by default, `fast` only after risk gate |
| taxonomy | optional | `source:feedback`, `bug`, `ux`, `docs`, `plugin:*`, `package:*` |

## Gate Table

| Situation | Labels / Gate |
| --- | --- |
| duplicate, invalid, out of scope | `state:done` |
| unclear | `state:blocked phase:grill gate:clarity` |
| risk classification | keep `track:owner`; upgrade to `track:fast` only if eligible |
| needs design or sequencing | `state:active phase:plan gate:plan` |
| clear and no PR | `state:active phase:implement gate:implementation` |
| PR needs review or fixes | `state:active phase:review gate:implementation` |
| tests, CI, or demo proof missing | `state:active phase:review gate:proof` |
| all gates pass | `state:ready phase:merge gate:merge` |

## Gate Actions

| Gate | Action |
| --- | --- |
| `clarity` | use `loop-grill`: grill-me plus ask-user; stay `state:blocked phase:grill` |
| `risk` | keep `track:owner`; upgrade to `track:fast` only when all fast-track rules pass |
| `plan` | use `loop-plan`: smallest useful plan; plan file plus thermo review for risky or multi-PR work |
| `implementation` | use `loop-implement`: one accountable lane for one issue/PR |
| `proof` | follow `docs/kanzen/procedures/proof-of-work.md` |
| `merge` | fast-track merge or `docs/kanzen/procedures/owner-review-card.md` |

## Fast Track

Use `track:fast` only for trusted-author low-risk work with small blast radius,
obvious acceptance criteria, clean review, green CI, and current proof.

Use `track:owner` for auth, billing, permissions, privacy, secrets, migrations,
public API, releases, broad refactors, destructive/deletion-heavy changes,
unclear requirements, or untrusted authors.

Auto-merge only when labels include `state:ready phase:merge track:fast`, the
author/agent is trusted, the PR is non-draft on a worker-owned branch, CI/tests
and proof are current, no restricted area is touched, and a proof comment is
posted. Otherwise keep `track:owner` and prepare a short owner review brief.

## Worker Rule

One lane means one accountable Codex/Kanzen thread/run, one branch/worktree, one
GitHub item. Use `docs/kanzen/procedures/branch-worktree.md` for mechanics. Helpers
may assist, but they do not own labels, merge decisions, owner questions, or
additional lanes. Stop for missing owner input, missing access, destructive
actions, release/publish work, or merge without policy permission.

## Card

Return:

```text
URL:
What:
Labels:
Gate:
Track:
Proof:
Next action:
Why:
```

Never end with vague review. Say the exact next command: `/loop-grill`,
`/loop-plan`, `/loop-implement`, proof, fast-track merge, or owner review.
