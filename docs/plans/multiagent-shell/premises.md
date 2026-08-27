# Premises — the program the surface waits on

**Owner direction, 2026-08-26.** The multi-agent shell is no longer sequenced as
"plan → build the UI". It is sequenced as **premises first**: a small number of
kernel capabilities that the product surface is built *on top of*, each landed
and proven before the surface that depends on it. The design canvas and the
spike branch are not a proposal to be scheduled — they are **the specification**
these premises are built to serve.

This chapter owns the program's **dependency rationale** — what waits on what,
and why. The engine and shell chapters keep their content; their sequencing
derives from here. The **executable ordering and merge queue** live in
`docs/direction/DIRECTION.md`, which alone answers "when".

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
| **P1** | Durable streams — Level D conformance, default-on | the whole engine | epic `wt-391-forward-9p50`: `.1` conformance, `.2` rollout | state machine — see P1 slice table |
| **P2** | Thread storage model — spike + competitor study | engine S1, the "noun" question, #1355's ref types | epic `shell-ngfs.13`: `.13.1` research, `.13.2` spike | **re-sized 2026-08-27:** research 1–2 sessions, spike 2–3 (three candidates + pi substrate variant + Work-cardinality questions grew it; the old "2 × one-session" claim is withdrawn) |
| **P3** | Seat storage — audit-grade attribution (ratified concept, formerly C7) | honest who-said-what everywhere | epic `shell-ngfs.14`: `.14.1` catalog/envelope, `.14.2` projection | 2 × one-session slices |
| **P4** | Kernel View — first ratified slice | Library saved views | yes — new | sizing unknown, see below |
| **P5** | Merge queue | branch health for everything | no — a list, not a bead | ongoing |
| **P6** | Gates re-ruled post-P2 | the engine gate, the shell gate | yes — re-point existing gate beads | minutes of owner time |

---

### P1 — Durable streams (Level D conformance → default-on)

#### What P1 is

*Do not build the engine on Level B.* The engine waits for durable streams.
This is not new work invented by this program — it is **D29's own named
re-evaluation trigger arriving**: durable replay becomes load-bearing once
concurrent multi-agent streams exist (`docs/DECISIONS.md:476`). Level B
(bounded replay + snapshot rehydrate) is the currently shipped bar; Level D
is "specified and deferred" (`docs/DECISIONS.md:472`). The owner has called
the deferral (ruled 2026-08-26). P1 is the keystone premise: every engine
slice is downstream of it, and it also reframes the relay-vs-blackboard
choice (below).

- **WHAT:** child `.1` unskips and greens the Level D restart/ledger/activity
  conformance tests and implements what they reveal missing in the
  `SqliteEventStreamStore` path. Child `.2` then flips
  `BORING_CHAT_DURABLE_STREAM` default-on behind a rollout note and carries
  the dated D29 re-evaluation addendum (owner merge = ratification).
- **Scope / Proof:** as written on epic `wt-391-forward-9p50` and its
  children — gateway conformance green at Level D; restart-replay e2e on the
  playground golden route; default-on/rollback proof; DECISIONS addendum PR.
- **Unblocks:** every engine slice.

#### The slice state machine

P1's honest sizing is a state machine, not a flat "two one-session slices"
estimate — that earlier claim is withdrawn.

| Slice | State |
|---|---|
| P1-A1 identity + migration contract | Ready |
| P1-A2 private harness backend seam (under D29) | Ready |
| P1-A3 request/effect/attention durability | Ready |
| P1-A4 activity + resume protocol | Ready |
| P1-A5 headless + paused-human proofs | Ready after A2–A4 |
| P1-B event-stream backend | Waiting for qualifying pi release |
| P1-C Level-D completion + default-on + D29 evidence | Waiting for P1-B |

Bead mapping: `wt-391-forward-9p50.1` is P1-A (the substrate-neutral slices,
A1–A5); `wt-391-forward-hotp` is P1-B, its own **blocked-on-pi** bead;
`wt-391-forward-9p50.2` is P1-C. A blocked portion never lives inside an
in-progress bead — P1-B is split out precisely so P1-A's readiness is not
hostage to P1-B's wait, and P1 is not complete before P1-C runs.

#### Scope boundary

Level-D streams are the keystone for restart-safe multi-Agent conversation
and timeline projection. They do not replace the accepted-work protocol:
Work/Run admission, effect identity and reconciliation, Artifact versions,
Delivery, cost, and delayed Outcome linkage remain separate durable
semantics. The engine consumes both layers.

#### Pi rules

Constraints on this premise if the pi-v4 core is adopted for any part of it
(ruled 2026-08-27, from the gap review and sharpened in the post-spike
no-waste split):

1. The harness adapter lives **under** the D29 gateway / `AgentHarnessBackend`
   seam — a private backend of the funnel, never a parallel session path.
   That seam is raised to P1 and lands alongside the substrate-neutral layer.
