---
name: boring-loop-grill
description: "Use for /loop-grill: clarify one Kanzen issue with grill-me and ask-user, then return it to triage or keep it blocked."
---

# Boring Loop Grill

Make an unclear issue clear enough to route. Do not plan deeply. Do not
implement.

## Steps

1. Read the issue, comments, captured context, screenshots, and nearest code/docs.
2. Self-answer anything the repo can answer quickly.
3. Ask only questions that change routing, acceptance, proof, or risk.
4. Use grill-me style questions; use ask-user for async owner input.
5. Write the clarified summary, acceptance, proof path, and open risks back to
   the issue.

## Exit

- Still unclear: `state:blocked phase:grill track:owner`, gate `clarity`.
- Clear enough: `state:queued phase:triage track:owner`, gate `triage`.
- Not worth doing: `state:done`, with a short reason.

For async grill, leave one pending ask-user session with issue URL/title, why it
is blocked, the questions, answer format, and resume command
`/loop-grill <issue>`.
