---
name: feedback
description: "Capture feedback safely: file confirmed bugs as GitHub issues and route feature ideas to the Product Backlog. Never implement."
disable-model-invocation: true
---

# Feedback

Capture one canonical item, then stop. Follow
`docs/kanzen/procedures/well-documented-issue.md`.

## Steps

1. Capture impact, observed/expected behavior, relevant route/package/SHA/environment,
   safe errors, and artifacts.
2. Redact secrets, auth data, private content, unrelated transcripts, and host paths.
3. Search issues, merged/closed PRs, and Project #7 for material overlap.
4. If routing is unclear ask: `Grill now, defer, or skip?` Grill clarifies first;
   defer creates the best item with open questions; skip routes current context.
5. Create one item using the canonical template. Bug issues get `bug` plus
   `needs-triage` or `needs-info`; drafts keep their open questions.
6. Return its URL and next action (`/skill:triage` for bugs). Do not implement.
