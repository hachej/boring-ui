# Well Documented Issue Procedure

Use this when `/feedback` creates an issue or `/triage` repairs weak intake.

An issue is ready for triage when another agent can act without hidden local
context.

## Must Include

- Title: concrete outcome or failure, not a vague topic.
- Summary: one paragraph with user impact.
- Observed: what happened, including error text when safe.
- Expected: what should have happened.
- Context: route, panel/plugin, selected item, branch/SHA, browser/app state.
- Artifacts: screenshots, logs, console output, reproduction data, or `N/A`.
  Use safe attachment names or URLs; do not publish host-local file paths.
- Redaction note: say what was removed or that no sensitive data was present.
- Acceptance: how the fix/change will be judged done.
- Proof path: tests, demo workspace, screenshot, manual steps, or waiver.
- First plan: likely area, smallest next step, known uncertainty.
- Routing: optional `source:feedback` plus Kanzen `state:*`, `phase:*`, `track:*`,
  and a structured `gate` field. `gate` is not a GitHub label.

## Template

```md
## Summary

## Observed

## Expected

## Context
- Route/panel:
- Package/plugin:
- Branch/SHA:
- Environment:

## Artifacts

## Redaction

## Acceptance

## Proof Path

## First Plan

## Open Questions

## Routing
- Labels:
- Gate:
```

If the issue lacks information that changes routing, create it as
labels `state:blocked phase:grill track:owner` with gate `clarity`, then ask
through the grill loop.

If the issue is well documented and ready for the next sweep, use labels
`state:queued phase:triage track:owner` with gate `triage`.
