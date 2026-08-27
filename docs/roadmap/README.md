# Roadmap — the readable view

**This file schedules nothing.** The single executable ordering and merge
queue live in [`../direction/DIRECTION.md`](../direction/DIRECTION.md); if
this view and DIRECTION ever disagree, DIRECTION wins and this file has a
bug. What this page adds is the *shape* — how the programs relate — for a
reader who wants the map before the queue.

## The premises-first program (multi-agent surface)

The product surface is built **on** kernel capabilities, not beside them
(ratified 2026-08-26, RECONCILIATION §8). These are parallel premise lanes with
individual dependency edges, not one serial order — rationale in
[`premises.md`](../plans/multiagent-shell/premises.md):

1. **[durable-streams]** — conversations a client can always resume,
   default-on. The keystone: the engine does not ship without it. Tracked as
   bead `wt-391-forward-9p50`.
2. **[thread-storage-spike]** — decide what a multi-seat Thread *is* in
   storage, with a competitor study. Its research half may run in parallel; the
   technical half consumes P1a's durable-stream shape and blocks the engine's
   first slice.
3. **[seat-audit-attribution]** — an independent P3a → P3b lane for audit-grade who-said-what; display-only attribution
   is rejected as a shipping position.
4. **[kernel-views]** — the first ratified View slice; Library saved views
   wait for it.
5. **[merge-queue]** — standing branch health, owned by DIRECTION's queue.
6. **Gates re-ruled** after the storage spike reports.

**May run early (substrate-free):** the three shell chrome slices — layout
traits, shell location, nav chrome — because they touch no thread, session,
storage, or attribution.

**Runs alongside [durable-streams]:** the **pi-0.84.3 core-adoption spike**
(bead `wt-391-forward-9n6w`) — our agent-runtime dependency shipped its v4
durable core and deleted the legacy line our pin sits on; the spike proves
the migration path through the gateway and sizes what our bespoke streaming
surface keeps vs delegates. Whether it *blocks* the durable-streams work is
an explicit DIRECTION amendment only the owner makes. The `PiPlatform` seam
(bead `wt-391-forward-oueu`) is the adoption-neutral companion.

## What each program waits on

| Program | Waits on | Detail |
|---|---|---|
| Multi-agent engine mechanics (Job Threads) | [durable-streams] + both [thread-storage-spike] outputs, then its post-evidence owner gate | [`job-thread-plan.md`](../plans/multiagent-shell/job-thread-plan.md) |
| Audit-grade attribution substrate | independent P3a host catalogue/envelope → P3b provenance projection | [`premises.md`](../plans/multiagent-shell/premises.md) P3 |
| Thread rendering | join of [durable-streams], [thread-storage-spike], and [seat-audit-attribution] | [`shell-plan.md`](../plans/multiagent-shell/shell-plan.md) thread-view slice |
| Other shell surfaces beyond early chrome | their slice-specific owner-gate and Bead dependencies; no blanket “wait for the engine” rule | [`shell-plan.md`](../plans/multiagent-shell/shell-plan.md) |
| Chief-of-staff consumer | the exact shell/engine surfaces each delta consumes | [`chief-of-staff-delta.md`](../plans/multiagent-shell/chief-of-staff-delta.md) |
| Library saved views | [kernel-views] | premises P4 |
| Remote/third-party hosts, marketplace | their own frozen gates | DIRECTION Wave 4 |
| Commercial sequencing | nothing platform-side — it lives in Seneca | tenant repo roadmap |

## Where execution actually happens

DIRECTION's current queue has two parallel waves: **Wave A — Premises** for the
kernel work above, plus only the explicitly substrate-free shell-layout,
shell-location, and shell-navigation tranche; and **Wave B — Commercial**, whose
commercial ordering lives in the Seneca tenant repository while Boring supplies
only neutral platform substrate. The older numbered waves are historical and
superseded for dispatch. Read [`../direction/DIRECTION.md`](../direction/DIRECTION.md)
before dispatching anything; read [`../vision/README.md`](../vision/README.md)
first if you want the story the queue serves.
