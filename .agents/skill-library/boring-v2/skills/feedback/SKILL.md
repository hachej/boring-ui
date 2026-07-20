---
name: feedback
description: Create a GitHub issue from user feedback with safe context and simple labels. Never implement.
---

# Feedback

Create the source GitHub issue and stop. Do not implement. Do not split into tickets.

## Labels

Apply exactly one category when possible:

- `bug`
- `enhancement`

Apply exactly one state:

- `needs-triage` — clear enough for triage
- `needs-info` — clarification is needed

## Process

1. Capture the report: observed behavior, expected behavior, route/panel/plugin, selected item, branch/SHA if available, environment/browser/app context, safe errors, optional screenshot.
2. Redact before publishing: no secrets, cookies, auth headers, private data, unrelated transcripts, or host-local paths. Use safe attachment names/URLs only.
3. If unclear enough to affect routing, ask only: `Grill now, defer, or skip?`
   - grill now: clarify before final issue body.
   - defer: create issue with `needs-info`.
   - skip: create issue with best-known context and `needs-triage`.
4. Create the GitHub issue.
5. Stop and return the issue URL plus next suggestion.

## Issue Body

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
Suggested next step: `/triage #<issue>` or `/plan #<issue>`.
```
