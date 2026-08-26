# Boring — Unified Product & Architecture Vision

2026-08-16. Merges three ratified documents into one:
1. **ARCHITECTURE-PLAN v3** (engineering: security, durability, ordering — converged, frozen)
2. **Agent-Native Product Direction** (product ladder, seats, views, creator distribution — ratified via RECONCILIATION §6)
3. **Boring V2 — Sovereign Recursive Optimization Platform** (the optimization kernel, business thesis — this document absorbs it)

## 0. North star

> Build the smallest sovereign engine that repeatedly turns private data,
> explicit objectives, agent exploration, and real human/world feedback into
> **measurably better outcomes** — a recursive empirical reasoning engine.
> Every visible app (CRM, macro terminal, creator studio, chat) is a View over
> that engine. Every commercial motion (standalone agents, creator products,
> agent teams, the European cloud) is a distribution layer over it.

The loop: objective → agent explores governed world → candidate → evaluation →
outcome → evidence → better candidates, better agents, reusable vertical
intelligence. Optimization is the commercial word; hypothesis/evidence is the
architecture.

## 1. The decisive discovery: the three documents describe ONE system

The V2 kernel's 12 nouns map almost entirely onto machinery that is built,
scheduled, or ratified. This table is the vision's spine — it is why no rewrite
is needed:

