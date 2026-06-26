---
name: boring-triage
description: "Use to classify boring-ui GitHub issues and PRs into simple state/phase/track labels, choose the first unmet gate, and decide fast-track versus owner-review routing."
---

# Boring Triage

Triage answers: what is the first unmet gate?

## Read

Read issue/PR body, comments, owner instructions, related PRs, changed files,
CI, reviews, thermo check, head SHA, recorded Pi sessions, and enough code/docs
to know risk, flag/abstraction path, and proof path.

## Labels

Keep labels boring. They are routing state, not taxonomy.

| Kind | Rule | Values |
| --- | --- | --- |
| `state:*` | exactly one | `queued`, `blocked`, `active`, `ready`, `done` |
| `phase:*` | exactly one | `triage`, `grill`, `plan`, `implement`, `review`, `merge` |
| `track:*` | exactly one | `owner` by default, `fast` only after risk gate |

Allowed extra label: `source:feedback` only when the item came from
`/feedback`. Do not add `bug`, `ui`, `accessibility`, `package:*`,
`plugin:*`, or `gate:*`; put those details in the body/card.

## Gate Table

| Situation | Labels / Gate |
| --- | --- |
| missing intake context, redaction note, or first plan | keep `state:queued phase:triage`, gate `intake` |
| duplicate, invalid, out of scope | `state:done phase:triage`, preserve `track:*` |
| unclear | `state:blocked phase:grill`, gate `clarity` |
| risk classification | keep `track:owner`; upgrade to `track:fast` only if eligible |
| flag or abstraction missing | keep `track:owner`, gate `flag` |
| needs design, sequencing, or exceeds review budget | `state:active phase:plan`, gate `plan` |
| clear and no PR | `state:active phase:implement`, gate `implementation` |
| PR needs review, thermo check, or fixes | `state:active phase:review`, gate `implementation` |
| tests, CI, GitHub proof comment, or demo proof missing | `state:active phase:review`, gate `proof` |
| all gates pass | `state:ready phase:merge`, gate `merge` |

## Fast Track

Use `track:fast` only for trusted-author low-risk work with small blast radius,
obvious acceptance criteria, no needed flag or safe flag defaults, a non-draft
PR on a worker-owned branch, clean review, current thermo check, green CI, and
current proof. If no PR exists yet, record fast-track candidacy in the card/body
and re-check before setting `track:fast`.

Use `track:owner` for auth, billing, permissions, privacy, secrets, migrations,
public API, releases, broad refactors, destructive/deletion-heavy changes,
unclear requirements, or untrusted authors.

## Sessions

Sessions are structured comments, not labels and not a fixed schema. Preserve
and reuse relevant session ids from issue/PR or Kanzen comments.

If the next action creates or replaces a session, comment the id, purpose,
scope, and reason in the card/body. If a phase advances in the same Pi thread,
say so in the comment.

## Card

Return:

```text
URL:
Primary issue:
What:
Labels:
Gate:
Track:
Flag:
Session comments:
Proof:
Visual review:
Thermo:
Review budget:
Commit prefix:
Next action:
Why:
```

Never end with vague review. Say the exact next command: `/loop-grill`,
`/loop-plan`, `/loop-implement`, proof, fast-track merge, or owner review.
