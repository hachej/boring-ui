---
name: boring-feedback
description: "Use when a user submits /feedback or asks to capture product feedback: create an enriched GitHub issue with safe context, labels, first plan, and either queued triage or blocked grill state."
---

# Boring Feedback

Goal: `/feedback` creates the GitHub issue. It never implements.

## Steps

| Step | Output |
| --- | --- |
| Capture | report, route, panel/plugin, selected item, branch/SHA, app/browser context, redacted errors, optional screenshot |
| Redact | preview before publish; no secrets, cookies, auth headers, private data, unrelated transcripts, or full local paths |
| Issue | title, report, observed/expected, context, artifacts, redaction note |
| First plan | likely area, acceptance criteria, proof path |
| Labels | `source:feedback`, one `state:*`, one `phase:*`, `track:owner`, useful taxonomy |

## Grill Routing

If unclear, ask whether to grill now, defer, or skip.

| Choice | Result |
| --- | --- |
| grill now | use grill-me before final routing |
| defer | create issue as `state:blocked phase:grill gate:clarity` |
| skip/clear | create issue as `state:queued phase:triage gate:intake` |

Use ask-user for deferred questions so the session appears as pending in
boring-ui.
