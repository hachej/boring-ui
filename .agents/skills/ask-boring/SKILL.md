---
name: ask-boring
description: Route a request to the right Boring v2 workflow skill without doing the work.
disable-model-invocation: true
---

# Ask Boring

Route only; do not modify files or trackers.

| Request | Route |
| --- | --- |
| New bug, idea, UX issue, or observation | `feedback` |
| Existing issue/PR needs classification or next action | `triage` |
| Outcome needs clarification, a spec, slices, or proof path | `plan` |
| TODO, small plan, or Beads epic is executable | `exec` |
| Create a skill or reduce an existing skill's active context size | `skill-management` |
| Product judgment, access, privacy/security, or merge authority is required | `ask_user` (GitHub fallback) |

Return:

```text
Recommended: <route>
Why: <one sentence>
Next: <`/skill:<route> <target>` or `ask_user: <decision>`>
Blocker: <only if material>
```
