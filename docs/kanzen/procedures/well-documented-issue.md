# Well-documented issue

Use for `feedback` and for `triage` repairs.

An issue is good enough when another agent can understand the report without hidden chat context.

## Required

- Clear title.
- Summary with user impact.
- Observed behavior.
- Expected behavior.
- Context: route/panel, package/plugin, selected item, branch/SHA when known, browser/app state.
- Artifacts: screenshot, logs, console output, reproduction data, or `N/A`.
- Redaction note.
- Acceptance criteria.
- Proof ideas.
- Open questions.

## Redaction

Never publish secrets, cookies, auth headers, private data, unrelated transcripts, or host-local paths. Use safe filenames or GitHub attachment URLs.

## Labels

Category, one when possible:

- `bug`
- `enhancement`

State:

- `needs-triage` if clear enough to route
- `needs-info` if specific answers are needed

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

## Proof Ideas
- Exact command:
- Screenshot/demo:
- Manual steps:
- Waiver if proof is not possible:

## Open Questions

## Next
```

`feedback` creates the issue and stops. If unclear, ask only: grill now, defer, or skip.
