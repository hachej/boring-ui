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
| **P2** | Thread storage **shape** — first-class stream vs projection (value-root RULED, §9a) | engine S1, #1355's ref types | epic `shell-ngfs.13`: `.13.1` research **DONE**, `.13.2` shape spike | shape spike 1–2 sessions after P1-A |
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
| P1-B event-stream backend (Boring schema; pi gate REMOVED, §9c) | Ready after A2 |
| P1-C Level-D completion + default-on + D29 evidence | After P1-B and A5 |

Bead mapping (split 2026-08-27, one bead per slice): `9p50.1` = A1,
`9p50.3` = A2, `9p50.4` = A3, `9p50.5` = A4, `9p50.6` = A5 (deps A2–A4),
`9p50.7` = P1-B (dep A2), `9p50.2` = P1-C (deps P1-B, A5). All under epic
`wt-391-forward-9p50`. P1 is not complete before P1-C runs.

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
and the resume-to-browser protocol are ours on any substrate. **The pi wait
gate is REMOVED** (second grill, 2026-08-27 — RECONCILIATION §9c): P1-A
starts now against the gateway/seam interfaces, and **P1-B builds Boring's
own event backend** behind the `AgentHarnessBackend` seam once A2 lands. No
calendar check-in, no wait-for-release. The `research/pi-v2-alignment.md`
criteria survive only as the bar a future pi release must clear — behavior
plus migration cost against a then-working backend — to replace it.

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

**Ruling (updated 2026-08-27, second grill).** The premise is now **half
ruled, half spiked**:

- **RULED — the value root** (RECONCILIATION §9a): a **Thread is the durable
  job root**; a **Session is one runtime conversation**; one Thread binds
  **0..n Sessions** (headless = zero; channel-spanning or re-opened jobs =
  several). The old three-candidate framing conflated this question with
  storage; the requirements already ratified (headless Work, one job across
  WhatsApp + web, economics surviving conversation archive) excluded the
  Thread-as-conversation-root candidates, so this half was decided by ruling —
  a spike over pre-excluded candidates is ceremony. Candidate (iii) below is
  adopted **at the ontology level with Thread as the root noun** — no new
  "Work" kernel noun.
- **SPIKED — the storage shape** (child `.13.2`): is the Thread's timeline a
  **first-class durable stream** or a **projection over its Sessions'
  records**? That is the remaining highest-leverage unknown; the engine's
  data-model slice consumes its findings, and #1355's conversation references
  type against the ruled ontology plus this shape answer.

#### Part A: competitor study — DONE (2026-08-27)

Delivered: [`research/thread-storage-competitor-study.md`](research/thread-storage-competitor-study.md)
(bead `shell-ngfs.13.1`, CLOSED) — a 7×7 primary-sourced comparison
(Slack, Discord, Linear, Intercom, Notion, Buzz, pi v2) over the six canonical
facts plus the widened value-unit question. Headline findings consumed by the
ruling above: **Linear and Intercom are existence proofs for the
work-record-root model**; Buzz has the strongest authorship story; pi v2 is a
pure conversation substrate with no value-root. No storage shape was chosen —
that is Part B's job.

#### Part B: the shape spike, in our stack (rescoped 2026-08-27)

**Question.** *Given the ruled ontology (Thread = job root, 0..n Sessions),
what does each storage **shape** for the Thread timeline actually cost in our
codebase?* Two shapes, built far enough to be measured — not to ship:

- **(i) Projection.** The Thread record is lightweight; the timeline is
  derived by projecting its bound Sessions' records into one view. Cheap to
  add; replay cost and cross-Session ordering are the risks.
- **(ii) First-class stream.** The Thread owns its own durable timeline
  stream; Session records feed it and become an implementation detail
  beneath it. Stronger ordering and attribution locality; migration and
  write-path complexity are the risks.

**Substrate note** (pi-v2 analysis, 2026-08-26): a pi-backed store, if ever
adopted past the §9c bar, is a substrate variant of shape (ii) — not a third
shape. The former candidate (iii) is no longer a spike candidate: its
ontology half was **adopted by ruling** (§9a, Thread as root — the rule-11
amendment it required has been made), and its storage half is exactly the
(i)-vs-(ii) question this spike answers.

