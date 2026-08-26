# Premises — the program the surface waits on

**Owner direction, 2026-08-26.** The multi-agent shell is no longer sequenced as
"plan → build the UI". It is sequenced as **premises first**: a small number of
kernel capabilities that the product surface is built *on top of*, each landed
and proven before the surface that depends on it. The design canvas and the
spike branch are not a proposal to be scheduled — they are **the specification**
these premises are built to serve.

This chapter owns the program. The engine and shell chapters keep their content;
their **sequencing** now derives from here.

---

## Why this re-cut happened

Three of the plan's open questions turned out to be the same question wearing
different clothes: *what does a thread actually persist, and can we trust what
it says about who did what?* Answering that with a display-grade shortcut would
have bought a demo and cost a rewrite. The owner ruled the other way — build the
kernel first, then the surface.

Two consequences, stated plainly:

- **The engine does not ship on Level B.** The interim receipt machinery that
  existed to survive a non-durable substrate is **descoped**.
- **The storage model is not decided.** It goes to a spike with a competitor
  study, and the engine's data-model slice waits on its findings.

---

## The premises

| # | Premise | Unblocks | Beadable | Size |
|---|---|---|---|---|
| **P1** | Durable streams — Level D conformance, default-on | the whole engine | yes — `wt-391-forward-9p50` (exists) | ~2 sessions |
| **P2** | Thread storage model — spike + competitor study | engine S1, the "noun" question, #1355's ref types | yes — new, brief below | 1 research + 1 spike session |
| **P3** | Seat storage / C7 — audit-grade attribution | honest who-said-what everywhere | yes — new | ~2 sessions |
| **P4** | Kernel View — first ratified slice | Library saved views | yes — new | sizing unknown, see below |
| **P5** | Merge queue | branch health for everything | no — a list, not a bead | ongoing |
| **P6** | Gates re-ruled post-P2 | the engine gate, the shell gate | yes — re-point existing gate beads | minutes of owner time |

---

### P1 — Durable streams (Level D conformance → default-on)

**Ruling.** *Do not build the engine on Level B.* The engine waits for durable
streams.

This is not new work invented by this program — it is **D29's own named
re-evaluation trigger arriving**: durable replay becomes load-bearing once
concurrent multi-agent streams exist (`docs/DECISIONS.md:476`). Level B (bounded
replay + snapshot rehydrate) is the currently shipped bar; Level D is
"specified and deferred" (`docs/DECISIONS.md:472`). The owner has now called the
deferral.

- **WHAT:** unskip and green the Level D restart/ledger/activity conformance
  tests; implement whatever they reveal missing in the `SqliteEventStreamStore`
  path; flip `BORING_CHAT_DURABLE_STREAM` default-on behind a rollout note;
  record the D29 re-evaluation as a dated DECISIONS addendum (owner merge =
  ratification).
- **Scope / Proof:** as already written on `wt-391-forward-9p50` — gateway
  conformance suite green at Level D; restart-replay e2e on the playground
  golden route; DECISIONS addendum PR.
- **Honest sizing:** ~2 sessions, splittable into (implement) and
  (flip + ratify). The bead already says so.
- **Unblocks:** every engine slice. Also reframes the relay-vs-blackboard
  choice — see the note below.

> **Descoped by this ruling.** The engine's interim Level-B receipt machinery —
> the durable `JobRelayReceiptV0` chain built to make relay hops idempotent and
> restart-safe *on a non-durable substrate* — is **descoped pending P1**. On a
> Level D substrate a large part of it is redundant. It is not deleted from the
> plan; it is marked `descoped-pending-P1` so the post-P1 design can decide how
> much survives.

