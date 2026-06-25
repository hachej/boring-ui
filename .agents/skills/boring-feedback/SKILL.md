---
name: boring-feedback
description: "Use when a user submits /feedback or asks to capture product feedback: create an enriched GitHub issue with safe context, lean routing labels, first plan, and either queued triage or blocked grill state."
---

# Boring Feedback

Goal: `/feedback` creates the GitHub issue. It never implements.

## Steps

| Step | Output |
| --- | --- |
| Capture | report, route, panel/plugin, selected item, branch/SHA, app/browser context, feedbackSession, redacted errors, optional screenshot |
| Redact | preview before publish; no secrets, cookies, auth headers, private data, unrelated transcripts, or full local paths |
| Issue | title, report, observed/expected, context, sessions, artifacts, redaction note |
| First plan | likely area, acceptance criteria, proof path |
| Labels | `source:feedback`, one `state:*`, one `phase:*`, `track:owner` |

Do not add taxonomy labels such as `bug`, `ui`, `accessibility`,
`package:*`, `plugin:*`, or `gate:*`. Put area, kind, gate, and proof path in
the issue body.

Record the current Pi/Codex session id as `feedbackSession` when available. If
the host does not expose it, write `feedbackSession: unavailable`; do not invent
one.

## Grill Routing

If unclear, ask whether to grill now, defer, or skip.

| Choice | Result |
| --- | --- |
| grill now | use grill-me before final routing |
| defer | create issue as `state:blocked phase:grill`; record gate `clarity` in the body |
| skip/clear | create issue as `state:queued phase:triage`; record gate `intake` in the body |

Use ask-user for deferred questions so the session appears as pending in
boring-ui.
