# Multi-agent workspace shell — plan pack

The owner's multi-agent collaboration vision, and the **premises-first program**
that builds it. The design is settled; what this pack sequences is the kernel
work the design waits on.

Canonical PR: [#1409](https://github.com/hachej/boring-ui/pull/1409) ·
North star: [#1399](https://github.com/hachej/boring-ui/issues/1399) ·
Re-cut by owner direction 2026-08-26

> **Merging #1409 ratifies** the §8 amendment it carries in
> `docs/plans/long-term/ratified/RECONCILIATION.md` (surface shape, ratified
> spec artifacts, premises-precede-surface). Earlier vehicles #1416, #1403,
> #1389, #1417 and #1418 are closed and absorbed here. The plan chapters
> themselves stay planning material, not ratified text.

---

## Read this first: the program

**Premises before surface.** As of 2026-08-26 this is not "plan the UI, then
build it". A small number of kernel capabilities must land and be proven first;
the surface is built on top of them. Two rulings set the tone:

- **The engine does not ship on Level B.** Levels are the ratified durability
  conformance scale: Level B ≈ bounded replay + snapshot rehydrate (what we have
  today), Level D ≈ fully durable streams a client can always resume. The engine
  waits for Level D (P1).
- **The thread storage model is half decided.** The value root is ruled
  (2026-08-27, RECONCILIATION §9a: Thread = job root, 0..n Sessions; the
  competitor study is done); only the storage **shape** — first-class stream
  vs projection — still goes to the P2 spike, and the engine's data-model
  slice waits on its findings.

| # | Premise | State | Unblocks |
|---|---|---|---|
| **P1** | Durable streams — Level D conformance, default-on | epic `wt-391-forward-9p50`; beads A1–A5 (`.1/.3/.4/.5/.6`) → P1-B (`.7`) → P1-C (`.2`) | the whole engine |
| **P2** | Thread storage **shape** (value root RULED, §9a; study DONE) | epic `shell-ngfs.13`; `.13.1` research CLOSED, `.13.2` shape spike after P1-A | engine S1, #1355 ref types |
| **P3** | Seat storage — the tamper-proof who-said-what record (ratified concept, formerly C7) | epic `shell-ngfs.14`; one-session children `.14.1` catalog/envelope + `.14.2` projection | honest who-said-what everywhere |
| **P4** | Kernel View — first ratified slice | **no sizing yet** | Library saved views |
| **P5** | Merge queue | standing obligation, not a bead | branch health for everything |
| **P6** | Gates re-ruled post-P2 | minutes of owner time, cannot happen early | both owner gates |

**[`premises.md`](premises.md) is the chapter that owns the dependency
rationale.** It carries the full P2 brief, the interview rulings, the
sequencing diagram, and the honest sizing. The **executable ordering and merge
queue** live in `docs/direction/DIRECTION.md` — the pack explains *why* things
wait; DIRECTION alone says *when* they run.

**Substrate-free exceptions** — slices that touch no thread, no session, no
storage, no attribution — may run early, in parallel with the premises:
**L1** layout traits · **L1.5** shell location · **L2a** nav chrome (counts
absent). "Substrate-free" is a property that can be checked, not an exemption
granted. (A *slice* is one implementation unit sized for a single work session;
each becomes one bead — one tracked issue — in the tracker.)

---

## The design is the specification

The design canvas (*Meridian Shell* — the set of owner-iterated visual mockups)
and the spike branch `weekend/saas-hybrid-spike` (a running frontend built by
recomposing existing components, not a feature branch) are **not proposals
awaiting a slot**. They are the **specification the premises are built to
serve** — the spike proves the whole IA is reachable with components that
already ship, and the canvas settled the visual language and the five-domain
structure. One honest boundary on that claim: the spike specifies the *frame*;
the chat transcript inside it is still a visual fixture (see **Status →
Honest risk**).

What that specification says:

**Transparent multi-agent — AMENDED 2026-08-27 (§9b): multi-author.** A
thread reads like a Slack thread: **one composer** for the human, several
**named agents visibly authoring posts** (chips, joined/handoff/left markers);
per-agent work logs stay one drill-down deeper. The earlier "workers hidden
behind one voice" formula is retired; the orchestrator is a named speaker
with its own Seat. **1 Thread = 1 job** — the durable job root, binding 0..n
Sessions (ratified 2026-08-26 PR #1401, amended by RECONCILIATION §9a).
**Threads archive, they don't die.**

**The shell = Search (top) / Inbox / Work / Agents / Library**, over one workspace. Nav
is domains; the vertical plugin rail is tools. **Chat opens as a column beside
any view, never a page switch.** Library is the view library, with *Dockview
demoted to renderer*. The embedded workbench is **one component with four
mounts**: thread canvas, evidence viewer, file popover, standalone Library.

**Two boundaries.** Artifacts are **shared** via one canonical workspace
filesystem with distinct per-seat authority (D28; D25's older shared-runtime wording is superseded). The conversation is
**posts-only**. Agents share the work, not each other's minds and keys.

**Real-SaaS and agent-SaaS mixed:** deterministic Views beside agentic Threads,
composing as apps-as-recipes into a company OS.

---

## Chapter map

| # | Chapter | Owns |
|---|---|---|
| 1 | [`premises.md`](premises.md) | **The program.** P1–P6, the P2 brief, interview rulings, sequencing. Start here. |
| 2 | [`shell-plan.md`](shell-plan.md) | The **layout**: IA, four mounts, center modes, Library, location contract, slices L1–L7c |
| 3 | [`relay-projection-v0-job-thread-plan.md`](research/candidates/relay-projection-v0-job-thread-plan.md) *(HISTORICAL CANDIDATE — demoted 2026-08-27, non-dispatchable)* | The **engine**: projection, relay, handoffs, seat boundary, S1–S6 |
| 4 | [`chief-of-staff-delta.md`](chief-of-staff-delta.md) | The **consumer**: founder / chief-of-staff persona, D1–D6, F1–F3 |
| 5 | [`research/`](research/README.md) | The **evidence**: spikes, studies, reviews — indexed with supersessions |

**Gate documents** (visual, one screen per question):
[`shell-plan-review.html`](shell-plan-review.html) ·
[`relay-projection-v0-job-thread-plan-review.html`](research/candidates/relay-projection-v0-job-thread-plan-review.html)

**Ruling record:** [`north-star-ledger.md`](north-star-ledger.md) absorbs
issue #1399 — every dated owner ruling behind this pack, verbatim, each
annotated with what later rulings kept or superseded. The pack's "#1399"
citations resolve there.

Chapters 2–4 keep their content; their **dependency rationale derives from
chapter 1**, and the executable ordering lives in `docs/direction/DIRECTION.md`.
Each chapter carries a dated *Re-sequencing ruling 2026-08-26* block at its
sequencing section, superseding the graph it shipped with. The chapters never
re-list each other.

---

## Status

**Pre-gate, and now premise-gated.** A *gate* is a batched owner-review event:
a document of questions only the owner can rule on, blocking the beads listed
against it until ruled. No shell or engine implementation bead is dispatchable
except the three substrate-free chrome slices.

| Gate | Blocks | State |
|---|---|---|
| **P1 durable streams** | the entire engine | open, beaded |
| **P2 storage spike** | engine S1, engine gate | open, newly scoped |
| Shell gate — 13 questions (`wt-391-forward-shell-ngfs.1`) | shell beads | open; several questions now RULED |
| Engine gate — 8 rulings (`wt-391-forward-jfxd.1`) | S1–S6 | open; re-ruled post-P2 (P6) |
| #1355 Gate 1 | console collections → live Work rows | unanswered |
| PR [#1401](https://github.com/hachej/boring-ui/pull/1401) — multi-seat Thread amendment | *(was: the premise itself)* | **ratified 2026-08-26** ✅ |

**Honest risk.** The spike proves the *frame*, and (at the ratified commit
`08cc60523`) a **real single-agent chat session** inside a Thread. What it does
not prove is the *multi-voice transcript* — several agents behind one composer
with audit-grade attribution. That proof is L4, the thread-view slice, which
now sits behind P1, P2 and P3. Separately: **P2 and P3 are
coupled** (attribution shape depends on storage shape) and could deadlock if run
as independent spikes; P2's decision criteria are written to prevent it.

---

## Live artifacts

- **Spike branch** `weekend/saas-hybrid-spike`, ratified at immutable commit
  `08cc60523` — the specification, cited at `file:line` throughout chapter 2.
  Worktree `.worktrees/weekend-saas-spike`.
- **The design canvas** — owner-iterated *Meridian Shell* mockups.
- **Design lineage:** [#1357](https://github.com/hachej/boring-ui/pull/1357)
  persistent console surface → `docs/issues/1355/plan.md` →
  [#1393](https://github.com/hachej/boring-ui/pull/1393) left-pane view modes →
  design canvas → spike → this pack.
- **Beads:** `wt-391-forward-shell-ngfs` (shell + premises),
  `wt-391-forward-jfxd` (engine), `wt-391-forward-9p50` (P1).
