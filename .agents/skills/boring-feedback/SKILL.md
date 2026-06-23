---
name: boring-feedback
description: "Use when a user submits /feedback or asks to capture product feedback: create an enriched GitHub issue with safe context, labels, first plan, and either queued triage or blocked grill state."
---

# Boring Feedback

Goal: `/feedback` creates the GitHub issue. It never implements.

Issue shape: follow
`docs/kanzen/procedures/well-documented-issue.md`.

## Steps

| Step | Output |
| --- | --- |
| Capture | report, route, panel/plugin, selected item, branch/SHA, app/browser context, redacted errors, optional screenshot |
| Redact | preview before publish; no secrets, cookies, auth headers, private data, unrelated transcripts, or host-local paths |
| Issue | create the well-documented issue |
| First plan | likely area, acceptance criteria, proof path |
| Labels | `source:feedback`, one `state:*`, one `phase:*`, `track:owner`, useful taxonomy such as `bug`, `ux`, `docs`, `package:*`, `plugin:*` |

## Grill Routing

If unclear, ask whether to grill now, defer, or skip.

| Choice | Labels | Gate |
| --- | --- | --- |
| grill now | use grill-me before final routing | `clarity` if still unclear |
| defer | `state:blocked phase:grill track:owner` | `clarity` |
| skip/clear | `state:queued phase:triage track:owner` | `triage` |

Use ask-user for deferred questions so the session appears as pending in
boring-ui.

For attachments, keep the GitHub attachment or safe filename in the issue; do
not publish the original host-local path.
