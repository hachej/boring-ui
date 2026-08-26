# Reconciliation — Product Direction doc × ARCHITECTURE-PLAN v3

2026-08-16. Inputs: the agent-native product direction document (other session)
and the converged ARCHITECTURE-PLAN v3 (this session, 3 adversarial passes).
Verdict up front: **deeply compatible — same migration philosophy, different
altitudes.** Four real conflicts, each ruled or flagged below. Neither document
supersedes the other; this file binds them.

## 1. Where they independently agree (strong signal — different methods, same conclusions)

| principle | product doc | plan v3 |
| --- | --- | --- |
| Promote existing seams; never build parallel abstractions | §28, §33 | R-33-09, §6 "no second composers", seam census |
| Extend the delegate result, don't replace it | §16 | (same artifact, via #1226 aftermath) |
| Dispatcher = workspace projection over AgentGateway, not the universal API | §8 | D29 + C3 |
| Don't build cloud / remote A2A / marketplace first | §21, §38 | §6 "no integrating celld", C4 last |
| No arbitrary untrusted hosted plugin execution | §38 | P0.6 + the RCE finding |
| Old APIs valid until replacements proven in real products | §29 | A2c dual-read/dual-write, B shims |
| Agents exist independently of workspaces | §31.1 | Track A: agent = standalone framework |
| Content-addressed definition identity | §5 (`definition.digest`) | frozen-prompt/config-revision records (R3) |
| Rule of Three | §30 | refutation-first spikes — same immune system |

**The deepest convergence:** the product doc's §16 invariant — *"runId is
created before execution/admission and remains stable across metering, delivery,
artifacts, evals and outcome tracking"* — **is** plan v3's C6 accepted-work
protocol (admission-first, exactly-once terminal, envelope as the join spine).
Two sessions, two vocabularies, one design: **runId ≈ the envelope requestKey.**
The trajectory record in §26 (runId, agentId, definitionDigest, seatId, cost,
outcome) is exactly what R2's envelope + R3's record events produce. The
self-improvement loop is a *consumer of the durability architecture* — it needs
no new machinery, only that A2a/C6 land.

Likewise §15: "share entries are already the resource seam — finish AR1 before
inventing ResourceRef" is R-33-09 applied to resources. And §17's metering:
`AgentMeteringSink` reserve/record/settle/release maps 1:1 onto envelope
lifecycle — D-6 (telemetry-reads-envelope-only) gives usage settlement its
privacy boundary for free.

## 2. What each adds that the other lacks

**Product doc adds (adopt into the plan):**
- **AgentRef** (`{agentId, definitionDigest}`, initially `agentId = agentTypeId`) and **Seat** (`seatId` binding agent↔workspace with role/budget/permissions). Plan v3 has no durable agent identity across workspaces — C7's catalog rows *are* seats without knowing it. Adopt: **C7 stores Seats; the catalog is the seat ledger.** New metering/policy/budget keys on seatId, per the doc.
- **View/Artifact semantics** (ViewDescriptor; agent reasons in collection/detail/kanban, never Dockview) — nothing in v3 covers the presentation layer. Adopt as P1, adapter-first per §29.
- **The commercial loop** (§22-26): signals, trajectories, evals. Adopt as P2/P3 consumers of the envelope.
- **Product** as packaging (§4) and the creator funnel (§20).

**Plan v3 adds (the product doc must not proceed without):**
- **The verified security ground truth**: F-33-G15 BYOK bypass (verified — A7 gates any creator/metering offer: you cannot bill per-result while the payer path is bypassable); the live plugin RCE (P0.6 — non-negotiable before any creator distribution); revocation epochs (A8); env inheritance (A4).
- **The durability rules with proven boundaries** (R2/R3, per-session shard, safe checkpoints, `unknown-outcome`) — §26's trajectory store is unreliable without them.
- **The commit protocol** (C6/D-c) that makes runId's invariant actually hold under crash.
- **The adversarial provenance discipline** (executed/verified/reported/ratified/inferred).

## 3. The four conflicts, ruled

