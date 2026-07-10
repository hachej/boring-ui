---
name: boring-triage
description: "Use for /triage in boring-ui: refresh GitHub state, classify issues/PRs, choose the first unmet gate, route grill/plan/implement/proof/merge, and decide fast-track versus owner-review routing."
---

# Boring Triage

Triage answers: what is the first unmet gate, then does one next action.

## Sweep

1. Refresh issue/PR body, comments, current labels, CI, reviews, proof comment,
   and head SHA.
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
| source | optional | `source:feedback` only |

- No taxonomy labels: `bug`, `ui`, `accessibility`, `package:*`, `plugin:*`,
  `gate:*`.
- Put details in body/card.

## Gate Table

| Situation | Labels | Gate |
| --- | --- | --- |
| weak issue body or unsafe intake | `state:queued phase:triage` | `intake` |
| queued issue is ready to classify | `state:queued phase:triage` | `triage` |
| duplicate, invalid, out of scope | `state:done` | none |
| unclear | `state:blocked phase:grill` | `clarity` |
| risk classification | keep `track:owner`; upgrade to `track:fast` only if eligible | `risk` |
| runtime exposure is not controlled | keep current state/phase | `flag` |
| needs design or sequencing | `state:active phase:plan` | `plan` |
| clear and no PR | `state:active phase:implement` | `implementation` |
| PR lacks current review, has unresolved comments, or accepted findings remain | `state:active phase:review` | `implementation` |
| final proof comment, tests, CI, or demo proof missing | `state:active phase:review` | `proof` |
| all gates pass | `state:ready phase:merge` | `merge` |

## Gate Actions

| Gate | Action |
| --- | --- |
| `intake` | repair the issue using `docs/kanzen/procedures/well-documented-issue.md` |
| `clarity` | use `boring-loop-grill`: grill-me plus ask-user; stay `state:blocked phase:grill` |
| `triage` | classify risk, plan need, implementation state, proof, and merge readiness |
| `risk` | keep `track:owner`; upgrade to `track:fast` only when all fast-track rules pass |
| `flag` | require `not-needed`, a safe feature flag, or an abstraction path before code proceeds |
| `plan` | use `boring-loop-plan`: smallest useful plan; plan file plus thermo review for risky or multi-PR work |
| `implementation` | use `boring-loop-implement`: one accountable lane for one issue/PR |
| `proof` | follow `docs/kanzen/procedures/proof-of-work.md`; PR body proof is not a substitute for the final proof comment |
| `merge` | fast-track merge or `docs/kanzen/procedures/owner-review-card.md` |

Current review means a review artifact for the current head SHA: a GitHub
review, a PR comment/body section that names the reviewed SHA, or a recorded
`coding-autoreview`/thermo result. Stale reviews and unresolved accepted
findings fail the implementation gate.

Current proof means a final issue/PR comment for the current head SHA. PR body
proof is helpful context, but it does not pass the proof gate by itself. In a
read-only or dry-run sweep, report the exact comment/label/merge action that
would happen and leave the gate unchanged.

## Fast Track

Use `track:fast` only for trusted-author low-risk work with small blast radius,
obvious acceptance criteria, clean review, green CI, and current proof.

Use `track:owner` for auth, billing, permissions, privacy, secrets, migrations,
public API, releases, broad refactors, destructive/deletion-heavy changes,
unclear requirements, or untrusted authors.

Auto-merge only when labels include `state:ready phase:merge track:fast`, the
author/agent is trusted, the PR is non-draft on a branch owned by one lane or
explicitly trusted owner/agent, CI/tests and proof are current, no restricted
area is touched, and a proof comment is posted. Otherwise keep `track:owner`
and prepare a short owner review brief.

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
Current labels:
Recommended labels:
Gate:
Track:
Proof:
Next action:
Why:
```

End with exact next action: `/loop-grill`, `/loop-plan`, `/loop-implement`,
proof, fast-track merge, or owner review.
