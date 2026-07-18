---
name: triage
description: Classify existing issues or PRs with the simple Boring state model and record the next action.
disable-model-invocation: true
---

# Triage

Classify issue/PR state. Do not implement.

## Labels

Category, exactly one where possible:

- `bug`
- `enhancement`

State, exactly one:

- `needs-triage` — not evaluated yet
- `needs-info` — waiting for specific user/reporter answers
- `ready-for-agent` — agent can plan or implement safely
- `ready-for-human` — human judgment/access/approval is required
- `wontfix` — rejected, duplicate, out of scope, or already solved

## Process

1. Read the issue/PR body, comments, labels, linked plans/PRs, and relevant code/docs.
2. Verify the claim when cheap and safe. For bugs, look for a red-capable repro command or concrete manual path.
3. Decide the first blocker:
   - `clarity` — missing information
   - `risk` — human judgment needed
   - `plan` — needs spec/slices before coding
   - `implementation` — ready to build
   - `proof` — built but proof is missing/stale
   - `review` — code needs review/fixes
   - `merge` — ready but human/merge decision remains
4. Apply simple labels.
5. Post/update a short routing comment.
6. If the issue needs human input, use the `ask_user` tool when available so it appears in the Boring UI inbox. If unavailable, post specific questions as a GitHub issue/PR comment.

## Routing Comment

```md
## Boring Triage

State: `<state>`
Category: `<bug|enhancement>`
Blocked by: `<clarity|risk|plan|implementation|proof|review|merge|none>`
Next: `/<skill> <target>`

Proof expected:
- Exact command:
- Screenshot/demo:
- Manual steps:
- Waiver if proof is not possible:

Human request:
- `ask_user` id or GitHub/PR comment URL, if applicable

Notes:
- ...
```
