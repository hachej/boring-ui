# Pi v2 (AgentHarness) — alignment analysis and the rewrite question

> **SEQUENCING UPDATE 2026-08-27 (second grill — RECONCILIATION §9c):** the
> "wait for a qualifying pi release" gate referenced below is **removed**.
> P1-B builds Boring's own event backend behind the seam; the adoption
> criteria in this document remain the bar a future pi release must clear —
> now including the migration cost of replacing a working backend.

> **POST-SPIKE VERDICT (2026-08-27, spike report:
> [`pi-core-adoption-spike-report.md`](pi-core-adoption-spike-report.md)).**
> The empirical spike **overturns the "shipped core" premise below**: at
> published 0.84.3 the entire `AgentHarness` operational surface
> (prompt/resume/abort/watch/lanes) is a compile-complete scaffold that
> throws `HarnessNotImplemented` — only the storage layer is real running
> code, and the v3 decoder is **dev-only, absent from the npm package**.
> Also decisive: the **lanes candidate fails the posts-only store-isolation
> test as shipped** (`findEntries()` without a lane filter reads across
> lane boundaries). What the spike *proved*: storage-layer crash durability
> (live kill+reopen), caller-configurable host-volume session roots, and a
> workable ledger-reconciliation protocol design. **Standing ruling: do
> NOT wire pi 0.84.3 under D29; ~0 of the ~1,704 bespoke lines are
> deletable today; P1's substrate-neutral layer proceeds now; the
> event-store implementation WAITS for a qualifying pi release (owner
> ruling — 2026-09-10 is a check-in, not a build trigger); re-run the
> spike when pi publishes the dev runtime.** The analysis below is kept as the pre-spike record.

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
| Durable restart-point + intent→effect→settlement sandwich; crash-safe recovery, no silent gap in-process | [durable-streams] | **PARTIAL.** Real durability — explicitly single-process / single-writer / no replication ("a session lives in one place"); the no-fsync caveat applies to the **JSONL backend specifically** (the SQLite backend uses WAL + transactions). Level D — a client always resumes across host restarts — still has to be built at our gateway layer; of P1a's four named Level-D cases, only stream-sequence continuity is clearly replaceable by v2 — durable gateway ledger, effect admission, and cross-session activity remain ours. |
| Session / Branch / AgentLane / operation | Thread / seat-lane / Run | **STRONG PRECEDENT, not a decision.** Maps closely onto the storage spike's option (ii) first-class thread record. No seat identity, no participant-removal semantics, single-writer assumed. |
| Typed durable `value<T>`/`list<T>` (values.md) | thread record + seat catalog substrate | **MECHANISM, not policy.** A real candidate store; attribution/migration/fork policy still ours. |
| Tool/assistant durability | relay `openEdge()` + receipts | **ORTHOGONAL.** Their sandwich makes effects idempotent *inside one lane's operation*; crash-safe reservation of a turn *across sessions* has no pi-v2 equivalent. (This corrects our earlier "Level D makes receipt machinery largely redundant" note — it overstated.) |
| Multi-presentation attach (mini demo: N TUIs, one Session, one live transcript) | resumable multi-surface viewing | **DELIVERS the viewer half.** Working hydrate/reconcile reference. |
| Multi-Session per presentation (several agents in one pane) | Job Thread projection | **DEFERRED ON THEIR SIDE — an explicit open decision.** Our core product mechanic is out of scope for them. |
| `RemoteEvents` | durable streaming | **OPPOSITE:** deliberately non-durable, never replayed; their `Transcript` service is an unimplemented stub. |
| Per-connection client identity | [seat-storage] audit-grade `seatId` | **PARTIAL-ABSENT.** Pi assigns connection peer identity (`plugins.md:159`); what is absent is *durable, audit-grade* seat identity on the record — that stays ours. |
| Facet RPC bus | D29 AgentGateway | **NO CONFLICT.** Their RPC is intra-process plumbing one level below the gateway funnel; adopting pi v2 forces no gateway rework. D22's `input-required` agent-to-agent shape still has no analogue. |
| Worker replacement (lease handoff, durable state survives) | per-session shard, D29 record ownership | **VALIDATES** our shard model. One check: D29's "agent owns its session record" must be read as durable-record ownership, not live-process affinity. |

**Maturity split:** the harness/runtime engine is *landing code* (work
packages 00–06 essentially complete, public drive enabled, same-day
commits). The plugin/facet/RPC layer is *design input, not a normative
contract* (their words). The coding-agent services implemented end-to-end
today: session directory/management, models, prompt/abort — queue, resume,
compaction, transcript snapshot all throw not-implemented.

**Fresh-branch insights (2026-08-27, origin/dev at `f0bfae2`):**