2. An explicit **crash/reconciliation protocol** between Boring's durable
   gateway ledger and pi's Session store is a named deliverable — two durable
   stores that can disagree after a crash need a defined winner and repair
   sequence.
3. Session identity stays **workspace-scoped** (our addressing, pi ids
   internal).
4. **BYOK and model authority remain Boring-owned** — the D27 credential
   vault and the model-capability issuer stay authoritative over pi's own
   Accounts/Models services, which must consume injected authority, never
   source it.

The post-spike split (owner direction 2026-08-27) turned these constraints
into a concrete build order. Of P1's four conformance concerns, only
**stream-sequence continuity** is substrate-replaceable by pi v2 — the
durable gateway **ledger**, effect **admission**, cross-session **activity**,
and the resume-to-browser protocol are ours on any substrate. So: the
**substrate-neutral layer (P1-A) starts now**, written against the
gateway/seam interfaces; the **event-store schema (P1-B) waits for a
qualifying pi release** — the owner explicitly accepts waiting where it saves
dev time. Adoption is behavior-gated by the criteria in
`research/pi-v2-alignment.md`, never version-gated. **2026-09-10 is an owner
check-in, not an automatic build trigger**: if pi has not shipped a
qualifying runtime by then, the owner decides wait-longer vs build-ours;
nothing starts by default. A release watcher is armed on the pi package
registry.

#### Named proofs

**The paused-human restart.** P1's proof set includes the flagship journey:
a thread paused on an ask-user question, host restarts, the client
reattaches — question, transcript, and pending state intact, answer still
routable. This is the single most user-visible durability promise and must
be a falsifiable e2e, not a unit test.

**The headless journey.** Job in via API/CLI → agent runs → artifact → human
decision → restart survives → delivery. Adopted as a named conformance proof
that runs parallel, not gating: it never blocks substrate-free shell chrome,
but it is **required evidence for P1 completion** — and therefore
indirectly gates every Job Thread or Thread-view slice that consumes P1.

#### Descoped and deferred choices

**Level-B receipt machinery — descoped-pending-P1.** The engine's interim
Level-B receipt machinery — the durable `JobRelayReceiptV0` chain built to
make relay hops idempotent and restart-safe *on a non-durable substrate* —
is descoped pending P1 (ruled 2026-08-26). On a Level D substrate *some* of
it is redundant — but the pi-v2 analysis (2026-08-26,
`research/pi-v2-alignment.md`) corrects an overstatement here: harness-level
durability makes effects idempotent *within one agent's own operation*;
**crash-safe reservation of a turn across sessions has no substrate
equivalent**, so the cross-session half of the receipt design likely
survives. It is not deleted from the plan; it is marked
`descoped-pending-P1`, and the post-P1 design decides how much survives.

