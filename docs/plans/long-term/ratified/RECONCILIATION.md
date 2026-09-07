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
10. Docs never precede the implementations they describe. (v3 §6, the G16 lesson; pending §11(g) clarifies that this governs implementation claims, not explicitly unbuilt plans.)

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

> **Superseded in part — 2026-08-26 (§8):** the *storage shape* behind "owns
> one record" is suspended pending the thread-storage spike (§8c). The
> ontology sentence — one Thread, many Seats, one collapsed timeline — stands;
> whether the backing store is one first-class record or a projection over Run
> records is the spike's question.

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

Additive to §6 and §7 with **one named exception**: the frozen ontology (the
noun set), the invariants, and the DAG above are unchanged, but this amendment
**suspends the "a Thread owns one record" storage-shape clause** (§5 above,
and `VISION.md` §"Thread") pending the thread-storage spike — see (c) and the
supersession banners at both older sites. §7 ratified the data-model sentence
and explicitly deferred "the human-facing multi-agent selector/switch UX" as a
separate product decision. **This amendment takes that deferred decision.**

### (a) The flagship operator/collaboration surface is the multi-agent workspace shell

The **reference surface for multi-agent, multi-work, operator-style use**
over a Workspace is a shell with five top-level domains —
**Search · Inbox · Work · Agents · Library** (Search renders at the top of the
nav; the enumeration is a set, not a layout). Nav is domains; the vertical
plugin rail is tools. Two interview rulings (2026-08-26) complete the frame:
**plugins MAY add top-level nav entries** — the five domains are the floor,
not a closed set; crowding is an accepted risk — and **deep links split as:
the shell owns the serializable location, the host owns URL translation.**

**Scope (owner ruling 2026-08-27).** This ratifies the Meridian shell as
Boring's **flagship** operator and collaboration Experience. It does **not**
make that shell the only valid Boring product surface. The same governed
substrate may be consumed through a route-first vertical SaaS Experience, a
chat-first expert Agent, a headless job API or MCP surface, an embedded
capability, or an external message channel (consistent with Decision 28's
consumption modes). Those surfaces must reuse the same Work, operation,
authority, artifact, decision, and evidence semantics — never parallel
architectures.

- **Transparent multi-agent Threads.** *(Presentation superseded 2026-08-27
  by §9b: the transcript is multi-author — one composer, explicit
  specialists; the "voice, not a Seat" clause below is retired.)* A Thread looks like an ordinary chat with
  several agents inside it, behind **one composer**. Workers are hidden behind
  the orchestrator: the user addresses a *voice*, not a *Seat*. Per-Seat work
  logs are drill-down provenance, not the primary surface — the §7 projection
  read as one collapsed timeline. *(One composer and a hidden worker team are
  the default **team-presentation policy of this shell** — not a universal
  requirement for every product; another Experience may expose one agent,
  explicit specialists, an ambient agent, or no composer while keeping the
  same underlying agent and work model.)*
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
  artifacts, never renderer concepts (invariant 4, `VISION.md:144`).

This ratifies the *shape* of the surface. It does not schedule it — see (c).

### (b) The design canvas and the spike branch are ratified specification artifacts

Two artifacts are promoted from exploration to **specification**:

- **The design canvas** (owner-iterated *Meridian Shell* mockups) — the visual
  language and the five-domain structure.
- **The spike, ratified at the immutable commit `08cc60523`** (branch
  `weekend/saas-hybrid-spike`) — the constructive proof that the IA above is
  reachable by **recomposing components that already ship**, rather than by new
  invention. The commit, not the moving branch, is the specification.

Their status: they are what the implementation is checked *against*. They are
not themselves an implementation claim. Honest scope of the proof at that
commit: the thread chat mounts a **real single-agent session** (a live
`PiChatPanel`); Search sits at the **top of the nav**, above the four domains;
the retired element is the *global* chat column — conversation is contextual,
beside a View or inside a Thread, never a global assistant pane. What remains
**unproven fixture territory is the multi-voice transcript itself** — several
agents behind one composer with audit-grade attribution — and nothing in this
amendment says otherwise.

### (c) Kernel premises precede the surface build