| V2 kernel noun | existing / ratified mechanism | status |
| --- | --- | --- |
| **Agent** (`agentId` + `definitionDigest`) | ratified AgentRef (RECONCILIATION Q — `agentId=agentTypeId` initially, `definition.digest` exists) | ratified, opportunistic P0 |
| **Run** ("runId minted before accepted execution, stable across metering/artifacts/evals/outcomes") | **ratified verbatim: `RunId := RequestKey`**, minted at envelope admission (C6/D-c) | ratified; C6 scheduled |
| **Workspace** (durable governed world) | workspace = composition + view + trusted plugin host (B7) | ratified |
| **Thread** (resumable work, not chat) | **= Session** under A2a (per-session record shard). One noun, two names — Thread is the product name, Session the runtime name; do not create two objects | naming ruling below |
| **Mount** (governed namespace) | multi-FS bindings (boring-bash), #1123 mount sets, environment leases — Mount is their semantic promotion | seam exists; extraction when pulled |
| **Authority** (host-issued, non-forgeable, only narrows) | R1 + `AuthorizedAgentScope` + A7 issuer + A8 revocation + effective-capability ∩ rule | ratified; A7/A8 scheduled |
| **Capability** (define once, project to surfaces, `effect` classified) | R1 authority/mechanism + the agent-native harvest; effect classes map to our admission model (`observe/propose` free; `mutate/external-effect` need authority — and `external-effect` is exactly where C6's `unknown-outcome` lives) | adopt; D-2/D31 text |
| **Objective / Candidate / Evaluation / Outcome** | **genuinely NEW** — the optimization records. Sit ON TOP of the envelope: every Candidate carries `producedByRunId`; the ratified trajectory dataset (runId·agentId·digest·seatId·cost·outcome) is exactly this join | new; small durable tables, JSON payloads |
| **View** (semantic, renderer-independent) | reconciliation P1 ViewDescriptor; Dockview demoted to renderer | ratified P1 |
| **ExecutionContext** (provenance: who/authority/run/thread/surface/approval) | envelope key + scope + C5 approvalRef — one struct threading what already exists | adopt |
| **Approval** (evidence + authority; agents cannot manufacture it) | C5 durable pause (ratified spec: request-ID keyed, channel-answerable) + approvalRef in context | scheduled C5 |

And the V2 doc's own operating principles are our frozen doctrine restated:
"rewrite semantics, preserve machinery" = promote seams, don't rebuild;
"dry-run before persistence" + "challenger vs incumbent" + "last-known-good" =
refutation-first + promotion gates + stale-good (all in plan v3 / Sol harvest);
"authority only narrows" = R1; "kill criteria" = our refutation sections.
**Three independent long threads converged on one architecture. That is the
strongest evidence we have that it is the right one.**

## 2. The three layers of the one system

```
SURFACES & BUSINESS   creator products · agent teams · vertical apps · cloud ladder
                      chat / inline / full-app / automation — all Views + Capabilities
────────────────────────────────────────────────────────────────────────────
OPTIMIZATION KERNEL   Objective → Candidate → Evaluation → Outcome → Evidence
(the new layer)       recursive challenger loop · reusable improvements · benchmarks
────────────────────────────────────────────────────────────────────────────
EXECUTION ENGINE      Agent · Run(=RequestKey) · Session/Thread · Seat · Mount
(built/scheduled)     Authority(A7/A8) · Capability · record/envelope (R2)
                      recovery-at-checkpoints (R3) · accepted-work (C6) · C5 approvals
```

The engine is plan v3. The kernel is the new work. The surfaces are the product
doc. **The kernel needs nothing from the engine that isn't already scheduled** —
which is why the V2 roadmap collapses (§5).

## 3. Rulings (conflicts between the three documents)

**R-a. RULED BY OWNER (2026-08-16): new repo, interface-first, port the
mechanisms.** `boring-v2` starts with the kernel only — 12 noun interfaces,
invariants, forbidden-dependency lint, conformance tests — and proven machinery
is **ported in through those interfaces**, never copied around them. This is a
strangler, not a fork: the old repo is a quarry and a running business, not a
parallel architecture. Rationale accepted: this monorepo is a high-traffic
factory; a kernel package here must win a CI fight on every merge, while a
kernel repo makes the discipline structural.

**Port protocol (keeps the strangler honest):**
1. **Interfaces before mechanisms, always.** Nothing lands in v2 without a
   kernel interface it implements; a port PR = interface + ported code +
   ported tests + conformance suite green. The V2-01..06 order is the port
   order (sandbox/bash/gateway first).
2. **One direction.** v2 never imports the old repo; the old repo never
   imports v2 (until v2 publishes packages the old product may consume).
   Copy code in, with provenance headers (`ported-from: boring-ui@<sha>`);
   no submodules, no shared workspace.
3. **The old repo keeps shipping.** Constellation, GTM, and the factory stay
   on it. **Security P0 lands in the OLD repo regardless** — P0.6 (RCE
   default-deny), A7 (BYOK bypass), P0.2 (CLI bind guard) protect paying
   users today and are not deferred to the port. AR1-003/004 + result→runId
   also land old-side: they're product P0 and their semantics port cleanly.
4. **Ratified architecture is the port spec.** R1-R3, record/envelope,
   per-session shard, C6 protocol, A7/A8, Seat/C7, RunId:=RequestKey are
   frozen inputs to the v2 interfaces — the port implements the plan, it does
   not reopen it. The v2 kernel's ARCHITECTURE.md = VISION §4 invariants.
5. **Red list enforcement is free now:** legacy panel ontology, composition
   roots, duplicate boot paths simply never cross. Track B is dissolved —
   its goal (workspace = composition + view) is achieved by what the port
   refuses to carry, not by moving files in the old repo.
6. **Cutover by product, not by flag day:** the first thing served from v2 is
   the Bare Agent (A3 `npx @hachej/boring-agent`), then the first vertical
   (K7). The old repo retires surface by surface only after its replacement
   is proven with real users (invariant 14 of the product doc).

**R-b. Seat: V2 defers it; ratification put seatId in P0 required.** Ratification
stands — the V2 doc was written without knowledge of C7 (the host session
catalog), which *is* the seat ledger. Deferring Seat would leave C7's rows
unnamed and force a later migration. Seat type = leaf; lifecycle = workspace
(ratified Q4).

**R-c. Thread vs Session.** One object. `Thread` is the product/kernel name;
Session is the runtime implementation it recasts (A2a per-session record = the
thread's record). The V2 doc's warning stands: a Thread is not a Pi session,
transcript, or tab — it *owns* one record and many Runs.

> **Amendment — 2026-08-24 (owner ruling, tracked in #1399; full text in
> RECONCILIATION.md §7):** a Thread may span multiple Seats, projected as one
> timeline; one Thread per job. Mechanism = per-Run `seatId` on the existing
> trajectory spine (Q3), no new machinery. Named **multi-seat Thread / Job
> Thread**, never "channel" (channel stays reserved for transport/ingress —
> C5, Track C, Slack/CLI). Does not activate A2A loopback or a shared-runtime
> room: v0 is projection-based, an orchestrator Seat relaying between
> per-agent sessions as a client of each; agents never call agents.

**R-d. "RuntimeFilesystem" rename** (V2 §17): correct and cheap — the agent
package's internal `Workspace` type is filesystem/execution state and collides
with the product noun. Do at A1 (types extraction) where the rename is free.

**R-e. Deferred nouns — merged single list:** Experiment, AgentState, Product,
Process, Schema, Module-runtime, DataSource, MountSlot, marketplace, A2A-remote.
Each has a named promotion trigger (Rule of Three / second runtime mode / two
real verticals). AgentState and Product were already reserved; the V2 doc
agrees.

## 4. Invariants (normative; merges V2 §31, product doc §31, plan rules)

The five backbone invariants (ratified) come first; the rest derive:

1. **Agents exist independently of workspaces; workspaces bind them through Seats.**
2. **The Agent owns its session record; the Host owns accepted-work authority/envelope.** RunId := RequestKey, minted by the admitting authority before execution, stable across metering, artifacts, evaluations, outcomes.
3. **Effective capability = Agent-declared ∩ Workspace-granted** (∩ thread/run restriction; authority only narrows).
4. **Agents reason over semantic resources, views, artifacts — never renderer concepts.**
5. **A Seat grants participation, not identity** — a workspace constrains an agent but never mutates what agent it is.

Derived (kernel additions): 6. Capabilities are defined once and projected to
authorized surfaces, with a declared effect class; `mutate`/`external-effect`
require authority, `external-effect` settles through accepted-work.
7. Approval is authority *and* evidence; agents cannot manufacture it.
8. **Evaluation (what we thought) and Outcome (what happened) are distinct.**
9. Recovery is replay to safe checkpoints; unresolved effects are
`unknown-outcome`; last-known-good beats unvalidated replacement.
10. Recursive improvement is challenger-based, dry-run, independently
benchmarked, and gated — never self-graded, never live self-rewriting.
11. Reusable improvements promote only on evidence (user → workspace →
vertical → platform).
12. Kernel nouns must survive materially different verticals; vertical concepts
stay outside the kernel; every platform investment is pulled by a real
experiment or customer.
13. Sovereignty: Boring owns memory, context, optimization history, policy,
evaluation, recursive intelligence; model providers are replaceable compute.
14. Docs never precede the implementations they describe.

## 5. Unified roadmap (V2's 14 steps collapsed into the frozen DAG + new work)

**Already scheduled or done → V2-00..06 mostly disappear:**
- V2-01 runtime port → *is* `packages/agent` (verified leaf; A3 productizes it)
- V2-02 Run+Authority → C6 + A7 + A8 (scheduled, P0-adjacent)
- V2-03 Mount → multi-FS promotion, pulled when SemanticDataMount lands
- V2-05 Workspace / V2-06 Thread → B7 ruling + A2a (Thread naming per R-c)
- V2-00 invariants → §4 above becomes `ARCHITECTURE.md` at D-2

**Frozen P0 (unchanged by this merge):**
AR1-003/004 · result → runId + artifacts[] · P0.1–0.6 (RCE first) · P-1 · A7 · A0 · seatId in C7. Opportunistic: AgentRef, lint, digest propagation.

**The genuinely NEW track — K (kernel), after P0:**
- **K1** `packages/kernel`: 12 noun types + invariants doc + forbidden-dependency lint (R-a)
- **K2** Optimization records: Objective/Candidate/Evaluation/Outcome stores (JSON payloads; Candidate.producedByRunId joins the envelope)
- **K3** ExecutionContext threading (envelope key + authority + approvalRef through capability execution); effect classification on existing tools
- **K4** BSL/Data-Bridge promotion to authority-aware semantic query infrastructure (same path feeds Agent, View, Evaluator; no rewrite; raw SQL privileged)
- **K5** Optimization benchmark (deterministic ground truth: supplier allocation / constrained recipe / portfolio toy) — baselines: heuristic, one-shot, agent+tools, agent+data, agent+outcomes, recursive
- **K6** First recursive challenger loop (instructions/tool-selection/model-routing only; sandbox → benchmark → promote-if-independently-better)
- **K7** First paid vertical (creator growth — shortest feedback loop), as an experiment composition, concierge OK
- **K8** Second structurally different vertical (macro / formulation / SME GTM)
- **K9** Only then: extract Product packaging

P1 (from reconciliation) interleaves: ViewDescriptor + artifact UX land with K2
(candidates need Views to be inspected/approved).

## 6. Research program & kill criteria (adopted verbatim from V2)

H1 useful candidates · H2 evaluators discriminate · H3 feedback improves
generations · H4 improvements reuse without collapse · H5 one vertical pays.
Scorecard: solution quality, learning efficiency, economic efficiency, human
burden. Kill: recursion ≤ baseline; feedback can't become evaluation; users
won't pay; abstractions need per-domain exceptions; human burden stays high.
**MVP metric: second-cycle completion rate** — a user who completes the loop
twice, with cycle 2 measurably better.

## 7. GTM (adopted)

Two engines: commercial (sell current Boring on one concrete outcome, 5 design
partners, concierge, charge early) feeding platform (kernel + research).
Solo allocation ~50-60/30-40/10. Creator distribution flywheel deferred until
the loop is proven; internal commercial-discovery workspace (L0→L4 autonomy
ladder) is itself vertical candidate #3. Never sell the platform vision — sell
the measured outcome.

## 8. Non-goals (merged; unchanged from the three docs)

No marketplace, revenue-share, custom domains, universal app generator, remote
A2A, cloud scheduler, K8s abstraction, multi-region, arbitrary persistent
processes, universal schema builder, destructive autonomous mutation,
autonomous trading/ad-budgets, self-modifying production repo, Product DSL,
BSL rewrite, universal Mount, cross-tenant recursive learning, big package
reorg **in the old repo** (dissolved into the port — see R-a), arbitrary
untrusted hosted plugin execution (P0.6).

## 9. One diagram

```
                HUMAN ── goals · taste · approvals · corrections
                  │                                   ▲
                VIEW (semantic; renderer-independent) │ deep links
                  │                                   │
   WORKSPACE ── Seats ── AGENTS      MOUNTS ── governed data/world
        │                   │           │
        └── THREAD ─────────┼───────────┘
                            │
                 AUTHORITY (host-issued, narrows)
                            │
                 CAPABILITY (once; effect-classed; all surfaces)
                            │
                     RUN = RequestKey  ←── envelope (host)
                            │              record (agent, per session)
                       CANDIDATE
                            │
                       EVALUATION (what we thought)
                            │
                        OUTCOME (what happened)
                            │
                        EVIDENCE ──► recursive challenger loop
                            ↻        (dry-run · benchmark · gated promotion)
```

## 10. Owner confirmations requested

1. ~~R-a~~ RULED: new repo, interface-first, port mechanisms (protocol above).
2. Track K sequencing after P0 as in §5 — confirm.
3. Creator growth as first vertical (K7) — confirm or substitute.
