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
2. **[thread-storage-spike]** — decide the Thread timeline's storage
   **shape** (first-class stream vs projection over Sessions). The value root
   is RULED (2026-08-27, RECONCILIATION §9a: Thread = job root, 0..n
   Sessions) and the competitor study is DONE; the shape spike consumes
   P1-A's durable-stream shape and blocks the engine's first slice.
3. **[seat-audit-attribution]** — an independent `.14.1` → `.14.2` lane for audit-grade who-said-what; display-only attribution
   is rejected as a shipping position.
4. **[kernel-views]** — the first ratified View slice; Library saved views
   wait for it.
5. **[merge-queue]** — standing branch health, owned by DIRECTION's queue.
6. **Gates re-ruled** after the storage spike reports.

**May run early (substrate-free):** the three shell chrome slices — layout
traits, shell location, nav chrome — because they touch no thread, session,
storage, or attribution.

**Post-spike (owner-ruled 2026-08-27):** both spikes are DONE. The **pi-0.84.3
core-adoption spike** (`wt-391-forward-9n6w`) verdict: do not wire 0.84.3 —
the published harness is a `HarnessNotImplemented` scaffold, the v3 decoder is
dev-only, and lanes fail the posts-only isolation test. The **competitor
research half** (`shell-ngfs.13.1`) is also done: Linear/Intercom stand as
existence proofs for the value-root ontology since ruled in §9a. [durable-streams]'s P1
substrate-neutral work — plus the private harness backend seam under D29 —
starts NOW, behind the merge-queue preflight. **Second grill 2026-08-27: the
pi wait on the event-store slice is REMOVED** (RECONCILIATION §9c) — P1-B
builds Boring's own event backend behind the seam once the seam (A2) lands. The **headless golden path** (API/CLI job in → agent runs →
artifact → decision → restart survives → delivery) runs **parallel, never
gating** substrate-free shell chrome — but it is required evidence for P1
completion, so it indirectly gates every Thread-view slice that consumes P1.

## What each program waits on

| Program | Waits on | Detail |
|---|---|---|
| Multi-agent engine mechanics (Job Threads) | [durable-streams] + both [thread-storage-spike] outputs, then its post-evidence owner gate | [relay candidate (historical)](../plans/multiagent-shell/research/candidates/relay-projection-v0-job-thread-plan.md) — new engine plan post-shape-spike |
| Audit-grade attribution substrate | independent `.14.1` host catalogue/envelope → `.14.2` provenance projection | [`premises.md`](../plans/multiagent-shell/premises.md) P3 |
| Thread rendering | join of [durable-streams], [thread-storage-spike], and [seat-audit-attribution] | [`shell-plan.md`](../plans/multiagent-shell/shell-plan.md) thread-view slice |
| Other shell surfaces beyond early chrome | their slice-specific owner-gate and Bead dependencies; no blanket “wait for the engine” rule | [`shell-plan.md`](../plans/multiagent-shell/shell-plan.md) |
| Chief-of-staff consumer | the exact shell/engine surfaces each delta consumes | [`chief-of-staff-delta.md`](../plans/multiagent-shell/chief-of-staff-delta.md) |
| Library saved views | [kernel-views] | premises P4 |
| Remote/third-party hosts, marketplace | their own frozen gates | DIRECTION Wave 4 |
| Commercial sequencing | nothing platform-side — it lives in Seneca | tenant repo roadmap |

## Workspace Evolution extension — specified, not shipped

The owner-requested 2026-09-05 amendment adds a named consumer program on
owner merge. Its [E0–E6 milestones](../plans/workspace-evolution/README.md#milestones)
prove private adaptation, downstream maintenance, and approved reuse:

| Milestone | Observable result | Key gate |
|---|---|---|
| E0 — request/preview preparation | One real request mapped to existing components and a fixture preview | Owner adoption; no production activation |
| E1 — workspace revision | Request → immutable candidate → preview → activate/undo survives restart | E0 + P1-C accepted-work/recovery; saved semantic Views also need the View contract |
| E2 — personal scope | Two users keep different settings over shared work | E1 + authenticated scope; Seat attribution where consumed |
| E3 — behavior revision | Allowed personal behavior remains attributable and survives expert updates | E1/E2 + behavior evaluation and policy boundaries |
| E4 — generated module | A new private component runs with scoped data and safe removal | E1/E2 + proven build/serving isolation in C4 |
| E5 — upgrade reconciliation | Local intent survives an upstream update; a conflict stops activation | E1/E2 for configuration; E3/E4 only for their artifact classes |
| E6 — approved reuse | A second workspace adopts a useful optional package | E5 + export/maintainer authority and reuse evidence |

E5's configuration proof runs before expanding the catalog; it does not wait
for generated modules. Clinic is the first workflow and Seneca the target
authenticated host. These are acceptance consumers, not a change to GTM order.
The [implementation-spec crosswalk](../plans/long-term/ratified/V2-IMPLEMENTATION-SPEC.md#workspace-evolution-milestone-extension--2026-09-05)
relates E-slices to M0–M8 without reopening the new-repo freeze.

## Where execution actually happens

DIRECTION's current queue has two parallel waves: **Wave A — Premises** for the
kernel work above, plus only the explicitly substrate-free shell-layout,
shell-location, and shell-navigation tranche; and **Wave B — Commercial**, whose
commercial ordering lives in the Seneca tenant repository while Boring supplies
only neutral platform substrate. The older numbered waves are historical and
superseded for dispatch. The
[2026-09-05 amendment](../direction/DIRECTION.md#amendment-2026-09-05--workspace-evolution)
adds E0 preparation and the explicitly gated evolution consumers to that
program; it preserves the premise priority. Read [`../direction/DIRECTION.md`](../direction/DIRECTION.md)
before dispatching anything; read [`../vision/README.md`](../vision/README.md)
first if you want the story the queue serves.