**Measure, for each shape:** write-path complexity; read/replay cost for a
long Thread; behavior under P1's durable streams; how per-message attribution
lands (feeds P3); what a participant change costs; migration cost from
today's per-session records; what #1355's reference types become.

**Decision criteria — the spike is done when it can answer:**

1. Which shape survives a restart with the timeline intact, with least new machinery on top of P1?
2. Which gives audit-grade attribution without a second ledger (P3's constraint)?
3. Which lets a Thread's participants change without rewriting or losing history?
4. Which requires the smaller migration from today's per-session records?
5. Which can #1355 type its conversation references against *today*, without assuming single-seat?

(The former criteria 6–8 — headless jobs, channel-spanning jobs, economics
surviving archive — are no longer spike criteria: the §9a ruling settles them
at the ontology level, and both shapes must satisfy them as **conformance
requirements**, checked in the spike report, not used to pick a winner.)

**Explicitly NOT in scope:** shipping either shape; the relay/blackboard
choice (post-P1); any UI.

**Sizing and order:** one child, `shell-ngfs.13.2` (retitled to the shape
spike), 1–2 sessions, starting after P1-A establishes Level D's shape (its
criterion 1 depends on it). A first sub-step may run earlier: prototype
#1355's reference shapes against the ruled ontology (a Thread with zero /
one / several Sessions; a stable Delivery/Outcome after Session archive) —
no production storage.

**Feeds:** the engine gate (P6), engine S1, and #1355's `ConsoleThreadRefV1`
repair.

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

## Rulings folded from the second owner grill (2026-08-27)

Full ontology text in `docs/plans/long-term/ratified/RECONCILIATION.md` §9;
sequencing consequences in `docs/direction/DIRECTION.md` (amendment
2026-08-27 evening).

| Topic | Ruling |
|---|---|
| Thread/Session | **R-c amended (§9a):** Thread = durable job root, one per job; Session = one runtime conversation; 1 Thread : 0..n Sessions. Channel stays transport. |
| P2 value root | **Ruled, not spiked** — Thread is the root (former candidate iii at ontology level, no new noun). Only the storage **shape** goes to `.13.2`. |
| Transcript authorship | **Multi-author (§9b):** one composer, several named agents visibly authoring posts; "one voice / workers hidden" retired; the orchestrator holds its own Seat. |
| Pi gate | **Removed (§9c):** P1-B builds the Boring event backend behind the seam; no calendar check-in. |
| P1-A granularity | **Five beads** (`9p50.1/.3/.4/.5/.6`) plus P1-B (`9p50.7`) and P1-C (`9p50.2`). |
| Relay engine plan | **Demoted to historical candidate** under `research/candidates/`; new engine plan written post-shape-spike from §9's rulings. |

---

## Sequencing

```
        ┌─────────────────────── run in parallel ───────────────────────┐
        │                                                               │
   P1 durable streams          P2 storage shape           P3 seat/C7 audit
   (9p50: A1–A5 → B → C)       A: study DONE              (~2 sessions)
        │                      B: shape spike ◄── needs P1-A's shape
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

## Honest status of this program (refreshed 2026-08-27, second grill)

- **P1** is a state machine, one bead per slice: A1–A5 ready (A5 after
  A2–A4), P1-B ready after A2 (pi gate removed), P1-C last. Nothing has run.
- **P2** research half is **DONE** (`research/thread-storage-competitor-study.md`);
  the value root is **ruled** (§9a); the shape spike (`.13.2`) has not run
  and waits on P1-A.
- **P3** is ratified and split into catalog/envelope and provenance-projection
  children; its implementation uncertainty remains high.
- **P4** has no sizing at all and needs its own planning pass.
- **P5** is discipline, not work.
- **P6** is cheap but cannot happen early.

The program's real risk is not any single premise — it is that **P2 and P3 are
coupled** (attribution shape depends on storage shape) and could deadlock if run
as two independent spikes that each assume the other's answer. P2's decision
criterion 2 exists specifically to prevent that: the storage spike must report
how attribution lands under each candidate.