- **Multi-lane-per-Session is real and implemented** — `lane(name, …)`,
  `lanes()`, `SessionSnapshot.lanes: LaneInfo[]` (`agent-harness.ts:559`).
  That pre-answers the first seats-as-lanes probe question with YES. Per-lane
  identity is only a string name — our audit-grade `seatId` layers on top,
  exactly as designed. Lane→presentation routing exists but at the
  experimental/mini prototype layer only. **Version precision:** the lane
  *concept* ships in published 0.84.0+ ("v4 lane-based Session …
  tree-scoped lane views"); the clean Session/Branch/AgentLane separation
  and this multi-lane surface landed **one day after the v0.84.3 tag** —
  dev-only until the next release. The spike's durability/import probes run
  against published 0.84.3; its lane probes pin a dev commit and stay
  provisional until released.
- **Their post-WP05 roadmap (11 items) confirms our verdicts:** multi-agent
  orchestration is NOT on it, and the Transcript service is named only as a
  *future* consumer of session-wide watch. Next up for them: SQLite
  ownership fencing (WP07) — because single-writer enforcement currently
  has **two documented unfixed lease races**, and their own docs state a
  JSONL session opened twice is "corrupt and undetected".
- **Consequences for us:** any adoption uses the SQLite backend only, and
  our gateway keeps its *own* ownership fencing regardless of substrate (do
  not inherit WP07's open races). The remote-session contract is an
  explicitly unresolved decision upstream — one more reason the D29 funnel
  stays the boundary.

**Public signal (2026-08-26, evening):** pi's author publicly demoed the
mini topology — *"internal multiplayer achieved… new harness makes this
very easy"* — two terminal clients attached to one session with one shared
live transcript. This is **multiplayer (many viewers, one agent), not
multi-agent**; his own follow-up ("now i just need to draw the rest of the
fine owl") marks the remainder as unbuilt. Net effect on this analysis:
confirms the multi-presentation maturity claim, leaves the
multi-agent-deferred verdict standing, and raises the urgency of the
bounded core-adoption spike — the collaboration surface of the shipped v4
core is evolving fast and in public.

**The migration line (corrected by adversarial review, same day):** pi v2
**ships a v3 compatibility decoder** — legacy coding-agent transcripts are
required to open unchanged (`harness.md:2892`), the decoder exists
(`legacy-v3.ts`), and conversion is atomic on first v4 write
(`storage.ts:249`). The residual migration risk is **ours, not pi's**:
Boring wrapper records, namespaces, linked-native identity, rollback, and
host-volume layout (session history stays host-app user data, hard rule 9).
Also decisive: **the v4 `Session`/`AgentHarness` core went public in 0.84.0
and the legacy core repositories were removed; upstream is 0.84.3** — our
0.80.7 pin is on a deleted line, so passive waiting is itself a risk.

## Recommendation — SPLIT THE DECISION: bounded core-adoption spike now, facet layer later
### (revised same-day after adversarial review; supersedes the first "track and align" cut)

1. **Do not rewrite the product around the unfinished facet stack.** The
   plugin/facet/RPC layer is design-input; multi-agent projection,
   cross-session turn mechanics, and audit-grade attribution stay ours
   regardless.
2. **But do not passively track the core** — the v4 harness is shipped
   (0.84.x, legacy core deleted), the v3 decoder exists, and our 0.80.7 pin
   sits on a dead line. **Run a bounded pi-0.84.3 core-adoption spike
   through the existing D29 gateway, alongside P1a:** open a real 0.80.7
   transcript through the v3 importer; prompt, watch, restart, resume, roll
   back; map `LaneSnapshot`/`LaneEvent` to the frozen gateway DTO; prove
   host-volume/session identity. Sizing context: our bespoke durable-stream
   surface is ~1,704 lines (+ its share of the 1,331-line
   `HarnessPiChatService`) persisting `PiChatEvent` shapes pi v2 does not
   speak — the spike decides how much of that P1a keeps versus delegates.
   P1a retains the durable request-ledger, admission, activity, and public
   replay guarantees **regardless of transcript source**.
3. **Ordering is the owner's call, explicitly:** DIRECTION currently says
   P1a "start here". Making the core spike *blocking* (vs parallel) is a
   DIRECTION amendment only the owner makes — this research note does not
   override it.
4. **The facet/RPC layer adopts only when its contract becomes normative**
   (their own label today: design input). Forced review triggers either
   way: 0.80.x loses maintenance/security support, an unbackported security
   fix appears, or we exceed an approved version lag.
5. **Storage spike framing corrected:** pi v2 is **a substrate variant of
   the first-class-record candidate**, not a third ontology — premises §P2
   and the spike beads say so.
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

## Adoption qualification criteria (behavior-gated, never version-gated)

Passing these criteria — not the passage of time, and not a version number —
is what triggers re-evaluation. *(The dated owner check-in that stood here
was removed 2026-08-27, RECONCILIATION §9c: nothing waits on pi anymore;
these criteria are now purely the replacement bar for a working Boring
backend, migration cost included.)*

**EVENT-STORE adoption** requires all of:

1. Operational prompt/resume/watch/abort in the **published** package (not a
   dev-only branch).
2. The published importer opens real v3 sessions.
3. Kill+reopen preserves sequence continuity.
4. Session roots are host-controlled.
5. Workspace-scoped identity is imposable.
6. Ownership fencing is adequate, or is safely superseded by our
   single-writer protocol.
7. D29 snapshot/cursor semantics are implementable without leaking pi types.
8. The ledger↔session repair protocol passes every crash boundary.
9. Adoption removes enough code/risk to justify the migration.

**LANES** additionally require:

1. No cross-lane read through an ordinary backend handle (or an
   independently enforced store boundary).
2. Exact immutable `seatId` attribution.
3. Seat removal never rewrites history.
4. Credentials/private context are lane-isolated.
5. Only settled, typed posts cross lane boundaries.

Passing the event-store criteria does **not** rehabilitate lanes — the two
sets are evaluated independently.

**2026-09-10 decision rule:**

- A qualifying release exists → rerun the spike.
- A dated near-term release plus strong evidence → optionally keep waiting.
- Unpublished, or still failing → the owner explicitly chooses wait-again vs.
  build-ours.

No automatic build; no criteria-free waiting.
