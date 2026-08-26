# Pi v2 (AgentHarness) — alignment analysis and the rewrite question

Date: 2026-08-26. Analyzed at `earendil-works/pi` dev branch commit
`5507d76` (same-day HEAD; local read-only clone `~/projects/pi-framework`).
Three independent read passes (integration surface / durability core /
transport + trajectory); full reports in the session record, evidence
quotes with file:line therein. We are pinned at `pi-coding-agent 0.80.7`,
which predates all of this.

**The question (owner, 2026-08-26):** pi is being re-architected — durable
`AgentHarness` (Session / Branch / AgentLane), plugin facets
(server / session worker / presentation), typed durable values, tool and
model-call durability. Does this overlap our building blocks enough that we
should *rewrite toward pi v2* instead of building our premises on 0.80.7?

## What pi v2 actually gives us (verified, not hoped)

| Pi v2 | Our block | Verdict |
|---|---|---|
| Durable restart-point + intent→effect→settlement sandwich; crash-safe recovery, no silent gap in-process | [durable-streams] | **PARTIAL.** Real durability — but "process-crash level, no fsync promise", explicitly single-process / single-writer / no replication ("a session lives in one place"). Level D — a client always resumes across host restarts — still has to be built at our gateway layer. |
| Session / Branch / AgentLane / operation | Thread / seat-lane / Run | **STRONG PRECEDENT, not a decision.** Maps closely onto the storage spike's option (ii) first-class thread record. No seat identity, no participant-removal semantics, single-writer assumed. |
| Typed durable `value<T>`/`list<T>` (values.md) | thread record + seat catalog substrate | **MECHANISM, not policy.** A real candidate store; attribution/migration/fork policy still ours. |
| Tool/assistant durability | relay `openEdge()` + receipts | **ORTHOGONAL.** Their sandwich makes effects idempotent *inside one lane's operation*; crash-safe reservation of a turn *across sessions* has no pi-v2 equivalent. (This corrects our earlier "Level D makes receipt machinery largely redundant" note — it overstated.) |
| Multi-presentation attach (mini demo: N TUIs, one Session, one live transcript) | resumable multi-surface viewing | **DELIVERS the viewer half.** Working hydrate/reconcile reference. |
| Multi-Session per presentation (several agents in one pane) | Job Thread projection | **DEFERRED ON THEIR SIDE — an explicit open decision.** Our core product mechanic is out of scope for them. |
| `RemoteEvents` | durable streaming | **OPPOSITE:** deliberately non-durable, never replayed; their `Transcript` service is an unimplemented stub. |
| Per-connection client identity | [seat-storage] audit-grade `seatId` | **ABSENT.** Attribution stays entirely ours. |
| Facet RPC bus | D29 AgentGateway | **NO CONFLICT.** Their RPC is intra-process plumbing one level below the gateway funnel; adopting pi v2 forces no gateway rework. D22's `input-required` agent-to-agent shape still has no analogue. |
| Worker replacement (lease handoff, durable state survives) | per-session shard, D29 record ownership | **VALIDATES** our shard model. One check: D29's "agent owns its session record" must be read as durable-record ownership, not live-process affinity. |

**Maturity split:** the harness/runtime engine is *landing code* (work
packages 00–06 essentially complete, public drive enabled, same-day
commits). The plugin/facet/RPC layer is *design input, not a normative
contract* (their words). The coding-agent services implemented end-to-end
today: session directory/management, models, prompt/abort — queue, resume,
compaction, transcript snapshot all throw not-implemented.

**The breaking line:** a full re-architecture with **no compatibility
decoder promised for durable session data** across 0.80.7 → v2. Session
history is host-app user data for us (hard rule 9); a jump carries a real
migration project.

## Recommendation — TRACK AND ALIGN, do not rewrite now

1. **Do not rewrite now.** Everything that makes our product ours — the
   multi-agent projection, the cross-session turn mechanics, audit-grade
   attribution, Level D at the gateway — pi v2 either defers, lacks, or
   deliberately excludes. Rewriting today means riding a mid-flight
   re-architecture through its breaking line for the parts we least need.
2. **Align so nothing we build fights the pi-v2 shape:**
   - the [thread-storage-spike] gains a **third comparator**: pi v2's
     Session/Branch/AgentLane + typed values as candidate substrate for the
     first-class-record option (bead `.13.1/.13.2` briefs updated);
   - [durable-streams] implementation prefers designs compatible with
     harness restart-point semantics (no bespoke event shapes a later
     harness adoption would strand);
   - the receipt-machinery descoping note is corrected (see premises).
3. **Set an explicit jump trigger** (owner gate item, not a calendar): adopt
   pi v2 when ALL of — (a) its transcript/resume service slices are real,
   (b) a session-data migration story exists across the breaking line,
   (c) our storage spike has reported (so we adopt onto a decided model).
4. **What we can steal immediately, zero adoption cost:** the mini demo's
   hydrate/reconcile pattern as the reference for our resume UX; the
   lease-handoff attachment states (`detached/attaching/attached/degraded`)
   as vocabulary for our reconnect states.
5. **The seam is the align mechanism.** A companion analysis (owner-supplied,
   reconciled in [`pi-v2-removal-map.md`](pi-v2-removal-map.md)) maps what
   Boring UI eventually stops owning, and contributes the concrete
   now-step: one `PiPlatform` interface between our surfaces and the agent
   runtime, adapter-implemented over today's gateway/0.80.7 path, someday
   by a pi-v2 adapter. Components depend on the seam, never pi internals.
   Adoption-neutral, valuable either way; tracked as bead
   `wt-391-forward-oueu` (dispatch ordering belongs to DIRECTION). Its
   corrected end state keeps the D29 gateway *contract* (internals may
   delegate) and keeps durable session storage host-owned (rule 9).

**Honest time-saved verdict:** less than hoped on the UI (their multi-agent
pane is deferred; transcript is a stub), meaningful on the substrate (a
worked durable-harness design + typed-values store to evaluate instead of
invent), and largest as *validation* — an independent team converged on our
shard model, our server-owns-routing shape, and a first-class durable
session record.