**C-i. "No package moves" (§38) vs Track B (~28k LOC).**
RULING: the product doc wins on sequencing, the plan wins on the exceptions.
Track B is **demoted from a track to a ratchet**: B6's CI rule (workspace
imports nothing new outside composition/view/SDK) lands now; physical moves
(B1/B3/B4/B5) wait for the Rule of Three or a security need. **Exceptions that
stay scheduled regardless:** P0.6 (RCE), B7 decision (already made: workspace
hosts trusted plugins — which *supports* the doc's "standalone = degenerate
workspace"), and A1 types extraction (cheap, verified clean, enables the CI
leaf rule). This also discharges plan-risk: B was v3's least-grounded track.

**C-ii. Standalone shape: "degenerate single-agent workspace" (§2) vs "agent
package complete alone" (v3 §1, A3).**
RULING: both, as a ladder — and this needs owner confirmation.
*Bare agent product* (chat + tools + record, `npx @hachej/boring-agent`, A3) =
the agent package alone — the Flue-equivalent entry point, no workspace shell.
*Agent app with views/modules* = degenerate single-agent workspace (the doc's
Level 2), because B7 already ruled that hosting plugins is composition.
The doc's own "it can later grow naturally" is the same ladder. FLAG: if you
want only ONE standalone shape, the degenerate-workspace form wins (avoids two
architectures) and A3 becomes "workspace shell with one seat, agent-package
front" — say which.

**C-iii. P0 contents: product slices (AR1, result, metering, seatId, AgentRef)
vs security/durability (register, RCE, A7, A8, A2a).**
RULING: merge — they're orthogonal in files touched, and three product-P0 items
*depend* on plan items: metering unfreeze needs A7 (payer integrity) and D-6;
runId needs C6's admission semantics (even a v0 runId should be minted where
admission already happens, so it never migrates); seatId lands in C7's catalog.
Merged P0 = **AR1-003/004 · result extension (runId + ShareEntryId[]) · seatId
+ AgentRef wrappers (lint-first) · P0.1-0.6 · P-1 · A7 · A0.** Everything else
keeps v3's DAG order.

**C-iv. "Agent state beyond definition+session" (§32) vs R2/R3's record model.**
Not really a conflict — a naming gap. The doc's AgentDefinition / AgentState /
WorkspaceBindingState / SessionState maps onto v3 as: definition (frozen,
digest) / **new: durable cross-workspace agent state — unmodeled in both docs**
/ Seat (C7) / per-session record (A2a). The genuinely new object is AgentState;
per the doc's own rule, defer until a product needs cross-workspace memory,
but reserve the name so session records don't absorb it silently.

## 4. Merged invariants (doc §31 × plan rules — the single list for D-2/D31)

1. Agents exist independently of workspaces; workspaces bind them through Seats. (doc 1-2)
2. Definitions are content-addressed; model-visible composition is frozen per session, changes are append-only signals. (doc 3 + R3)
3. The agent owns per-session records; the host owns the envelope; runId/requestKey is minted at admission and joins usage, artifacts, evals, outcomes. (R2 + doc 12)
4. Recovery is replay to safe checkpoints; unresolved effects are `unknown-outcome`. (R3)
5. Authority — including disclosure authority — is singular, host-owned, handed in; mechanisms are pluggable at composition time; the untrusted tier admits authored capability only via isolation + promotion. (R1)
6. Effective capability = agent-declared ∩ workspace-granted. (doc 9)
7. Agents reason over semantic resources/views/artifacts, never renderer concepts; plugins are packaging, modules are semantics. (doc 4-6, 10-13)
8. Promote existing seams; a seam ships owner+impl+consumer; old APIs live until replacements are proven; Rule of Three gates promotion. (doc 9-10, R-33-09, doc §30)
9. Products configure workspaces; the cloud is extracted from repeated demand. (doc 8 + v3 §6)
10. Docs never precede the implementations they describe. (v3 §6, the G16 lesson)

## 5. Open to the owner

1. C-ii: two standalone shapes (ladder) or one (degenerate workspace only)?
2. Confirm Track B demotion to ratchet+exceptions (C-i).
3. runId minting point: adopt "envelope requestKey = runId" (recommended — one
   spine, zero migration) or a separate runId joined to it?
4. B2 split line (carried from v3).

---

## 6. OWNER RULINGS — 2026-08-16 (ratified; architecture discussion FROZEN)

