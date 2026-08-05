---
name: handoff
description: Create or resume a verified cross-session task handoff.
argument-hint: "create <receiver-or-purpose> | resume <artifact>"
disable-model-invocation: true
---

# Handoff

Transfer one bounded task between sessions without making the handoff a new
source of task truth. Read
`docs/kanzen/procedures/session-handoff.md` (procedure) and
`.agents/skills/handoff/CONTRACT.md` (full contract template and semantics),
then take exactly one branch:

- `create <receiver-or-purpose>` — probe current authority and execution state,
  persist the compact contract, then notify the receiver.
- `resume <artifact-reference>` — verify authority, drift, and atomic admission;
  record consumption, then take the exact next action.

An empty, incomplete, or unknown branch returns this usage and stops:

```text
/skill:handoff create reviewer-for-bead-123
/skill:handoff resume <artifact-reference>
```

If a human owes the next decision, use
`docs/kanzen/procedures/owner-review-card.md` instead.

Return branch-specific evidence:

- `create`: artifact reference/revision/digest, sender/intended receiver,
  authority probes, task-link and notification receipts, and resume command;
- `resume`: receiving session, authority/admission probes, consumption receipt
  and started action, or a durable stopped/conflict receipt.

Use `none: not applicable to <branch>` for any shared output field that does not
apply.
