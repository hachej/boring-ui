---
name: feedback
description: Capture feedback safely: file confirmed bugs as GitHub issues and route feature ideas to the Product Backlog. Never implement.
---

# Feedback

Capture the report, route it, and stop. Do not implement or split work.

## Routing policy

- **Confirmed bug or regression:** create a GitHub issue. GitHub Issues are the operational queue for bugs and active work.
- **Feature request, idea, UX wish, or future work:** create a **draft item** in [Project #7 — Boring Roadmap](https://github.com/users/hachej/projects/7), with Status `Backlog` and Type `Feature`. Do **not** create a GitHub issue.
- **Already reported / already shipped:** link the existing issue, PR, or backlog item; do not create another item.
- Create a GitHub issue for a feature only when the owner explicitly commits it to current work. Move the corresponding Project draft to `Doing`.

## Process

1. Capture the report: observed behavior, expected behavior, route/panel/plugin, selected item, branch/SHA if available, environment/browser/app context, safe errors, optional screenshot.
2. Redact before publishing: no secrets, cookies, auth headers, private data, unrelated transcripts, or host-local paths. Use safe attachment names/URLs only.
3. Search open GitHub Issues, relevant merged/closed PRs, and Project #7 before creating anything. Prefer the existing canonical item when the overlap is material.
4. If unclear enough to decide bug vs. idea, ask only: `Grill now, defer, or skip?`
   - grill now: clarify before routing.
   - defer: create the best matching item with explicit open questions.
   - skip: route using the best-known context.
5. Create exactly one canonical item:
   - **Bug issue:** apply `bug` and exactly one state label: `needs-triage` when clear enough, otherwise `needs-info`.
   - **Feature draft:** add it to Project #7 with the original context and a link back to any relevant discussion. Set Status `Backlog`, Type `Feature`.
6. Stop and return the issue or Project item URL plus the next suggestion.

## Bug issue body

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
Suggested next step: `/triage #<issue>`.
```

## Feature draft body

```md
## Summary

## User value

## Context
- Route/panel:
- Package/plugin:
- Related issue/PR/discussion:

## Acceptance signals

## Open questions

Promote this draft to a GitHub issue only when work is committed.
```
