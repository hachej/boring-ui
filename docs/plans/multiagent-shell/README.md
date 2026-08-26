# Multi-agent workspace shell — plan pack

The owner's multi-agent collaboration vision, and the **premises-first program**
that builds it. The design is settled; what this pack sequences is the kernel
work the design waits on.

Canonical PR: [#1409](https://github.com/hachej/boring-ui/pull/1409) ·
North star: [#1399](https://github.com/hachej/boring-ui/issues/1399) ·
Re-cut by owner direction 2026-08-26

---

## Read this first: the program

**Premises before surface.** As of 2026-08-26 this is not "plan the UI, then
build it". A small number of kernel capabilities must land and be proven first;
the surface is built on top of them. Two rulings set the tone:

- **The engine does not ship on Level B.** It waits for durable streams (P1).
- **The thread storage model is not decided.** It goes to a spike with a
  competitor study (P2), and the engine's data-model slice waits on its findings.

| # | Premise | State | Unblocks |
|---|---|---|---|
| **P1** | Durable streams — Level D conformance, default-on | beaded (`wt-391-forward-9p50`), ~2 sessions | the whole engine |
| **P2** | Thread storage model — spike + competitor study | **newly scoped**, brief in ch.1 | engine S1, the storage question, #1355 ref types |
| **P3** | Seat storage / C7 — audit-grade attribution | ratified in principle, unscoped in practice | honest who-said-what everywhere |
| **P4** | Kernel View — first ratified slice | **no sizing yet** | Library saved views |
| **P5** | Merge queue | standing obligation, not a bead | branch health for everything |
| **P6** | Gates re-ruled post-P2 | minutes of owner time, cannot happen early | both owner gates |

**[`premises.md`](premises.md) is the chapter that owns this.** It carries the
full P2 brief, the interview rulings, the sequencing diagram, and the honest
sizing.

**Substrate-free exceptions** may run early, in parallel with the premises:
**L1** layout traits · **L1.5** shell location · **L2a** nav chrome (counts
absent). They touch no thread, no session, no storage, no attribution — a
property that can be checked, not an exemption granted.

---

## The design is the specification

The design canvas (owner-iterated *Meridian Shell*) and the spike branch
`weekend/saas-hybrid-spike` are **not proposals awaiting a slot**. They are the
**specification the premises are built to serve** — the spike proves the whole
IA is reachable by recomposing components that already ship, and the canvas
settled the visual language and the five-domain structure.

What that specification says:

**Transparent multi-agent.** A thread looks like today's chat, with several
agents inside it. **One composer.** Workers hidden behind the orchestrator: the
user sees a *voice*, not a *seat*. **1 Thread = 1 job** — the unit of WORK, not
of agent (ratified 2026-08-26, PR #1401). **Threads archive, they don't die.**

**The shell = Inbox / Work / Agents / Library / Search**, over one workspace. Nav
is domains; the vertical plugin rail is tools. **Chat opens as a column beside
any view, never a page switch.** Library is the view library, with *Dockview
demoted to renderer*. The embedded workbench is **one component with four
mounts**: thread canvas, evidence viewer, file popover, standalone Library.

**Two boundaries.** Artifacts are **shared** via one canonical workspace
filesystem with distinct per-seat authority (D25/D28). The conversation is
**posts-only**. Agents share the work, not each other's minds and keys.

**Real-SaaS and agent-SaaS mixed:** deterministic Views beside agentic Threads,
composing as apps-as-recipes into a company OS.

---

## Chapter map

| # | Chapter | Owns |
|---|---|---|
| 1 | [`premises.md`](premises.md) | **The program.** P1–P6, the P2 brief, interview rulings, sequencing. Start here. |
| 2 | [`shell-plan.md`](shell-plan.md) | The **layout**: IA, four mounts, center modes, Library, location contract, slices L1–L7c |
| 3 | [`job-thread-plan.md`](job-thread-plan.md) | The **engine**: projection, relay, handoffs, seat boundary, S1–S6 |
| 4 | [`chief-of-staff-delta.md`](chief-of-staff-delta.md) | The **consumer**: founder / chief-of-staff persona, D1–D6, F1–F3 |

**Gate documents** (visual, one screen per question):
[`shell-plan-review.html`](shell-plan-review.html) ·
[`job-thread-plan-review.html`](job-thread-plan-review.html)

Chapters 2–4 keep their content; their **sequencing derives from chapter 1**.
Each carries a dated *Re-sequencing ruling 2026-08-26* block at its sequencing
section, superseding the graph it shipped with. This file owns the ordering; the
chapters never re-list each other.

---

## Status

**Pre-gate, and now premise-gated.** No shell or engine implementation bead is
dispatchable except the three substrate-free chrome slices.

| Gate | Blocks | State |
|---|---|---|
| **P1 durable streams** | the entire engine | open, beaded |
| **P2 storage spike** | engine S1, engine gate | open, newly scoped |
| Shell gate — 13 questions (`wt-391-forward-shell-ngfs.1`) | shell beads | open; several questions now RULED |
| Engine gate — 8 rulings (`wt-391-forward-jfxd.1`) | S1–S6 | open; re-ruled post-P2 (P6) |
| #1355 Gate 1 | console collections → live Work rows | unanswered |
| PR [#1401](https://github.com/hachej/boring-ui/pull/1401) — multi-seat Thread amendment | *(was: the premise itself)* | **ratified 2026-08-26** ✅ |

**Honest risk.** The spike proves the *frame*, not the *chat* — the composer and
the thread transcript are visual fixtures everywhere they appear. That proof is
shell L4, which now sits behind P1, P2 and P3. Separately: **P2 and P3 are
coupled** (attribution shape depends on storage shape) and could deadlock if run
as independent spikes; P2's decision criteria are written to prevent it.

---

## Live artifacts

- **Spike branch** `weekend/saas-hybrid-spike` (HEAD `e027c90d4`) — the
  specification, cited at `file:line` throughout chapter 2. Worktree
  `.worktrees/weekend-saas-spike`.
- **The design canvas** — owner-iterated *Meridian Shell* mockups.
- **Design lineage:** [#1357](https://github.com/hachej/boring-ui/pull/1357)
  persistent console surface → `docs/issues/1355/plan.md` →
  [#1393](https://github.com/hachej/boring-ui/pull/1393) left-pane view modes →
  design canvas → spike → this pack.
- **Beads:** `wt-391-forward-shell-ngfs` (shell + premises),
  `wt-391-forward-jfxd` (engine), `wt-391-forward-9p50` (P1).
