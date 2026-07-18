# Well-documented feedback

Use for `feedback` and triage repair. Another agent must understand the item
without hidden chat context.

## Route

- Confirmed bug/regression → GitHub issue.
- Idea, feature, or UX wish → [Project #7](https://github.com/users/hachej/projects/7) draft (`Backlog`, `Feature`).
- Feature committed to current work → GitHub issue; move its draft to `Doing`.
- Existing/shipped item → link it; create nothing.

Bug issues include impact, observed/expected behavior, context, safe artifacts,
acceptance, proof ideas, and open questions. Feature drafts include user value,
context, acceptance signals, and open questions. Never publish secrets, auth data,
private content, unrelated transcripts, or host paths.

## Bug issue

```md
## Summary
## Observed
## Expected
## Context
- Route/package:
- Branch/SHA/environment:
## Artifacts
## Redaction
## Acceptance
## Proof ideas
## Open questions
## Next
Suggested: `/skill:triage #<issue>`
```

Apply `bug` plus `needs-triage` or `needs-info` from the Boring state model.

## Feature draft

```md
## Summary
## User value
## Context
- Route/package:
- Related item:
## Acceptance signals
## Open questions
```

Create in [Project #7](https://github.com/users/hachej/projects/7) as `Backlog` / `Feature`. Promote to a GitHub issue only
when the owner commits it to current work. `feedback` creates one item and stops.
