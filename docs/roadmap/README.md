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

## Native creation — the first complete product journey (ratified 2026-09-07)

RECONCILIATION §13 makes create → release → install for a separate consumer →
adapt → maintain the first complete journey, executed in this repository on
the existing packages. The premises program above is unchanged and is what
this journey's "job continuity" stage consumes. Epic
[#1562](https://github.com/hachej/boring-ui/issues/1562); pack
[`native-creation/`](../plans/native-creation/README.md).

| Order | Slice | Delivers | Gate |
|---|---|---|---|
| 1 | Release manifest (`nc-1`) | Immutable content-addressed release record | now |
| 2 | Thread identity (`nc-t`) | Job root with session bindings; no product key may use a session id; timeline shape stays spiked | now |
| 3 | Installation + activation (`nc-2`) | Installation record; CAS, request-keyed activation receipts; undo as activation | after 1, 2 |
| 4 | Builder seat (`nc-6`) | `product-builder` agent: candidates into the release store, never activates | after 1, 3 |
| 5 | Bridge operations (`nc-3`) | `product.v1.*` trusted handlers | after 2, 3 |
| 6 | First View slice (`nc-v`) | ViewDescriptor/Resolver/Host/Context/Ref for record + dashboard; P4's first consumer | after 5 |
| 7 | Library + Thread canvas (`nc-l`) | Installed product in Library; opens as a Thread in Work | after 2, 5, 6, [shell-layout] |
| ∥ | Embedded runtime gate (`nc-0`) | In-process hot-loaded server plugins become the default-off `embedded` mode | now |
| 8–10 | Runtime seam, `local` adapter, isolated View renderer (`nc-4a`, `nc-4b`, `nc-5`) | Isolation for a second consumer on a shared host | after ∥, 5, 6 |
| 11 | First journey acceptance (`nc-7`) | Math-tutor fixture installed for a second user in `local` mode; survives builder-sandbox destruction and one upstream update | after 7, 4, 9, 10 |

The lifecycle ladder E0–E6 below (folded from the former Workspace Evolution
pack) remains the acceptance vocabulary for later classes; E1 is what `nc-7`
proves for the first consumer.

## Workspace Evolution extension — specified, folded into native creation

The owner-requested 2026-09-05 amendment, generalized 2026-09-06, adds a consumer program on
owner merge. Its [E0–E6 milestones](../plans/native-creation/LIFECYCLE.md#milestones)
prove private adaptation, downstream maintenance, and approved reuse:

| Milestone | Observable result | Key gate |
|---|---|---|
| E0 — request/preview preparation | One unit across two mounts and Clinic + Charlotte/Seneca synthetic fixtures; labeled ESG assumptions | Owner adoption; no live data path, production activation or substitute saved View |
| E1 — workspace revision | E1a durable activation/undo; E1b selected live consumer's domain work and Job Thread outside chat; both complete E1 | E1a: E0 + P1-C and consumed premises; full View contract if saved. E1b: domain migration as needed plus mandatory [thread-storage-spike] and [seat-audit-attribution]; Clinic migration for Clinic |
| E2 — personal scope | Two users keep different presentations over shared work; parallel subjects and personal state stay isolated | E1 + authenticated scope; Seat attribution where consumed |
| E3 — behavior revision | Allowed personal behavior remains attributable and survives expert updates | E1/E2 + behavior evaluation and policy boundaries |
| E4 — generated module | A new private component runs with scoped data and safe removal | E1/E2 + proven build/serving isolation in C4 |
| E5 — upgrade reconciliation | Intent survives an update or a precise conflict blocks it; second live domain consumer before cross-domain claims | E1/E2 for configuration; E3/E4 only for their artifact classes; Rule of Three still gates kernel promotion |
| E6 — approved reuse | A second workspace adopts a useful optional package | E5 + export/maintainer authority and reuse evidence |

E5's configuration proof runs before expanding the catalog; it does not wait
for generated modules. [The software model](../vision/software-model.md)
uses Clinic, Charlotte/Seneca and a labeled ESG hypothesis to test distinct
responsibilities. One selected consumer earns the first live loop; another
earns a claimed shared capability. Clinic retains its own migration/capture
obligations. A full Meridian shell, all-client rollout or multi-agent engine
is not needed for E0. Commercial sequencing remains tenant-owned.
The [implementation-spec crosswalk](../plans/long-term/ratified/V2-IMPLEMENTATION-SPEC.md#workspace-evolution-milestone-extension--2026-09-05)
relates E-slices to M0–M8 without reopening the new-repo freeze.

## Where execution actually happens

DIRECTION's current queue has two parallel waves: **Wave A — Premises** for the
kernel work above, plus only the explicitly substrate-free shell-layout,
shell-location, and shell-navigation tranche; and **Wave B — Commercial**, whose
commercial ordering lives in the Seneca tenant repository while Boring supplies
only neutral platform substrate. The older numbered waves are historical and
superseded for dispatch. The
[2026-09-06 amendment](../direction/DIRECTION.md#amendment-2026-09-06--cross-domain-workspace-evolution)
adds E0 preparation and the explicitly gated evolution consumers to that
program; it preserves the premise priority. Read [`../direction/DIRECTION.md`](../direction/DIRECTION.md)
before dispatching anything; read [`../vision/README.md`](../vision/README.md)
first if you want the story the queue serves.
