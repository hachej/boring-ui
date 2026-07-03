---
name: boring-triage
description: "Use for /triage classification: set state/phase/track, find the first unmet gate, and choose fast-track or owner routing."
---

# Boring Triage

Answer: first unmet gate.

## Read

- Issue/PR body, comments, owner instructions.
- Related PRs, files, CI, reviews, thermo, head SHA.
- Session comments.
- Enough code/docs to judge risk, flag path, proof path.

## Labels

| Kind | Rule | Values |
| --- | --- | --- |
| `state:*` | exactly one | `queued`, `blocked`, `active`, `ready`, `done` |
| `phase:*` | exactly one | `triage`, `grill`, `plan`, `implement`, `review`, `merge` |
| `track:*` | exactly one | `owner` by default, `fast` only after risk gate |

- Extra label: `source:feedback` only.
- No taxonomy labels: `bug`, `ui`, `accessibility`, `package:*`, `plugin:*`,
  `gate:*`.
- Put details in body/card.

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

- `track:fast`: trusted author, low risk, small blast radius.
- Requires: obvious acceptance, safe flag/default, non-draft PR, worker-owned
  branch, clean review, thermo, CI, proof.
- No PR yet: record fast-track candidate; re-check before `track:fast`.
- `track:owner`: auth, billing, permissions, privacy, secrets, migrations,
  public API, releases, broad refactors, destructive changes, unclear scope,
  untrusted author.

## Sessions

- Sessions are comments, not labels or fixed fields.
- Preserve/reuse relevant ids.
- New/replaced session: comment id, purpose, scope, reason.
- Same Pi thread advances phase: say so in the comment.

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

End with exact next action: `/loop-grill`, `boring-loop-plan`,
`boring-loop-implement`, proof, fast-track merge, or owner review.
