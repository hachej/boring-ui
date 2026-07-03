---
name: boring-feedback
description: "Use for /feedback: create one enriched GitHub issue with safe context, lean labels, first plan, and queued or grill-blocked state."
---

# Boring Feedback

Goal: `/feedback` creates the GitHub issue. Never implement.

Issue shape: follow
`docs/kanzen/procedures/well-documented-issue.md`.

## Steps

| Step | Output |
| --- | --- |
| Capture | report, route, panel/plugin, selected item, branch/SHA, app/browser context, redacted errors, optional screenshot |
| Redact | preview before publish; no secrets, cookies, auth headers, private data, unrelated transcripts, or host-local paths |
| Issue | create the well-documented issue |
| First plan | likely area, acceptance criteria, flag/abstraction guess, proof path |
| Labels | `source:feedback`, one `state:*`, one `phase:*`, `track:owner` |

- Labels: no `bug`, `ui`, `accessibility`, `package:*`, `plugin:*`, `gate:*`.
- Session: comment id, purpose `feedback`, repo/item scope, capture context.
- Missing id: omit or note `unavailable`; never invent fixed session fields.

## Grill Routing

If unclear, ask whether to grill now, defer, or skip.

| Choice | Result |
| --- | --- |
| grill now | use grill-me before final routing |
| defer | create issue as `state:blocked phase:grill`; record gate `clarity` in the body |
| skip/clear | create issue as `state:queued phase:triage`; record gate `triage` in the body |

Use ask-user for deferred questions so the session appears as pending in
boring-ui.

For attachments, keep the GitHub attachment or safe filename in the issue; do
not publish the original host-local path.
