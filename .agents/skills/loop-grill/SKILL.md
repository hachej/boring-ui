---
name: loop-grill
description: "Use for /loop-grill or gate:clarity: clarify a Kanzen issue with grill-me and ask-user, then return it to triage or keep it blocked."
---

# Loop Grill

Goal: make an unclear issue clear. Do not plan deeply and do not implement.

## Flow

| Step | Action |
| --- | --- |
| Read | issue, comments, captured context, screenshots, related code/docs |
| Self-answer | answer anything discoverable from the repo before asking Julien |
| Ask | use grill-me style questions through ask-user; ask only what changes routing |
| Summarize | write observed, expected, acceptance criteria, proof path, open risks |
| Route | update labels and one next action |

## Exit

| Result | Labels / Gate |
| --- | --- |
| still unclear | `state:blocked phase:grill gate:clarity` |
| clear enough | `state:queued phase:triage gate:intake` |
| not worth doing | `state:done` with close/defer note |

Question rule: prefer one decisive question over five broad ones. For async
grill, leave the ask-user session pending and stop.
