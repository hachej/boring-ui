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

This issue owns durable event/replay and transport work, plus the relocated Slack Chat SDK transport reference. The physical plan move from #391 is complete; this file is the canonical entry and index. Decision 26 places this programme in Step 3 after domain-routed products and same-workspace multi-agent consumers exist. T1/T2 must be recut away from D1/P1 assumptions before dispatch and will support durable external MCP/A2A bindings. See [`../391/ROADMAP-ALIGNMENT.md`](../391/ROADMAP-ALIGNMENT.md).

## Canonical documents

- [`T1-durable-events`](runtime-refactor/work/T1-durable-events)
- [`T2-transport`](runtime-refactor/work/T2-transport)
- [`S1-slack-channel/CHAN-A-chat-sdk-transport`](runtime-refactor/work/S1-slack-channel/CHAN-A-chat-sdk-transport.md)

Historical #391 architecture and the active phased product plan remain at
[`../391/plan.md`](../391/plan.md). The latter controls shared sequencing; this
issue regains dispatch authority only after its own Decision 26 recut.
