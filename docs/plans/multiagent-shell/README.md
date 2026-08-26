# Multi-agent workspace shell — plan pack

The owner's multi-agent collaboration vision and the route that builds it. Three
chapters over one substrate: a **shell** (where it lives), an **engine** (what
makes a thread multi-agent), and a **consumer** (the first persona it serves).
This file owns the ordering; the chapters never re-list each other.

Canonical PR: [#1409](https://github.com/hachej/boring-ui/pull/1409) ·
North star: [#1399](https://github.com/hachej/boring-ui/issues/1399)

---

## The vision, in one screen

*(Distilled from the owner ruling ledger in #1399. Already ruled — the gates
below are about the route, not the vision.)*

**Transparent multi-agent.** A thread looks like today's chat, with several
agents inside it. **One composer.** Workers are hidden behind the orchestrator:
the user sees a *voice*, not a *seat*. Staffing collapses behind one merged
transcript; per-agent logs are drill-down provenance, like CI logs behind a PR
check.

**1 Thread = 1 job.** The thread is the unit of WORK, not of agent. The user
talks to the job. **Threads archive, they don't die** — history and attribution
retained, searchable, out of the default list.

**The shell = Inbox / Work / Agents / Library / Search**, over one workspace.
Nav is domains; the vertical plugin rail is tools. **Chat opens as a column
beside any view, never a page switch.** Library is the view library — files,
saved views, agent outputs — with *Dockview demoted to renderer*. The embedded
workbench is **one component with four mounts**: thread canvas, inbox evidence
viewer, file popover, standalone Library.

**Two boundaries, deliberately different.** Artifacts are **shared** via one
canonical workspace filesystem with distinct per-seat authority (D25/D28). The
conversation is **posts-only** — only settled posts and system markers cross a
seat boundary. Agents share the work, not each other's minds and keys.

**Real-SaaS and agent-SaaS, mixed:** deterministic Views beside agentic Threads,
composing as apps-as-recipes into a company OS.

---

## Chapter map

| # | Chapter | Owns | Read it when |
|---|---|---|---|
| 1 | [`shell-plan.md`](shell-plan.md) | The **new workspace layout**: IA, four mounts, center modes, Library, shell location contract, and the integration route (L1–L7c) | You are building or reviewing any surface |
| 2 | [`job-thread-plan.md`](job-thread-plan.md) | The **engine**: `JobProjectionV0`, the relay, typed handoffs, receipts, the seat boundary (S1–S6) | You are making a thread actually multi-agent |
| 3 | [`chief-of-staff-delta.md`](chief-of-staff-delta.md) | The **consumer**: the founder / chief-of-staff persona and its D1–D6 capability deltas (F1–F3) | You are asking what this substrate is *for* |

**Gate documents** (visual, one screen per question — read these before ruling):

- [`shell-plan-review.html`](shell-plan-review.html) — 13 questions
- [`job-thread-plan-review.html`](job-thread-plan-review.html) — 8 rulings

**Relationship.** The consumer's deltas ride on the shell's surfaces (D1/D3
render into Inbox and Work, D2's queue is a Library view, D3's review is an
attention item) and on Job Threads as the execution unit. Each chapter keeps its
own owner gate; none supersedes another.

---

## Status

**Pre-gate. No implementation bead is dispatchable.** Each chapter carries its
own gate; all three are unanswered.

| Gate | Blocks | State |
|---|---|---|
| Shell gate — 13 questions (`wt-391-forward-shell-ngfs.1`) | all 11 shell beads | open |
| Engine gate — 8 rulings (`wt-391-forward-jfxd.1`) | S1–S6, and shell L4 through S4 | open |
| PR [#1401](https://github.com/hachej/boring-ui/pull/1401) — multi-seat Thread amendment | *(was: the premise itself)* | **ratified 2026-08-26** ✅ |
| #1355 Gate 1 | console collections → live Work rows, Library persistence | unanswered |

**The honest unblocked tranche** (after the shell gate only): **L1** layout
traits · **L1.5** shell location · **L2a** nav chrome · **L3a** center modes —
plus L6 in part. Everything else waits on a gate owned elsewhere.

**Honest risk.** The spike proves the *frame*, not the *chat*: the composer and
the thread transcript are visual fixtures in every place they appear. Slice L4
is where that gets proven, and L4 is also the slice gated on the engine.

---

## Live artifacts

- **Spike branch** `weekend/saas-hybrid-spike` (HEAD `e027c90d4`) — proves the
  IA is a recomposition of shipped components. Cited at `file:line` throughout
  chapter 1. Worktree: `.worktrees/weekend-saas-spike`.
- **The design canvas** (owner-iterated *Meridian Shell* mockups) — settled the
  visual language and the five-domain IA.
- **Design lineage:** [#1357](https://github.com/hachej/boring-ui/pull/1357)
  persistent console surface → `docs/issues/1355/plan.md` →
  [#1393](https://github.com/hachej/boring-ui/pull/1393) left-pane view modes →
  design canvas → spike → this pack.
- **Beads:** epic `wt-391-forward-shell-ngfs` (shell),
  `wt-391-forward-jfxd` (engine).