**Ruling.** The surface above is built **on** kernel capabilities, not beside
them. Named preconditions, in the sequencing sense:

1. **Durable streams.** The multi-agent engine is not built on conformance
   Level B. Level D conformance lands and goes default-on first — D29's own
   named re-evaluation trigger (`DECISIONS.md:472`, `:476`), now called; the
   dated D29 addendum recording this rides the same PR (`docs/DECISIONS.md`,
   D29 addendum 2026-08-26).
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
outcome. *(Update 2026-08-27, §9a: the value-root half has since been ruled —
Thread = job root, 0..n Sessions; only the storage shape remains spiked.)*

**Where the program lives.** The premise program, its sizing and its briefs are
planning material, not ratified text: `docs/plans/multiagent-shell/premises.md`,
tracked in [#1409](https://github.com/hachej/boring-ui/pull/1409). The list
above is **dependency rationale only** — the single executable ordering and
merge queue live in `docs/direction/DIRECTION.md`, which alone answers "when".
Merging #1409 ratifies this §8 *(merged 2026-08-27 — §8 is ratified)*.

## 9. OWNER RULING — 2026-08-27 (second grill; Thread/Session split, transcript authorship, pi gate)

Ruled in the owner grill of 2026-08-27 (post-#1409). Three rulings; each names
what it supersedes. Recorded here per rule 11 — ontology changes land in the
ratified pack, never silently.

**(a) Thread/Session split — R-c amended.** R-c's "Thread = Session, one
object" clause is **amended**: they are now two objects.

> **A Thread is the durable job root** — the product noun for one unit of
> customer work ("resumable work, not chat", as VISION already says). **A
> Session is one runtime conversation.** One Thread binds **zero or more
> Sessions** (headless Work = a Thread with none; a job spanning channels or
> re-opened conversations = a Thread with several). "One Thread per job"
> stands; its converse does not — a job is not limited to one conversation.
> "Channel" stays reserved for transport/ingress (§7 naming ruling,
> unchanged). Seats attribute Runs, unchanged.

This resolves the **value-root half** of the P2 storage question by ruling,
not by spike: the "Work + conversation bindings" candidate is adopted **at
the ontology level with Thread as the root noun** — no new "Work" kernel noun
is minted, because ratified Thread already means resumable work. The
requirements that force this were already ratified (headless jobs, one job
across WhatsApp + web, economics surviving conversation archive/erasure); a
three-way spike over two pre-excluded candidates would have been ceremony.
What **remains spiked** is only the storage **shape**: whether the Thread's
timeline is a first-class durable stream or a projection over its Sessions'
records (premises P2, rescoped).

**(b) Transcript authorship — multi-author.** The §8 surface language
"workers hidden behind the orchestrator's voice" is **superseded**. Meridian's
Thread transcript shows **several named agents**: one composer for the human,
but specialist agents visibly author their own posts (name chips,
joined/handoff/left markers), consistent with §7's collapsed multi-seat
timeline. The formula is **"one job, one composer, explicit specialists"** —
"one voice" is retired. Consequence: the orchestrator is a named speaker like
any other and therefore **holds its own Seat** (closing the known
orchestrator-Seat gap in the direct way). Audit-grade per-Run `seatId` (§8
precondition 2) is unchanged and now also backs the visible chips.

**(c) Pi wait gate removed.** The "P1-B waits for a qualifying pi release /
2026-09-10 owner check-in" construction is **removed as a gate** (sequencing
detail lives in DIRECTION). The event-stream backend proceeds on Boring's own
schema behind the `AgentHarnessBackend` seam; a future pi release is adopted
only if it demonstrably beats the migration cost against the existing
behavior criteria. No ontology change; recorded here because §8's program
text referenced the wait.

**Explicit non-change.** No A2A loopback, no shared-runtime room; §7's
non-change clause stands. Posts-only and artifact-sharing boundaries stand.

## 10. OWNER RULING — 2026-08-27 (strategic-audit fold: staffing modes, agent presence)

Ruled after the external Seneca × Boring strategic audit (2026-08-27). Two
small ontology/product-policy rulings; the audit's commercial sequencing went
to the tenant repo per the premises-never-pricing split (DIRECTION records
that disposition).

**(a) Thread staffing — two first-class modes.** How many agents work a job
is a **per-job choice between two modes**, both first-class:

> **Grow-as-needed (default):** a Thread starts with **one bounded agent**;
> specialists are added only on measured evidence (quality or cost) —
> multi-agent is capability, not a maturity goal. **Predefined fleet:** an
> agent/vertical package may declare a team shape that staffs the Thread
> from the start. When nothing is declared, grow-as-needed applies.

Consequence for the future engine plan: the v0 engine optimizes the
single-agent path first and must not tax it with team overhead; §9b's
multi-author transcript is presentation and holds in both modes (a
single-agent Thread simply has one named author besides the human).

**(b) Agent-presence vocabulary.** An Experience declares its agent-presence
policy from a closed vocabulary:

> `hidden · ambient · drawer · page · roster`

**`ambient` is the default for vertical-SaaS Experiences** (the user sees
records, deliverables, exceptions, decisions — not orchestration);
**Meridian is the explicit-`roster` flagship.** Naming only — no
implementation obligation until the first Experience-layer slice.

**Explicit non-change.** No new nouns, no A2A loopback, no shared-runtime
room; §7 and §9 stand unaltered.

## 11. OWNER-REQUESTED AMENDMENT — 2026-09-05 (Workspace Evolution)

> Consumer scope is amended by §12 below (2026-09-06), and its first consumer,
> timing and execution home are superseded by §13 (2026-09-07). Clinic-specific
> requirements remain binding for Clinic; they do not define all products.

The owner requested that the personal, self-evolving workspace design become
a vision, milestone, and implementation-plan PR. It specifies future behavior;
no capability is marked shipped by this documentation change. The September 5
sequencing is historical; current sequencing is recorded only in the
[2026-09-07 DIRECTION amendment](../../../direction/DIRECTION.md#amendment-2026-09-07--native-creation-is-the-first-complete-product-journey).

**(a) Product contract.** A minimal workspace is usable immediately and can
adopt an optional domain starter. A direct user request can change its
interface, layout, workflows, and permitted agent behavior. The user can
preview, keep, compare, and undo versions. Adaptation should remove the
founder's manual request relay. Successful arrangements persist; passive
usage signals may suggest a change but do not themselves authorize one.

**Clinic clarification (2026-09-05).** Its primary Experience is a French
patient/document dashboard (**Documents médicaux**) with ambient assistance
and optional contextual chat. Workspace is the governed world, not required
visible chrome. This replaces the initial plan's split document/chat pilot.
The first proof must work without a mounted chat or a Session created merely
to open a domain record, then reuse the same document unit beside chat.

**(b) A private branch is a versioned composition.** Resolve exact shared
package versions plus workspace and personal overlays, behavior assets, and
any private modules. Git can own custom source and lineage; ordinary
preferences need not fork the entire platform. Active records, session
history, private files, and credentials are separate from software revisions.
The platform contract may be pinned within support policy; the host's current
security implementation and revocation authority cannot be pinned away.

A local behavior override constrains a binding or creates an explicit derived
definition with provenance. It never mutates the shared Agent identity for
other consumers. Preferences cannot widen the intersection of grants in §6.
Publishing a new expert package and adopting it in a customer's workspace are
different decisions.

**(c) Evolution uses host-controlled release.** An admitted builder Run keeps
RunId := RequestKey. Its immutable candidate identifies requester/scope,
parent/base, package lock, artifact and behavior digests, state compatibility,
and verification evidence. Records live in a product module using existing
Artifact/Evaluation/accepted-work seams where available; this does not promote
Experiment, Product, Schema, AgentState, or a module-runtime kernel noun.
An uppercase optimization Candidate/Objective is optional, as in the scoped
north star. Any durable job uses the existing Thread root (§9).

The host validates the exact candidate, checks current authority, and
atomically activates it against the expected revision generations across all
affected scopes. A stale parent or incompatible contract stops activation.
Candidate/source/evidence retrieval, preview access, and every brokered
read/action also require current scoped authorization. A digest or preview URL
is not a grant; revocation denies further access, not only activation, and
cannot undo prior disclosure.
The builder cannot alter protected checks, attest its own approval, or write
the active pointer. A capability expansion requires a separate host grant or
trusted package release, not an overlay field. Standing user policies may
authorize bounded changes without asking on every edit.

Undo is another authorized, append-only activation of a compatible prior
revision. It preserves business records and admits no unsupported state
rollback or repetition of external effects. Already admitted work retains its
code/behavior identity subject to current revocation; incompatible migrations
must drain or migrate it. Host recovery remains reachable outside custom UI.

**(d) Three distinct loops.** Private adaptation builds and adopts a local
candidate. Downstream maintenance reconciles old base, local intent, and new
base, with stable semantic targets, explicit conflicts, and compatibility
evidence. Shared improvement exports only approved portable material to an
optional package after review. Neither a successful private change nor an
upstream publication automatically changes another customer's workspace.
Domain concepts stay in domain packages; broader extraction needs repeat-use
evidence or an explicit owner promotion. No cross-tenant training or public
marketplace is required.

**(e) Named amendments and preserved boundaries.** VISION §8's universal-app
generator exclusion is narrowed to admit this bounded program. The generic
workspace/Meridian shell remains one supported Experience, not a mandatory
layout for every vertical. ARCHITECTURE-PLAN R1/D-b/§6 remain binding:
trusted registries are composition-time; generated code builds separately and
is served only through the isolated tier. A disposable working directory or
hot reload does not prove runtime confinement or release safety.

§8(c)'s View contract remains a set. A product-specific configuration may
select props of already registered components; it may not become a lookalike
saved ViewDescriptor before [saved-views-kernel]. Durable agent-driven release
waits for its accepted-work/Level-D prerequisites. Thread shape is a dependency
only when the slice consumes Job Threads; it is not imposed on every layout
preference. DIRECTION explicitly classifies the new lane rather than silently
reopening the former non-chrome or Wave-4 freezes. Pricing/GTM stay tenant-side.

**(f) Composability is an Experience contract.** Make §§8–10 operational in
the first Experience slice. Compose domain resources/operations, primary
surfaces/navigation, agent presence, work initiation, and scoped context/state
independently through the existing AppComposition/View boundaries. Chat-first,
document-first, conventional SaaS, embedded, headless, and hybrid recipes must
share governed operation and work semantics; they are not separate runtime
stacks behind a global mode switch. The §10 presence vocabulary stays closed;
an ambient Experience may open a temporary contextual drawer without changing
its underlying domain or staffing. A layout/presence choice grants no new
authority and enables no unattended trigger.

Domain packages own patient, encounter, and document identity and authoritative
state. Sessions optionally bind conversations to that work; they do not own
domain records. Clinic's consultation document path is currently session-keyed;
its live proof requires a trusted, compatible migration/adapter. Ambiguous identity mappings require explicit
resolution. Thread remains a job root with 0..n Sessions, never a replacement
name for every patient/document. Its storage-shape/attribution prerequisites
apply when consumed by either a UI or headless job.

Shared components expose supported mounts, typed bindings/intents, provider
lifetimes, instance/state isolation, compatibility, and accessibility. Domain
operations are shared by UI and agents. Independent views/jobs retain explicit
subject and version context; an active-patient selection cannot retarget
admitted work or authorize another resource. Presentation preferences are
separate from document content. Late proposals must not overwrite concurrent
human edits or conceal provenance, freshness, and review state.

Admitted server work and its status/results/decisions survive chat closure and
browser absence under accepted-work recovery. They remain accessible through
non-chat projections of existing Activity/Approval/artifact state. Browser
capture has an explicit consent/interruption lifecycle, not a promise to keep
recording after the browser closes. Changing a composition neither duplicates
effects nor silently loses a required decision or capture control.

E0 proves rendering reuse in two contract fixtures with normalized synthetic
domain references and a fixture-only adapter/extraction if needed. It does not
prove that Clinic's current data path is Session-independent. E1a earns durable
composition activation; E1b earns the live Clinic identity/lifecycle claim
only after the migration, [thread-storage-spike], and [seat-audit-attribution]
proofs. Both subproofs complete E1. Supported combinations need evidence;
this amendment does not require all mode combinations, a universal UI DSL,
a new scheduler, or a complete component-library rewrite before the pilot.

**(g) Documentation truthfulness — named clarification.** VISION invariant
14, ARCHITECTURE-PLAN §6, and §4 invariant 10 above prohibit claiming an
implementation guarantee before it is demonstrated. Explicitly labeled
plans/specifications may precede implementation and may be ratified as targets;
they must separate proposed behavior, dependencies, and required evidence from
shipped guarantees. This replaces the literal blanket reading of "docs never
precede implementation" while preserving the G16 evidence requirement.

Plan and milestone acceptance: [Workspace Evolution](../../native-creation/LIFECYCLE.md).

## 12. OWNER-REQUESTED AMENDMENT — 2026-09-06 (software model and cross-domain proof)

The owner requested a step back from Clinic-specific framing and a stronger
general software model, naming the Charlotte Ledoux/Seneca adaptation and ESG
portfolio-impact analysis. This clarifies §§8–11 and makes the consumer-scope
change below explicit. The [software model](../../../vision/04-software-evolution.md)
is the readable synthesis. The September 6 DIRECTION amendment was the dispatch
authority for this scope when adopted; §13 later supersedes its first consumer,
timing and execution home, and the [September 7 amendment](../../../direction/DIRECTION.md#amendment-2026-09-07--native-creation-is-the-first-complete-product-journey)
is the current dispatch authority.

**(a) Responsibilities, not new ontology.** The application model is state
and knowledge + domain operations + Experiences + durable work, under
authority, evidence and lifecycle control. Map these to existing semantic
resources/artifacts/mounts, Capability/operation, AppComposition/View,
Thread/Session/Run and trusted-host contracts. No universal SystemOfRecord,
Schema, DataSource, Process, Product or workflow-DSL noun is promoted here.
The full saved-View contract and existing promotion rules remain binding.

**(b) Sources and domain truth.** An application may own records or consume
authorized external systems and read-only corpora. It need not centralize them
in Boring storage. The domain adapter owns source identity, authority,
freshness/version semantics and write rules. Source evidence, derived results,
proposals and accepted records remain distinguishable. Missing guarantees
must be visible; a renderer or agent cannot infer them from a generic reference.

**(c) Domain operations are the shared behavior boundary.** UI, agents,
deterministic jobs and authorized external clients use the same governed
operation implementation. Subject/resource bindings, input versions, current
authority and effects are explicit. Domain code owns reproducible methods,
validation and transitions. Agents may reason and propose within that boundary;
they cannot mint grants or silently change domain policy. Ordinary queries,
manual edits and deterministic calculations do not require an agent Run,
Thread, or optimization Objective merely to fit the architecture. Admitted
agent work still uses RunId := RequestKey, and Thread remains the job root
with 0..n optional Sessions where a durable job is used.

**(d) Separate operating and software lifecycles.** Performing domain work
and changing the software that performs it are different loops. §11's immutable
candidates, current authorization, independent checks, scoped previews,
generation-checked activation, compatible undo and approved export continue
to govern the software loop. Domain records, knowledge state, effects and
already admitted work keep their own lifecycle; a software rollback cannot
rewrite them. Behavior/knowledge/method changes need the compatibility and
affected evaluation evidence appropriate to the changed class.

**(e) Cross-domain evidence.** Clinic's document/record workflow,
Charlotte/Seneca's source-grounded knowledge/draft workflow, and the owner's
ESG analysis use case test different responsibilities. The Charlotte package
and host seams are source-inspected, not production-activation proof. Charlotte
refers here to a public-corpus governance knowledge package, not evidence
about the person or their endorsement. ESG is
an unverified architecture stress case until the client sources and method
are provided. Synthetic fixtures and cosmetic variants do not qualify as real
consumer reuse or satisfy Rule of Three. A claimed shared capability must
work in a second structurally different live consumer before a cross-domain
capability claim; kernel promotion retains its stricter existing gate.

**(f) Explicit E-program scope change.** Replace §11's Clinic-only E0/E1
selection and Seneca-only identity-host framing with:

- E0 maps the owner-described Clinic request and a source-backed proposed
  Charlotte/Seneca fixture request to supported contracts. It records requester
  and provenance; a proposed request needs the intended requester's confirmation
  before being called an actual customer request. It reuses a rendering unit
  across two mounts and both synthetic domain
  fixtures, and records a labeled ESG hypothesis. No live proof, saved-View
  substitute or production activation follows.
- E1a proves durable configuration in one selected consumer. E1b proves that
  consumer's live domain identity/operations and bounded Job Thread with
  non-chat status/results/decisions. Record the workflow and domain owner
  before implementation. E1 still requires both subproofs.
- E1b's [thread-storage-spike] and [seat-audit-attribution] gates remain
  mandatory for every consumer; E1a retains P1-C and every premise it consumes.
  Clinic's domain migration is mandatory when Clinic is selected. Selecting a
  corpus-backed consumer neither performs nor waives Clinic's migration.
- E2/E5 prove ownership and maintenance for supported capabilities. Repeat
  a capability in a second structurally different live consumer before calling
  it cross-domain. This does not make every client deployment or every mode
  a prerequisite for an earlier bounded private change.
- E3 is required before promising behavior personalization; E4 only when novel
  code is needed. E5 configuration precedes E6 under DIRECTION; later behavior
  and module classes extend the applicable upgrade proof. E6 export and
  independent adoption remain separately authorized.

**Preserved boundaries.** No commercial reprioritization, universal database
or schema builder, shared-runtime room, marketplace prerequisite, second
execution identity or authority model, frozen-port reopening, or bypass of
confinement/accepted-work/attribution/View gates. The single-agent and ordinary
operate paths remain first-class. Known old scope is amended by this section;
the remaining implementation decisions are exposed in the consumer slices.

## 13. OWNER RULING — 2026-09-07 (native creation: the first complete product journey)

Ruled by the owner on 2026-09-07 after the native-creation reassessment and
grill recorded in [`docs/plans/native-creation/`](../../native-creation/README.md).
Additive to §6–§12; each clause names what it supersedes. **Merging #1561
ratifies this section** (the same instrument pattern as #1409 for §8). Sequencing
lives only in the DIRECTION amendment of the same date; this section decides
meaning and authority.

**(a) Product obligation and re-timing.** A tenant such as Seneca creates,
uses, changes, installs and maintains expert software from inside the product,
without founder source edits. Creation is itself a job. The first complete
journey is: one private product → immutable release → installation for a
separate consumer → retained method/UI change → supported upstream/private
reconciliation. This **supersedes the timing** that placed Product extraction
and creator publishing after two real verticals (VISION §5 K9; V2-IMPLEMENTATION-SPEC
L7 and Part C M8; V2-PORT-HANDBOOK V2-13). Public marketplace, discovery,
revenue share and cross-tenant learning remain deferred; private release and
installation do not wait for them. The **Product** noun leaves R-e's deferred
list for its private release/installation half only; its public-packaging
half stays deferred. Release and Installation are product-module records
(§11c), not kernel nouns; Rule of Three still gates kernel promotion.

**(b) Three layers: host, product runtime, sandbox.**

> **Host** = control plane and broker only: identity, membership, installation
> records, activation, data/attention brokering, revocation. It never imports
> product code except in `embedded` mode (c).
> **Product runtime** = durable, **one per installed product**: runs the
> product's agent loop(s), its generated domain operations, and serves its
> generated UI. It survives any sandbox and is isolated by mode. The runtime
> unit is the installation, not the agent; a single-agent product coincides
> with today's per-agent-type rule (ARCHITECTURE-PLAN D-e), so nothing landed
> changes.
> **Sandbox** = disposable environment lease (DECISIONS D31) used by builders
> and agents for tool calls, builds and checks. Never the product host.
> Destroying it must leave the installed product and its data intact.

**(c) Runtime modes are policy, not code.** `embedded` (in the host process;
permitted only on single-tenant deployments where the curator is the operator;
**default off**; today's `runtimeBackend/` hot-loading *is* this mode and is
gated as such) · `local` (bwrap/runsc lease on the same host) · `remote`
(hardware microVM: Vercel interim, sovereign Firecracker fleet per D31). One
contract in every mode; the host selects the mode per installation, never the
product or the builder. A product installed for a separate consumer on a
shared host requires `local` or `remote`. This **supersedes** ARCHITECTURE-PLAN
D-b's "server disabled" for the untrusted tier and **narrows** P0.6: generated
server code is admitted *inside a product runtime* in `local`/`remote` mode,
brokered by the host; it is never imported into the host process outside
`embedded` mode. D-b's "no third plugin-host service" stands: the product
runtime is the existing sandbox/runtime tier, not a new service class.

**(d) One trusted installation/activation path.** A host-owned path resolves
immutable released contributions per installation: a release declares
requirements; an installation binds resources, grants and a runtime mode;
activation is compare-and-set against the installation's generation and
settles once (prepared → committed | aborted) under a request key; undo is a
new activation of a prior release. Execution is authorized under
actor ∩ installation ∩ job ∩ current policy. Publication, installation,
activation and commercial launch are separate acts with separate receipts.
This narrows DECISIONS D25/D28/D29/D30 exactly as recorded in **D33**: still
one authorization/construction funnel, no agent-minted scope, no mutable
registry of executable code in the trusted tier, no second composer. A curator
or organization may set a **standing authorization** for private changes
within a declared change class and budget; the founder is not the default
approver. Default = preview/Keep, with standing authorization opt-in per
installation.

**(e) Builder agents are a distinct class.** Domain agents keep invariant 4
(semantic resources, views, artifacts; never renderer concepts). An authorized
**software builder**, seated as its own agent type with its own tool catalog,
may inspect and change renderer code, CSS, domain operations and tests for the
requested change — inside a candidate, never the active release, never
protected checks or authority controls. This narrows VISION invariant 4 and the
Port Handbook's renderer prohibition for that class only. Invariant 10 ("never
live self-rewriting") is unchanged: builders produce candidates; the host
activates.

**(f) Execution home.** This repository (`hachej/boring-ui`) is the execution
home for the journey. R-a (new repo, interface-first port) stands as doctrine
but is **demoted** from "the next major build" to an evidence-triggered later
port: `hachej/boring-v2` does not exist and nothing has been ported. DIRECTION
records the consequence.

**(g) First proof consumer.** A bounded **mathematics tutor product created by
the Seneca curator** and installed for a second authorized learner; then a
nontechnical curator's real workflow. Founder use alone is not usability proof.
§12's Clinic / Charlotte / ESG consumers remain E0 preparation fixtures and
later structurally different consumers; §12's second-consumer bar for any
cross-domain claim stands.

**(h) Platform/tenant boundary.** Re-rules the 2026-08-27 (night) Horizon
split for Horizon 3: release identity, installation, activation, product-runtime
modes and upgrade reconciliation are **platform substrate**. Offers, pricing,
packaging of the offer and creator agreements stay tenant-side. "Packages and
distribution" as a commercial motion remains tenant-side; its substrate is
platform.

**(i) Disposition of PR #1548 (Workspace Evolution).** Folded, not duplicated:
§11 and §12 stand as the lifecycle "how" (release contract, layers, mutation
lanes, E0–E6, cross-domain bar); this section supplies the obligation, the
layers/modes ruling, the timing, the execution home and the first consumer.
Its plan now lives at [`native-creation/LIFECYCLE.md`](../../native-creation/LIFECYCLE.md).
Read §11(e)'s "served only through the isolated tier … never register its
server routes" and E4's "C4 admitted isolation for build and serving" as:
build in a sandbox lease, serve inside a product runtime in `local`/`remote`
mode (c). #1548 closes as superseded when #1561 merges.

**Explicit non-change.** Thread = durable job root, 0..n Sessions (§9a); no
A2A loopback or shared-runtime room (§7, §9); one gateway session contract
(D29); Seats grant participation, not identity; the durable-streams premise
order; Rule of Three for kernel nouns; the premises-never-pricing split; the
isolation floor of D31.
