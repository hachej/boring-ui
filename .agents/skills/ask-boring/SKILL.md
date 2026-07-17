---
name: ask-boring
description: Route a request to the right Boring v2 workflow skill without doing the work.
disable-model-invocation: true
---

# Ask Boring

Router only. Do not edit files, create issues, plan, implement, review, or merge.

## Routes

- `feedback` — user is reporting a bug, idea, UX issue, feature request, or rough observation. Bugs become GitHub issues; feature ideas become Project #7 backlog drafts unless work is committed.
- `triage` — an existing issue/PR needs classification, verification, or a next state.
- `plan` — the desired outcome needs a spec, implementation plan, slices, blockers, or proof path before coding.
- `exec` — a TODO, small plan, or Beads epic is ready for orchestrated delivery.
- `diagnose` later — hard bug without a tight repro loop.
- `wayfinder` later — huge/foggy effort where the destination or route is not knowable in one session.
- `human` — external access, product judgment, security/privacy, merge authority, or unavailable context is required.

## Output

Return one routing card:

```text
Recommended: <skill>
Why: <one sentence>
Input: <issue/PR/path/context to pass>
Next: /<skill> <args>
Caution: <optional blocker or human decision>
```
