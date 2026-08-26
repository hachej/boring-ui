# Roadmap — the readable view

**This file schedules nothing.** The single executable ordering and merge
queue live in [`../direction/DIRECTION.md`](../direction/DIRECTION.md); if
this view and DIRECTION ever disagree, DIRECTION wins and this file has a
bug. What this page adds is the *shape* — how the programs relate — for a
reader who wants the map before the queue.

## The premises-first program (multi-agent surface)

The product surface is built **on** kernel capabilities, not beside them
(ratified 2026-08-26, RECONCILIATION §8). In dependency order — rationale in
[`premises.md`](../plans/multiagent-shell/premises.md):

1. **[durable-streams]** — conversations a client can always resume,
   default-on. The keystone: the engine does not ship without it. Tracked as
   bead `wt-391-forward-9p50`.
2. **[thread-storage-spike]** — decide what a multi-seat Thread *is* in
   storage, with a competitor study. Blocks the engine's first slice.
3. **[seat-storage]** — audit-grade who-said-what; display-only attribution
   is rejected as a shipping position.
4. **[kernel-views]** — the first ratified View slice; Library saved views
   wait for it.
5. **[merge-queue]** — standing branch health, owned by DIRECTION's queue.
6. **Gates re-ruled** after the storage spike reports.

**May run early (substrate-free):** the three shell chrome slices — layout
traits, shell location, nav chrome — because they touch no thread, session,
storage, or attribution.

## What each program waits on

| Program | Waits on | Detail |
|---|---|---|
| Multi-agent engine (Job Threads) | premises 1–3, then its owner gate | [`job-thread-plan.md`](../plans/multiagent-shell/job-thread-plan.md) |
| Shell surfaces beyond chrome | the shell owner gate + the engine | [`shell-plan.md`](../plans/multiagent-shell/shell-plan.md) |
| Chief-of-staff consumer | the shell + the engine | [`chief-of-staff-delta.md`](../plans/multiagent-shell/chief-of-staff-delta.md) |
| Library saved views | [kernel-views] | premises P4 |
| Remote/third-party hosts, marketplace | their own frozen gates | DIRECTION Wave 4 |
| Commercial sequencing | nothing platform-side — it lives in Seneca | tenant repo roadmap |

## Where execution actually happens

DIRECTION's waves (currently: multi-agent console demo → streaming
durability + fleet execution → BYOK/MCP on named consumers → v2 era) are the
dispatch truth, bead by bead. Read
[`../direction/DIRECTION.md`](../direction/DIRECTION.md) before dispatching
anything; read [`../vision/README.md`](../vision/README.md) first if you
want the story the waves serve.