**Q1 — Two standalone shapes, as a progressive ladder.** Bare Agent =
`@hachej/boring-agent` (chat + tools + sessions/record, no workspace
dependency). Agent App = the same Agent bound as primary Seat of a single-agent
Workspace. **A3 is NOT redefined as a workspace internally** — the independently
complete agent package is strategic (developer entry point, future agent
network). Invariant: **upgrading is additive, never migratory**
(Bare Agent → +Workspace → Agent App → +Seats → Agent Team/Product).

**Q2 — Track B demotion CONFIRMED.** Ratchet, not migration: CI dependency rule
now; A1 if genuinely cheap/clean; B7 decision retained; **P0.6 non-negotiable**.
Physical moves only when pulled by a security boundary, Rule of Three, or a
concrete product slice.

**Q3 — `RunId := RequestKey`.** No independently generated identifier. If the
key is structurally awkward, define a **branded RunId projection type over the
canonical identity** — never a second UUID. The invariant: one accepted-work
identity, created by the authority that admits the work. This yields the
recursive-system dataset (runId · agentId · definitionDigest · seatId ·
workspaceId · input · trajectory · artifacts · usage · cost · human
intervention · evaluation · business outcome) with no reconciliation table.

**Q4 — B2 split at semantic ownership, not LOC.** The test:
*"Can `@hachej/boring-agent` execute this without knowing what a Workspace UI
is?"* YES → agent. *"Does it exist because participants/resources/modules/views
are being composed?"* YES → workspace.
Agent side: AgentGateway, AgentRef, definition identity, runtime scope, session
records, envelope/run identity, metering hooks, standalone execution.
**Seat straddles**: generic binding type = shared/leaf; creation, membership,
role/grants, catalog projection = workspace.

**P0 amendment (ratified):** seatId and AgentRef are NOT peers.

```
P0 required:      AR1-003/004 · result → runId + artifacts[] · P0.1–0.6 · P-1 · A7 · A0 · seatId in C7
P0 opportunistic: AgentRef type · agentTypeId→agentId lint/convention · definitionDigest propagation
```
An AgentRef migration must never delay product or security work.

**Invariants NORMATIVE**, with a fifth backbone invariant added:

> **A Seat grants participation, not identity. A Workspace may constrain an
> Agent but must not mutate what Agent it is.**

Workspace-specific variation lives in the Seat/binding/effective composition —
never written back into the durable Agent definition.

**Final ontology (frozen):**

```
AgentId ── DefinitionDigest (exact version)
        ── AgentState (future; stays empty until needed)
        ── Seat A → Workspace A ── Session ── RunId ── {record, usage, artifacts, outcome}
        ── Seat B → Workspace B
```

**FREEZE.** Ontology, security model, durability model, migration doctrine,
product ladder, and DAG are settled. Next feedback comes from implementation
and the first real Agent Product — not another abstraction pass.

---

## 7. OWNER RULING — 2026-08-24 (amendment; multi-seat Thread; tracked in #1399)

Additive to §6, not a reopening: the frozen ontology and invariants above are
unchanged. This closes the one item §6 left implicit — how a Thread relates to
more than one Seat's Runs.

**Ruling.** *A Thread may span multiple Seats, projected as one timeline; one
Thread per job.* Mechanism: no new machinery. Per-Run seat attribution already
exists — the ratified trajectory spine (Q3 above, `runId · agentId ·
definitionDigest · seatId · workspaceId · input · trajectory · artifacts ·
usage · cost · human intervention · evaluation · business outcome`) already
carries `seatId` per Run. A multi-seat Thread is that same spine read across
Runs from more than one Seat and rendered as one collapsed timeline; Thread
still "owns one record and many Runs" per VISION R-c, now including Runs
authored under different Seats.

**Naming ruling.** This concept is named **multi-seat Thread** / **Job
Thread**. It is never called a "channel": `channel` stays reserved for
transport/ingress surfaces (C5 durable pause's "channel-answerable" delivery,
Track C, Slack/CLI ingress). Thread is the collapse point on the product side;
channel is how a message reaches or leaves the system. Do not conflate them.

**Explicit non-change.** This ruling does **not** activate A2A loopback or a
shared-runtime "room" where agents call agents. v0 realization stays
projection-based: an orchestrator Seat relays between per-agent sessions as an
ordinary client of each session's record — agents never invoke agents
directly, and no shared-transcript runtime primitive is promoted by this
ruling. Any future shared-transcript runtime primitive keeps its own
promotion gate (Rule of Three / second runtime mode, per VISION R-e) and is
out of scope here.