**Relay-vs-blackboard — post-P1.** Both remain live candidates (ruled
2026-08-26). The Buzz / Grok Bot research (recorded in #1399) stands and does
not need redoing: Buzz = shared durable log with emergent turn-taking and no
home for caps; Grok Bot = shared-VM implicit context, no loop control,
fragmented threads. Level D is what makes the blackboard shape *possible*, so
the choice is made when the substrate is real — not before. One constraint
on that future choice: a blackboard is a shared-transcript runtime
primitive, and ratified §7 requires **its own explicit promotion gate** for
any such primitive (§8 creates no shared-runtime room) — selecting the
blackboard post-P1 is therefore an owner ruling plus a ratified-plan
amendment, never just an engineering pick. The relay-vs-native-binding
default is stated in the engine chapter: D22's native binding unless a
D22/D28 amendment says otherwise.

*Ruling history: this section consolidates dated rulings of 2026-08-26/27;
the commit history of this file is the audit trail.*

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

**Widened question (full-vision review, 2026-08-27).** Beyond the six facts,
also ask how each system relates the durable customer-value unit to its
conversations: can that unit exist without a conversation at all, and can it
bind more than one?

#### Brief — Part B: technical spike, in our stack

**Question.** *In our codebase, what does each storage model actually cost?*

Two candidates, built far enough to be measured — not to ship. **Substrate
note (pi-v2 analysis, 2026-08-26):** pi v2's shipped v4 harness
(Session/Branch/AgentLane + typed durable values, public since 0.84.0, with
a v3 transcript decoder) is evaluated as a **substrate variant of the
first-class-record candidate** — not a third ontology
(`research/pi-v2-alignment.md`). The candidates:

- **(i) Index-card / projection.** A lightweight record that points at existing
  per-agent sessions and projects them into one timeline. Cheap to add; the
  timeline is derived.
- **(ii) First-class thread record.** The thread owns its own durable message
  stream; per-agent sessions become an implementation detail beneath it.
- **(iii) Work + conversation bindings.** A durable Work/Job record owns the
  job contract, economics, Runs, Artifacts, Deliveries, Decisions, and
  Outcomes. One or more Threads or external conversations bind to it as
  interaction histories. A Job Thread is the default shell projection, but
  headless Work may have no Thread at all.
  **Amendment gate:** if the spike recommends this candidate, "Work" is a
  **new durable kernel root** — adopting it requires an explicit
  ratified-plan amendment and owner ruling (rule 11), never a quiet schema
  choice inside the engine. The spike report must say so on its first page
  if (iii) wins.

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
6. Which candidate supports a bounded headless job without fabricating a chat?
7. Which candidate supports a request that begins in WhatsApp and continues in the web app?
8. Which candidate keeps Work economics and Outcomes stable if a conversation is forked, archived, or deleted under policy?

**Explicitly NOT in scope:** shipping either candidate; the relay/blackboard
choice (that is post-P1); any UI.

**Honest sizing:** two one-session children under epic `shell-ngfs.13`:
`.13.1` research may run in parallel with P1; `.13.2` is the technical spike
and starts after P1a (`9p50.1`) establishes Level D's shape, since criterion 1
depends on it.

**Feeds:** the engine gate (P6), engine S1, and #1355's `ConsoleThreadRefV1`
repair.

**Split (owner ruling, 2026-08-27).**

- **P2-B1 (now): semantic/cardinality prototype.** No production storage.
  Prototype the reference shapes for #1355 against: a headless Work with no
  conversation; one Work bound to WhatsApp + web conversations; a Job Thread
  with one Work; several internal conversations for one customer job; a
  stable Delivery/Outcome after conversation archive.
- **P2-B2 (later): durability/performance/migration benchmark.** After a pi
  or Boring event backend exists: replay cost, restart behavior, migration
  from existing sessions, participant changes, long-thread read cost, and
  the actual storage schema.

Business semantics move now; no throwaway event-store work.

---

### P3 — Seat storage: audit-grade attribution (the ratified seat-catalog concept, formerly C7)

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
- **Honest sizing:** two one-session children under epic `shell-ngfs.14`:
  `.14.1` host catalog/envelope identity, then `.14.2` message/trajectory
  projection. It remains the premise most likely to grow once opened; if either
  child proves too large twice, split it rather than retrying.
- **Unblocks:** honest agent chips in the thread timeline (shell L4), drill-down
  provenance, and any later billing/metering per seat.

> **Actor vs Seat.** Seat attribution is the Agent-specific part of the causal
> record. The wider envelope must retain the acting Actor and represented
> Party for human, automation, service, and external-client actions. A Seat
> is mandatory when an Agent acts through a binding; it is not a replacement
> for universal Actor identity — humans, automations, and MCP clients are
> never forced into Seats.

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

> **Pressure-tests for the planning pass.** The View contract must be shaped
> against at least: (1) a route-first vertical page, (2) a Meridian
> workbench mount, (3) an Artifact deep link from headless Work, (4) a
> schema-validated agent-proposed Experience change — not only Library
> persistence. The first slice may stay small, but the contract may not
> encode Dockview, Library, or the multi-agent shell as universal ownership
> assumptions.

---

### P5 — Merge queue

Not a bead — a standing health obligation. The pack's slices assume a branch
that is not diverging from a long tail of open work. **The queue itself lives
in `docs/direction/DIRECTION.md`** (the single executable merge queue); this
premise does not maintain a second copy.

**Obligation:** before any premise bead is dispatched, that queue gets a pass —
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
- **Gate ORDER (APR ruling-order fix, 2026-08-26).** The two gates must not
  fire independently — the shell gate's storage-consequence questions consume
  the engine ruling. Sequence: (1) a short **pre-gate synthesis** folds the
  durable-streams evidence and both storage-spike outputs into updated gate
  artifacts; (2) the owner rules the **engine** questions in this order:
  storage model → native-binding default vs an explicit relay amendment (a
  blackboard needs its own promotion gate) → the orchestrator Seat's concrete
  binding/voice → the typed `input-required` shape → which interim receipt
  machinery survives; (3) only then the **shell-only** questions and the
  shell's storage consequences. Never re-ask what is ruled: an orchestrator
  Seat *exists* (ratified — only its concrete binding is open), a voiceless
  v0 would be an explicit amendment not a peer option, L1.5's location
  question, shell Q1–Q3, and the D29 policy addendum are all already ruled.
- **Proof:** both gate bead bodies updated; both review docs' status strips
  updated; an answered Human Intention per gate, in the order above.
- **Honest sizing:** minutes of owner time, once P2 has reported — plus one
  session for the pre-gate synthesis.

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

- **P1** is scoped into two one-session children; P1a is genuinely ready.
- **P2** is scoped into research and technical-spike children; nobody has run them.
- **P3** is ratified and now split into catalog/envelope and provenance-projection
  children; its implementation uncertainty remains high.
- **P4** has no sizing at all and needs its own planning pass.
- **P5** is discipline, not work.
- **P6** is cheap but cannot happen early.

The program's real risk is not any single premise — it is that **P2 and P3 are
coupled** (attribution shape depends on storage shape) and could deadlock if run
as two independent spikes that each assume the other's answer. P2's decision
criterion 2 exists specifically to prevent that: the storage spike must report
how attribution lands under each candidate.
