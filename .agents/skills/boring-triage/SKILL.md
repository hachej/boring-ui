---
name: boring-triage
description: "Use to classify boring-ui GitHub issues and PRs into simple state/phase/track labels, choose the first unmet gate, and decide fast-track versus owner-review routing."
---

# Boring Triage

Triage answers: what is the first unmet gate?

## Read

Read issue/PR body, comments, owner instructions, related PRs, changed files,
CI, reviews, head SHA, and enough code/docs to know risk and proof path.

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

## Fast Track

Use `track:fast` only for trusted-author low-risk work with small blast radius,
obvious acceptance criteria, clean review, green CI, and current proof.

Use `track:owner` for auth, billing, permissions, privacy, secrets, migrations,
public API, releases, broad refactors, destructive/deletion-heavy changes,
unclear requirements, or untrusted authors.

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
