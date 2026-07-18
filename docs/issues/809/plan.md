---
github: https://github.com/hachej/boring-ui/issues/809
issue: 809
state: deferred
phase: plan
track: owner
flag: not-needed
updated: 2026-07-17
---

# #809 Marketplace, identity, and consumer channels

## Canonical entry

This issue owns demand-gated marketplace, identity, consumption-contract, billing, catalog, channel, control-plane, and onboarding planning. The physical plan move from #391 is complete; this file is the canonical entry and index. Decision 26 splits AC1 by binding: workspace-local native delegation in Step 2, external A2A ingress in Step 3, and contracted/service agents later. Existing detailed plans are non-dispatchable until recut against [`../391/AGENT-CONSUMPTION-MODES.md`](../391/AGENT-CONSUMPTION-MODES.md) and [`../391/ROADMAP-ALIGNMENT.md`](../391/ROADMAP-ALIGNMENT.md).

## Canonical documents

- [`ID1-agent-identity`](runtime-refactor/work/ID1-agent-identity)
- [`AC1-agent-consumption-contract`](runtime-refactor/work/AC1-agent-consumption-contract)
- [`BL1-engagement-billing`](runtime-refactor/work/BL1-engagement-billing)
- [`MK1-agent-catalog`](runtime-refactor/work/MK1-agent-catalog)
- [`CH1-consumer-channels`](runtime-refactor/work/CH1-consumer-channels)
- [`S3-control-plane-ux`](runtime-refactor/work/S3-control-plane-ux)
- [`S4-agent-onboarding`](runtime-refactor/work/S4-agent-onboarding)
- [`MARKETPLACE-PATH`](runtime-refactor/MARKETPLACE-PATH.md)
- [`GTM-STRATEGY`](runtime-refactor/GTM-STRATEGY.md)
- [`GTM-CALLKITS`](runtime-refactor/GTM-CALLKITS.md)

Historical #391 architecture and the active phased product plan remain at
[`../391/plan.md`](../391/plan.md). The latter controls shared sequencing; this
issue regains dispatch authority only after its own Decision 26 recut.
