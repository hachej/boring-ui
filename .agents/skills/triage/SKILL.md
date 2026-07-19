---
name: triage
description: Classify existing issues or PRs with the Boring state model and record the next action.
disable-model-invocation: true
---

# Triage

Classify; do not implement. Use the labels, blocker vocabulary, and transitions in
`docs/kanzen/boring-loop.md`.

1. Read the item, comments, links, and relevant code/docs.
2. Verify cheaply when safe; bugs need a red-capable repro or concrete manual path.
3. Stop at the first blocker; apply one category when possible and exactly one state.
4. Post:

```text
State: <state>  Category: <category>
Blocked by: <first blocker>
Next: /skill:<route> <target>
Proof expected: <command | demo | manual step | waiver>
Human request: <ask_user id or comment URL, if any>
Notes: <only material context>
```

Use `ask_user` for specific human questions; otherwise post them on the issue/PR.
