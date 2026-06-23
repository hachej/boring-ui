---
name: loop-grill
description: "Use for /loop-grill or the clarity gate: clarify a Kanzen issue with grill-me and ask-user, then return it to triage or keep it blocked."
---

# Loop Grill

Goal: make an unclear issue clear. Do not plan deeply and do not implement.

## Flow

| Step | Action |
| --- | --- |
| Read | issue, comments, captured context, screenshots, related code/docs |
| Self-answer | answer routing-critical facts from the repo before asking Julien |
| Ask | use grill-me style questions through ask-user; ask only what changes routing |
| Summarize | write observed, expected, acceptance criteria, proof path, open risks |
| Route | update labels and one next action |

## Exit

| Result | Labels | Gate |
| --- | --- | --- |
| still unclear | `state:blocked phase:grill` | `clarity` |
| clear enough | `state:queued phase:triage` | `triage` |
| not worth doing | `state:done` | none |

Question rule: prefer one decisive question; use up to three only when one
answer cannot route the work. For async grill, leave one ask-user session
pending with issue URL/title, why blocked, the questions/choices, answer format,
and resume command `/loop-grill <issue>`, then stop.

Search only until routing is clear; two or three relevant repo references are
enough unless one more check would remove the need to ask Julien.
