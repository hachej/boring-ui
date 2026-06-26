---
name: boring-feedback
description: "Use for /feedback: create one enriched GitHub issue with safe context, lean labels, first plan, and queued or grill-blocked state."
---

# Boring Feedback

Goal: create the GitHub issue. Never implement.

## Steps

| Step | Output |
| --- | --- |
| Capture | report, route, panel/plugin, selected item, branch/SHA, app/browser context, session context, redacted errors, optional screenshot |
| Redact | preview before publish; no secrets, cookies, auth headers, private data, unrelated transcripts, or full local paths |
| Issue | title, report, observed/expected, context, session comment, artifacts, redaction note |
| First plan | likely area, acceptance criteria, flag/abstraction guess, proof path |
| Labels | `source:feedback`, one `state:*`, one `phase:*`, `track:owner` |

- Labels: no `bug`, `ui`, `accessibility`, `package:*`, `plugin:*`, `gate:*`.
- Body: area, kind, gate, flag guess, proof path.
- Session: comment id, purpose `feedback`, repo/item scope, capture context.
- Missing id: omit or note `unavailable`; never invent fixed session fields.

## Grill Routing

- If unclear: ask `grill now`, `defer`, or `skip/clear`.

| Choice | Result |
| --- | --- |
| grill now | use grill-me before final routing |
| defer | create issue as `state:blocked phase:grill`; record gate `clarity` in the body |
| skip/clear | create issue as `state:queued phase:triage`; record gate `intake` in the body |

- Deferred grill: create issue first, then ask-user.
- Comment ask-user session id if one is created.
