---
github: https://github.com/hachej/boring-ui/issues/807
issue: 807
state: deferred
phase: plan
track: owner
flag: not-needed
updated: 2026-07-17
---

# #807 Durable multi-channel agent transport

## Canonical entry

This issue owns Durable event/replay and transport work, plus the relocated Slack Chat SDK transport reference. The physical plan move from #391 is complete; this
file is the canonical entry and index. These plans are outside #391's static
P0→N1 critical path and remain subject to [Decision 25](../../DECISIONS.md#25-static-multi-agent-composition-after-agenthost-removal).

## Canonical documents

- [`T1-durable-events`](runtime-refactor/work/T1-durable-events)
- [`T2-transport`](runtime-refactor/work/T2-transport)
- [`S1-slack-channel/CHAN-A-chat-sdk-transport`](runtime-refactor/work/S1-slack-channel/CHAN-A-chat-sdk-transport.md)

Historical #391 architecture and the static multi-agent plan remain at
[`../391/plan.md`](../391/plan.md) and are context, not this issue's work-order
authority.