> **Relay-first vs blackboard is now a post-P1 decision.** Both remain live
> candidates. The Buzz / Grok Bot research (recorded in #1399) stands and does
> not need redoing: Buzz = shared durable log with emergent turn-taking and no
> home for caps; Grok Bot = shared-VM implicit context, no loop control,
> fragmented threads. Level D is what makes the blackboard shape *possible*, so
> the choice is made when the substrate is real — not before.

---

### P2 — Thread storage model (spike + competitor study)

**Ruling.** *Not decided.* The old "noun" question — projection descriptor vs
canonical multi-seat Thread — is **withdrawn as a plan-level recommendation**
and replaced by this premise. The engine's data-model slice consumes its
findings.

This is the highest-leverage unknown in the program. It decides the shape of the
engine's storage, what #1355's conversation references can point at, and whether
"1 Thread = 1 job" is a record or a view.

#### Brief — Part A: competitor study

**Research question.** *How do systems that successfully run long-lived,
multi-participant conversations model the relationship between a durable
conversation record and the individual sessions/runs inside it?*

Study each for the same six facts, so the answers are comparable:

1. What is the durable unit — the conversation, the message, or the participant session?
2. Is participation a property of the record, or a separate join?
3. How is per-message authorship attributed, and is it audit-grade or display-grade?
4. What happens to the record when a participant is removed — rewrite, tombstone, or retain?
5. How is "the same conversation" addressed across surfaces (deep link, API, search)?
6. What does archival mean — a flag, a move, or a different store?

**Systems to study:**

| System | Why it is on the list |
|---|---|
| **Slack** | Channel + threaded replies at very large scale; the canonical "channel is the record" model |
| **Discord** | Threads as first-class children of channels; explicit archive semantics |
| **Linear** | Issue-as-record with a comment stream; closest to "1 Thread = 1 job" |
| **Intercom** | Conversation record with *both* human and agent participants and handoffs — the closest analogue to our problem |
| **Notion** | Blocks-as-records; discussion attached to arbitrary subjects |
| **Buzz** | Already researched (#1399): shared durable event log, no central record. The "no record at all" end of the spectrum |

**Output:** a comparison table on those six facts, plus a short verdict naming
which model our constraints most resemble and why.

#### Brief — Part B: technical spike, in our stack

**Question.** *In our codebase, what does each storage model actually cost?*

Two candidates, built far enough to be measured — not to ship:

- **(i) Index-card / projection.** A lightweight record that points at existing
  per-agent sessions and projects them into one timeline. Cheap to add; the
  timeline is derived.
- **(ii) First-class thread record.** The thread owns its own durable message
  stream; per-agent sessions become an implementation detail beneath it.

**Measure, for each:** write path complexity; read/replay cost for a long
thread; behavior under P1's durable streams; how per-message attribution lands
(feeds P3); what a participant change costs; migration cost from today's
per-session records; and what #1355's reference types would have to become.

**Decision criteria — the spike is done when it can answer:**

1. Which model survives a restart with the timeline intact, with least new machinery on top of P1?
2. Which gives audit-grade attribution without a second ledger (P3's constraint)?
3. Which lets a Thread's participants change without rewriting or losing history?
4. Which requires the smaller migration from today's per-session records?
5. Which one can #1355 type its conversation references against *today*, without assuming single-seat?

**Explicitly NOT in scope:** shipping either candidate; the relay/blackboard
choice (that is post-P1); any UI.

**Honest sizing:** one research session (Part A) + one spike session (Part B),
runnable in parallel. Part B should not start before P1's shape is known, since
criterion 1 depends on it.

**Feeds:** the engine gate (P6), engine S1, and #1355's `ConsoleThreadRefV1`
repair.

---

### P3 — Seat storage / C7 (audit-grade attribution)

**Ruling.** *Who-said-what is audit-grade from day one.* Display-only participant
chips are **rejected**.

The engine plan's own §8 already concedes the honest position: `participantId`
values minted in the plugin are *"temporary display handles … not `seatId`, not
envelope identity, and carry no audit weight"*, and ratified P0 puts `seatId` in
C7 (`job-thread-plan.md` §8). The owner has ruled that this gap does not ship.

- **WHAT:** pull the ratified C7 seat-catalog work forward far enough that per-Run
  `seatId` is real envelope identity, and per-message attribution in a multi-seat
  Thread resolves through it rather than through a mutable display record.
  `seatId in C7` is already ratified P0 required
  (`docs/plans/long-term/ratified/RECONCILIATION.md:153`); this premise is
  **sequencing, not new ontology**.
- **Proof:** an attribution that survives a participant being removed; a test
  asserting no attribution path reads a mutable display field; the trajectory
  spine carrying `seatId` end to end.
- **Honest sizing:** ~2 sessions, and genuinely uncertain — this is the premise
  most likely to grow once opened, because it touches the envelope.
- **Unblocks:** honest agent chips in the thread timeline (shell L4), drill-down
  provenance, and any later billing/metering per seat.

---

### P4 — Kernel View (first ratified slice)

**Ruling.** *Library saved views wait for the kernel View system.* v0 Library =
**files + built-in views only.**

This retires shell open-question Q3 (where saved views persist): the answer is
"nowhere yet, and that is fine". It also removes the temptation the shell plan
already guarded against — inventing a lookalike `ViewDescriptor`.

- **WHAT:** the first ratified View slice — the contract *as a set*
  (`ViewDescriptor` + `ViewResolver` + `ViewHost` + `ViewContext` + `ViewRef`,
  `V2-IMPLEMENTATION-SPEC.md:144-149`), sequenced P1 alongside K2
  (`VISION.md:178-179`). Not a shell concern; a kernel one.
- **Proof:** to be defined by that slice's own plan — this premise records the
  dependency, it does not design the View system.
- **Honest sizing:** **unknown.** This is the least-scoped premise. It should get
  its own planning pass before anyone estimates it.
- **Unblocks:** Library saved views (shell L3b's deferred half). Does **not**
  block v0 Library over files and built-in views.

---

### P5 — Merge queue

Not a bead — a list, and a standing health obligation. The pack's slices assume
a branch that is not diverging from a long tail of open work. Notable open PRs
that touch the same surfaces:

- **#1382** objectives plugin — the Thread↔Objective link (ruled optional,
  one-way) lands against it
- **#1393** console left-pane variant — direct ancestor of shell L2a
- **#1376** archive sessions — session-level archive; thread-level is a P2 finding
- **#1343** Inbox projects all durable questions — feeds shell L5
- **#1288** code-factory / durable dispatch loop
- **#1166** env-mounts, **#1145**/**#1164** BYOK — kernel-adjacent, not on this path

**Obligation:** before any premise bead is dispatched, this list gets a pass —
merge what is green, close what is superseded. A premise landing onto a stale
tree is how the last re-cut got expensive.

---

### P6 — Gates re-ruled post-P2

The two owner gates in this pack were written against the *old* sequencing.
Several of their questions are now either answered by the interview rulings or
deferred into P2.

- **WHAT:** after P2 reports, re-rule both gates — the engine gate
  (`wt-391-forward-jfxd.1`, 8 rulings) and the shell gate
  (`wt-391-forward-shell-ngfs.1`, 13 questions) — dropping what P2 answered and
  what the interview already ruled.
- **Proof:** both gate bead bodies updated; both review docs' status strips
  updated; an answered Human Intention per gate.
- **Honest sizing:** minutes of owner time, once P2 has reported.

---

## Rulings folded from the owner interview (2026-08-26)

Recorded verbatim in intent. Answered questions are marked **RULED** in each
chapter's open-questions section.

| Topic | Ruling |
|---|---|
| Thread storage model | **NOT decided.** Goes to P2 (spike + competitor study). The plan-level "noun" recommendation is withdrawn. |
| Who-said-what | **Audit-grade from day one.** C7 seat storage pulled forward (P3). Display-only chips rejected. |
| Thread ↔ Objective | **Optional one-way link.** An Objective is not mandatory for a job. |
| Engine mechanics | **Do not build on Level B.** Engine waits for P1. Interim receipt machinery descoped. Relay-vs-blackboard decided after P1; both candidates live. |
| Posts-only boundary | **Unchanged** (prior ruling). Only settled posts and system markers cross a seat boundary. |
| Context handling | **Unchanged** — truncation-only, no summarization. |
| Acceptance bar | **Unchanged** — fixture-gated acceptance; live model runs are a labelled smoke check. |
| Shell deep links | **Shell owns the serializable location; the HOST owns URL translation.** Confirms the shell plan's §3 recommendation. |
| Nav extensibility | **OPEN — plugins CAN add top-level entries.** *The owner ruled against the closed-IA recommendation.* Crowding risk is noted and **accepted**. |
| Library saved views | **Wait for the kernel View system** (P4). v0 Library = files + built-in views only. |

---

## Sequencing

```
        ┌─────────────────────── run in parallel ───────────────────────┐
        │                                                               │
   P1 durable streams          P2 storage spike           P3 seat/C7 audit
   (9p50, ~2 sessions)         A: competitor study        (~2 sessions)
        │                      B: technical spike ◄── needs P1's shape
        │                           │                          │
        └───────────┬───────────────┘                          │
                    ▼                                          │
              P6 re-rule gates                                 │
                    │                                          │
                    ▼                                          │
        ┌───────────────────────────────┐                      │
        │  ENGINE  (on durable streams) │                      │
        │  storage model per P2         │                      │
        │  relay-vs-blackboard decided  │                      │
        └───────────────┬───────────────┘                      │
                        │                                      │
                        ▼                                      ▼
              shell L4 thread view ◄──────── audit-grade attribution
                        │
                        ▼
              L5 · L3b(files) · L7a/b/c

   P4 kernel View ──────────────────► Library saved views (post-v0)

   P5 merge queue ──── standing obligation across all of the above


   SUBSTRATE-FREE EXCEPTIONS — may run early, in parallel with the premises:
   ┌──────────────────────────────────────────────────────────────────┐
   │  L1     layout traits + internal shell composition               │
   │  L1.5   shell location contract                                  │
   │  L2a    nav chrome + flyouts (chrome only, counts absent)        │
   └──────────────────────────────────────────────────────────────────┘
```

### Why the chrome exceptions are legitimate

L1, L1.5 and L2a-chrome are **substrate-free by construction** — this is not an
exemption granted, it is a property that can be checked:

- **L1** converts a boolean into a traits object and composes existing
  components. It touches no thread, no session, no storage, and no attribution.
  Its negative proof is that the other two layouts render unchanged.
- **L1.5** defines a serializable location type and a reducer. Its content is
  destinations and mount references — it reads no thread record. The deep-link
  ruling (shell owns location, host owns URL) is already given, so it is not
  waiting on a decision either.
- **L2a** ships nav chrome with **counts absent** as a valid state, which is
  exactly the case where no substrate is required. The moment it wants *live*
  Work rows or a real `Archived · N` it becomes L2b — which is a blocker
  inventory, not a bead, precisely because that half is not substrate-free.

Everything else in the shell either renders a thread (L4), renders evidence
under an attention item (L5), or adopts the whole shell into a host (L7) — and
therefore waits.

---

## Honest status of this program

- **P1** is scoped and beaded; it is the only premise that is genuinely ready.
- **P2** is scoped here for the first time; nobody has run it.
- **P3** is ratified in principle and unscoped in practice; it is the one most
  likely to grow.
- **P4** has no sizing at all and needs its own planning pass.
- **P5** is discipline, not work.
- **P6** is cheap but cannot happen early.

The program's real risk is not any single premise — it is that **P2 and P3 are
coupled** (attribution shape depends on storage shape) and could deadlock if run
as two independent spikes that each assume the other's answer. P2's decision
criterion 2 exists specifically to prevent that: the storage spike must report
how attribution lands under each candidate.