**Console/#1355 hook.** Console conversation references must be typed to
allow a Thread with more than one Seat from the start — contracts must not
assume single-seat Threads. This is a naming/typing constraint on #1355's
planning, not new scope for it.

**Deferred (unchanged from RECONCILIATION §5 / VISION §10).** The human-facing
multi-agent selector/switch UX remains a separate product decision; this
amendment ratifies the data-model sentence only.

---

## 8. OWNER RULING — 2026-08-26 (amendment; product surface + premises order; tracked in #1399)

Additive to §6 and §7, not a reopening: the frozen ontology, invariants,
durability model and DAG above are unchanged. §7 ratified the data-model
sentence and explicitly deferred "the human-facing multi-agent selector/switch
UX" as a separate product decision. **This amendment takes that deferred
decision.**

### (a) The product surface is the multi-agent workspace shell

The surface over a Workspace is a shell with five top-level domains —
**Inbox · Work · Agents · Library · Search**. Nav is domains; the vertical
plugin rail is tools.

- **Transparent multi-agent Threads.** A Thread looks like an ordinary chat with
  several agents inside it, behind **one composer**. Workers are hidden behind
  the orchestrator: the user addresses a *voice*, not a *Seat*. Per-Seat work
  logs are drill-down provenance, not the primary surface — the §7 projection
  read as one collapsed timeline.
- **One workbench, many mounts.** The artifact/file surface is a single
  component mounted in several places — inside a Thread as a canvas, under an
  attention item as an evidence viewer, as a transient file popover, and
  standalone as the Library. It is one component, not four surfaces.
- **Deterministic Views beside agentic Threads.** The shell renders ordinary
  application Views (collections, records, dashboards) *next to* agentic
  Threads, with conversation available as a column beside a View rather than a
  separate destination. This is what makes the surface an application rather
  than a chat client.
- **Library is the View library**, consistent with the ratified P1 line
  (`VISION.md:38`) — Dockview stays a renderer, and agents reason over Views and
  artifacts, never renderer concepts (invariant 4, `VISION.md:134`).

This ratifies the *shape* of the surface. It does not schedule it — see (c).

### (b) The design canvas and the spike branch are ratified specification artifacts

Two artifacts are promoted from exploration to **specification**:

- **The design canvas** (owner-iterated *Meridian Shell* mockups) — the visual
  language and the five-domain structure.
- **The spike branch `weekend/saas-hybrid-spike`** — the constructive proof that
  the IA above is reachable by **recomposing components that already ship**,
  rather than by new invention.

Their status: they are what the implementation is checked *against*. They are
not themselves an implementation claim — the spike's chat column and thread
transcript are explicitly visual fixtures, and nothing in this amendment says
otherwise.

### (c) Kernel premises precede the surface build

**Ruling.** The surface above is built **on** kernel capabilities, not beside
them. Named preconditions, in the sequencing sense:

1. **Durable streams.** The multi-agent engine is not built on conformance
   Level B. Level D conformance lands and goes default-on first — D29's own
   named re-evaluation trigger (`DECISIONS.md:472`, `:476`), now called.
2. **Seat storage.** Per-message attribution in a multi-seat Thread is
   **audit-grade from day one**, resolving through ratified `seatId` in C7
   (P0 required, §5 above). Display-grade participant handles are not a
   shipping position.
3. **Views.** Saved Views in the Library wait for the first ratified slice of
   the kernel View contract *as a set* — `ViewDescriptor` + `ViewResolver` +
   `ViewHost` + `ViewContext` + `ViewRef` (`V2-IMPLEMENTATION-SPEC.md:144-149`).
   No lookalike descriptor is minted in the product layer meanwhile.

**Explicit non-change.** This amendment promotes no new noun, activates no A2A
loopback, and creates no shared-runtime room; §7's non-change clause stands
unaltered. The **thread storage model is explicitly NOT ratified here** — it is
an open technical question routed to a spike, and nothing in (a) presumes its
outcome.

**Where the program lives.** The premise program, its sizing and its briefs are
planning material, not ratified text: `docs/plans/multiagent-shell/premises.md`,
tracked in [#1409](https://github.com/hachej/boring-ui/pull/1409).
