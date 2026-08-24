---
title: Job Thread v0 — 1 Thread = 1 job
state: draft (round 2 — folds fresh-eyes + Sol adversarial review)
issue: 1399
review: verdict `revise` at 9e42e893a; this revision answers it. No implementation before owner sign-off.
---

# Job Thread v0 — multi-seat Thread projection, K7 demo

**Concept** (owner, [#1399](https://github.com/hachej/boring-ui/issues/1399)): the Thread is the unit
of WORK, not of agent. The human talks to the job; staffing collapses behind one merged timeline, and
per-agent sessions demote to drill-down provenance — CI logs behind a PR check. Convergence:
**1 Thread = 1 job = 1 Objective**.

**Naming is ratified, not free**: the product concept is a *multi-seat Thread* / *Job Thread*, never
"channel" (`channel` is reserved for transport/ingress: C5 "channel-answerable", Track C, Slack/CLI).
PR [#1401](https://github.com/hachej/boring-ui/pull/1401) (open) appends to `RECONCILIATION.md` §7 and
`VISION.md` R-c: *"A Thread may span multiple Seats, projected as one timeline; one Thread per job."*

**What v0 builds** is a *projection* over several per-agent Sessions, driven by a **relay** — a
non-Seat, non-agent service. §1 asks the owner to rule on the noun before anything is built.
Ordering and dependencies live only in §7; §§1–6 describe shape.

> **Correction carried from review.** Round 1 claimed "no A2A loopback; agents never call agents" as
> a ratified constraint. That misread the record. Decision 24 (`docs/DECISIONS.md:364`) ratifies **a
> native in-process binding for internal agent-to-agent consumption** ("no MCP loopback, no
> serialization; two-way chat via `input-required`") and states *"Adopting A2A internally is rejected
> as unnecessary."* Decision 25 (`:413`) defers **A2A** — the external protocol binding — not
> in-process collaboration. So relay-vs-native-binding is a **live product choice for v0, not a
> compliance requirement**, and it is owner question Q2. v0 proposes the relay because it needs no
> agent-facing capability and is deletable; it is not the only compliant shape.

## 1. The noun — decide this first

### Today

`Thread` is frozen as one object with Session: *"a Thread is not a Pi session, transcript, or tab —
it owns one record and many Runs"* (`VISION.md:112-115`), and the V2 spec's `Thread
{ threadId; workspaceId; title; participants; workingSet }` (`V2-IMPLEMENTATION-SPEC.md:121`)
**already carries a `participants` field**. `Seat { seatId; workspaceId; agentId; role?; budget?;
permissions?; bindingState }` (`:119`) binds an *Agent* to a Workspace and "grants participation, not
identity". No Thread, Seat, or participant noun exists in code (`ThreadRef|threadId|ConsoleCollection`
→ 0 hits across `packages/ plugins/ apps/`); `seatId` and `trajectory` → 0 hits.

### Delta — recommendation, and the cost of the alternative

Round 1 minted `JobThreadV0` holding several session refs. That silently created a *second* Thread
object against the frozen ruling, and called the relay an "orchestrator seat" against the frozen Seat
definition. Both are withdrawn.

**Recommended default (Q1-A): a projection descriptor with a distinct noun.**

```ts
/** NOT a Thread. A saved description of how to project several Threads(=Sessions) as one job. */
interface JobProjectionV0 {
  id: string                        // `job-<uuid>`
  title: string
  objectiveId?: string              // one-way ref into the objectives plugin (§5)
  participants: JobParticipantV0[]
  createdAt: string; updatedAt: string; revision: number
}
interface JobParticipantV0 {
  participantId: string             // TEMPORARY DISPLAY HANDLE — not a seatId, not audit identity
  role: "worker" | "reviewer"
  agentTypeId: string
  conversation: { workspaceScopeId: string; agentTypeId: string; sessionId: string }
  bindingState: "active" | "removed" // agent removal preserves history (cf. Seat.bindingState)
}
```

Why `JobProjectionV0` rather than the reviewed suggestions `JobThreadProjectionV0` /
`ThreadDescriptor`: both still lead with a Thread-noun and will be read as canonical Thread machinery
in a year. The record's subject is the **job**; "Job Thread" stays the product concept per #1401,
while the durable record never claims Thread-ness. The relay is named **relay** — a service, never a
Seat — because a Seat contains `agentId` and binds an Agent, which the relay is not.

This keeps frozen R-c intact and matches #1401's "no new machinery": nothing here is canonical
identity, and deleting the record destroys no Runs, transcripts, or authority.

**Alternative (Q1-B): JobProjection *is* the canonical Thread.** Cheaper than review assumed —
frozen `Thread` already has `participants`, so the ontology has room. But the cost is real and must
be paid up front: (i) an explicit R-c amendment, since Thread=Session becomes Thread⊇Sessions;
(ii) C7/`SessionCatalog` becomes the owner of Thread identity, pulling ratified P0 "seatId in C7"
(`RECONCILIATION.md:150-155`) into scope; (iii) #1355's `ConsoleThreadRefV1` and its
`(appId, principalId, workspaceScopeId, agentTypeId, sessionId)` unique key
(`docs/issues/1355/plan.md:74-78, 102-104`) must be reworked before #1355 implements, not after;
(iv) a migration for any Thread ref already written. Q1-B is the better end state and the wrong v0.

## 2. Mechanism — the relay

### Today

- **Correction from review, verified.** Round 1 claimed the existing drivers are bound to one
  `agentTypeId`. False for the one that matters: `runWithWorkspaceAgent(input, run)` takes
  `agentTypeId` **per invocation** (`WorkspaceAgentDirectRunInput { agentTypeId, context, requestId }`,
  `packages/agent/src/shared/workspaceAgentDispatcher.ts:57-71`). Only the long-lived
  `WorkspaceAgentGatewayBinding {gateway, scope, agentTypeId}` (`:67-71`) is single-agent.
- The trusted composition root already issues **per-request** scope and guards workspace selectors
  (`createWorkspaceAgentServer.ts:2088-2101`): `scopeIssuer.issue({claim:{workspaceScopeId,
  authSubjectId}})` then `agentHost.runWithWorkspaceAgent({...input, authorizedScope}, run)`.
  Unbounded access was deliberately removed (`:2103-2104`).
- The capability handed to the callback is **callback-scoped and non-retainable**:
  `LeaseBoundWorkspaceAgent` is documented "lease guarded by the Host and must not be retained after
  the callback" (`shared/workspaceAgentDispatcher.ts:40-42`). Its `dispatch(input, onEvent,
  onAccepted)` returns `{ ref, receipt }` — an accepted Gateway receipt, persistable before events
  are consumed (`:44-56`).
- `EmbeddedAgentGateway` is exported at `packages/agent/src/server/index.ts:185`.
- Turn events carry the anchors the relay needs: `agent-end { seq, turnId, status, willRetry? }` and
  `message-end { seq, messageId, final: BoringChatMessage }` (`shared/chat/piChatEvent.ts:6-25`).
  **`willRetry=true` marks a NON-terminal end** — the comment warns once-per-settle consumers to
  ignore those.

### Delta

**Drop the gateway-holding plugin class from round 1.** It would have retained a lease-guarded
capability across turns, which the contract forbids, and hard-coded the embedded tier. Instead the
relay is a stateless function invoked once per seat turn, using the existing actor-aware callback
seam — no new authority-bearing host seam, no long-lived scope, no D28 second composer:

```
relayTurn(jobId, targetParticipant, payload):
  runWithWorkspaceAgent({ agentTypeId: p.agentTypeId, context, requestId }, async (bound) => {
    const { ref, receipt } = await bound.dispatch(..., onEvent, onAccepted)
    // persist the relay receipt (§3) from `receipt` BEFORE consuming events
  })
```

**Structured handoff, not free-text parsing.** Round 1 parsed `@reviewer` out of prose. Withdrawn:
quoted or incidental mentions branch the run and make acceptance untestable. v0 registers a
**handoff tool** on each participant agent — `handoff({ to: <role enum>, message: string })` — so the
target is typed, the payload is explicit, and the transition is a `tool-call` event the relay matches
exactly. This is a workspace plugin tool the relay owns; it is *not* an agent-to-agent call (the tool
returns immediately, the relay decides what happens next).

**Post-vs-Run boundary — only posts cross seats.** A seat's private reasoning, tool calls, and
intermediate messages never enter another seat's context. Exactly two things cross: (a) the **final
assistant message** of a settled turn (`message-end.final`, gated on an `agent-end` with
`willRetry !== true`), and (b) **relay-authored system handoff markers**. Everything else stays in
the originating session and is reachable only by drill-down.

**Turn policy — addressing-gated, with prior art.** [Buzz](https://block.xyz/) (Block, July 2026) is
an @-mention-gated agent group chat and the closest shipped prior art. Adopted: a participant acts
only when explicitly addressed (here, by typed handoff or by the human), one shared timeline, human
as approver rather than per-turn participant (our Inbox Human Intentions). Fixed: Buzz leaves
stopping conditions to agent authors and mention loops are a known failure mode — v0 enforces caps
centrally in the relay (§3), and replaces mention-parsing with the typed tool. Deferred: Buzz's
parallel same-brief mode (v1; its mechanism is already named — #1355's `AutomationGroup` fan-out,
`plan.md:253-279`). D24 already anticipated the caps as "consumption cycle/depth guards (A→B→A)"
(`docs/DECISIONS.md:365`).

### Failure semantics

Every abnormal end writes a terminal system event onto the projection; the relay never fails silent.

| Case | Rule |
| --- | --- |
| Non-terminal end | `agent-end` with `willRetry === true` is ignored; the chain does not advance (`piChatEvent.ts:9-11`). |
| Seat error run | `agent-end.status === 'error' \| 'aborted'` ends the chain, records `chainState: "failed"` with the source `turnId`, and posts a system event. No automatic retry in v0. |
| Handoff to a removed participant | `bindingState === "removed"` → chain ends with `participant-unavailable`; history is preserved, never rewritten. |
| Partial cross-post | The relay receipt is written from `onAccepted` *before* events are consumed, so a crash after dispatch is replayable: the destination `requestId` is the idempotency key and the send is never duplicated. |
| Restart mid-chain | Durable `chainState` + per-ref processed cursors (§3) resume or terminate; a chain whose destination receipt exists but whose completion is unknown resolves to `outcome-unknown` and posts a system event rather than re-sending. |
| Cap exceeded | Terminal system event naming the cap and the last `turnId`; no truncation, no silent stop. |
| Blocked on `ask_user` | Not a terminal Run — the chain suspends, does not advance, and does not count against the hop cap until answered (§4). |

## 3. Relay state — the durable receipt

### Today

Round 1's record explicitly owned no transcript or runtime, yet the relay needed "history since last
turn", processed handoffs, per-turn depth, and terminal system events. Nothing owned that state.
`AgentSessionEvent { ref, seq, event }` documents **"`seq` is the only replay cursor"**
(`shared/gateway/events.ts:4-8`) — there is no wallclock, no thread id, no cross-stream correlation.
Round 1's `(wallclock, seq)` merge key **is not implementable** and is withdrawn. The request ledger's
target carries only the session ref, not a job or participant (`agent-host/types.ts:47-57`).

The ratified home for this already has a name: **`Activity` — "what happened: runs, delegations,
approvals, interventions (envelope projection — no second event system)"**
(`V2-IMPLEMENTATION-SPEC.md:122-123`).

### Delta

A `JobRelayReceiptV0` append-only log beside the projection record in the same plugin store, written
under the same `revision` CAS. It is an **envelope projection**, not a competing event system: every
field is either relay-authored control state or copied from an existing receipt.

```ts
interface JobRelayReceiptV0 {
  jobId: string
  threadTurnId: string              // relay-assigned, monotonic — the ONLY total order across seats
  sourceRef?: AgentSessionRef       // whose settled turn triggered this
  sourceTurnId?: string             // from `agent-end.turnId`
  destinationRef: AgentSessionRef
  destinationRequestId: string      // from dispatch `onAccepted` receipt — the idempotency key
  handoffEdge?: { fromRole: string; toRole: string }
  processedCursors: Record<string, number>   // per-ref `seq` high-water mark
  chainState: "running" | "suspended" | "completed" | "failed" | "capped" | "outcome-unknown"
  capOutcome?: { cap: "hop" | "invocation"; limit: number; observed: number }
  createdAt: string
}
```

- **Ordering**: `threadTurnId` is the total order across seats; per-ref `seq` orders within a seat.
  Merged rendering sorts by `(threadTurnId, seq)`. No wallclock anywhere.
- **Idempotency / restart**: on boot the relay reads the last receipt per job. A receipt with a
  `destinationRequestId` and no terminal state resolves per the §2 table — never a blind re-send.
- **Caps**: `maxHopDepth` (default 3) and `maxInvocationsPerHumanTurn` are evaluated against the
  receipt chain, so a restart cannot reset them.
- **Context bound**: `processedCursors` is what "history since last turn" means concretely — a
  participant receives posts (§2) after its own cursor, capped at `maxInjectedPosts` /
  `maxInjectedBytes`; overflow drops **oldest-first** and inserts a relay-authored truncation marker.
  No summarization in v0 (a summarizer would be an unreviewed model call inside the relay).

**Per-Thread budget is dropped from v0 claims.** Round 1 promised a per-Thread budget hook. It cannot
be built: `MeteringRunScope { workspaceId?, userId?, userEmail?, userEmailVerified?, sessionId,
runId, source }` (`pi-chat/metering.ts:45-53`) has **no job, thread, or participant field**, and
reservations key on `runId = pi-run:${sessionId}:prompt:${clientNonce}` (`:197-202`). v0 ships only
the relay-enforced hop/invocation caps above, which bound *hops*, not spend. The named prerequisite
for a real budget — a v1 slice, not a v0 claim — is adding a job dimension to `MeteringRunScope` and
threading it through the reservation path.

## 4. Projection — the merged timeline

### Today

- The left-pane row model `AppLeftPaneSession { id, agentTypeId?, title?, updatedAt?, turnCount?,
  nativeSessionId?, hasAssistantReply?, ephemeral?, status? }`
  (`packages/workspace/src/front/layout/plugin-tabs/AppLeftPane.tsx:17-27`) is session-shaped with no
  `kind` discriminator, and PR [#1393](https://github.com/hachej/boring-ui/pull/1393) (OPEN) leaves it
  unchanged. Correcting the brief: the "conversation-kind-agnostic row model" is **not yet built**.
  #1393 adds `AppLeftPaneConsoleSpike`, `AppLeftPaneConsoleSpikeView = "recent" | "project" | "agent"`,
  `ConsoleSpikeRowSlots { leadingBadge?, metaTag? }` and `AppSessionRowAffordances` — the seams.
- Events stream as NDJSON at `GET /api/v1/agents/:agentTypeId/sessions/:sessionId/events`
  (`agent-host/httpProjection.ts:402`), cursor = `seq`. `AgentSessionConnection` is a **server-side**
  object (`shared/gateway/types.ts:196-204`) — round 1 wrongly implied a front-end client existed.
- `AskUserQuestion` is keyed by `sessionId` alone (`plugins/ask-user/src/shared/types.ts:113-127`),
  pending state published as `AskUserPendingState { hint, hintsBySession }`
  (`askUserStatePublisher.ts:6-21`).

### Delta

- **Merged timeline** = posts (§2) ordered by `(threadTurnId, seq)` from §3, each tagged with its
  participant's role and `agentTypeId`. Drill-down links each block to its origin session.
- **ask-user join uses the full triple, not bare `sessionId`.** Round 1 joined on `sessionId` alone;
  gateway session identity is scoped by `agentTypeId`, so equal ids under two agents could answer the
  wrong participant's question. v0 matches
  `(workspaceScopeId, agentTypeId, sessionId)` against `participants[].conversation` and ignores any
  hint it cannot resolve to exactly one participant. **No ask-user change** is still required — the
  answer routes through the existing `ask-user.v1.answer` bridge op and its `answerToken`
  (`askUserRuntime.ts:160-177`).

### Level D honesty

Round 1 called enabling `BORING_CHAT_DURABLE_STREAM` "Level D activation". Withdrawn — **the flag is
not conformance**. It installs a SQLite event store (`buildAgentComposition.ts:30-43`), while every
Level D conformance test is `it.skip` and owner-annotated to the streaming lane
(`agent-host/testing/gatewayConformance.ts:624-628`).

What Level B *can* do: bounded in-process replay plus snapshot rehydrate; a cursor older than the
window or from before a restart yields `REPLAY_GAP`/`CURSOR_AHEAD` and the client refetches — *"never
a silent gap"* (`AGENT_GATEWAY_V0.md:116-124`). **v0 ships against Level B**, and that is sufficient
because §3's receipts — not the event stream — own cross-seat causality and ordering; a refetch
rebuilds seat content while `threadTurnId` preserves the merge.

The one property Level B cannot reconstruct is **per-seat intra-turn event history across a host
restart**: after a restart the timeline can show settled posts (from receipts + snapshot) but cannot
replay the streaming detail of a turn that was in flight. v0 accepts that and renders such a turn
from its snapshot. Whether to complete Level D is owner question Q7, not a claim this plan makes.

## 5. K7 demo — "grow audience X→Y"

### Today

`Objective { id, title, objective, metric, baseline, target, current, status, constraints,
evidenceRefs, outcome, ... }` (PR [#1382](https://github.com/hachej/boring-ui/pull/1382), **OPEN**;
`plugins/objectives/src/shared/types.ts:10-27`) already has the exact K7 shape, persisted to
`.boring/objectives.json` by `FileObjectiveStore` (`objectiveStore.ts:58`) with versioned state, a
lock sidecar, and atomic tmp-rename — the template §1's store clones. It has **no** session, thread,
or run ref; the only outbound seam is the free-string `evidenceRefs: string[]`.

### Delta — fixture-driven, with a labelled live smoke

**Acceptance is fixture-driven.** Round 1 called a live-model run "deterministic". It is not: nothing
guarantees the worker emits the handoff, the reviewer replies, or `update_objective` is ever called.
v0 acceptance runs a **scripted model adapter** emitting a fixed event script, asserting exact
`threadTurnId` sequence, handoff edges, cap outcomes, and final Objective state. A **live-model
walkthrough** is kept as an explicitly **non-deterministic smoke check**, never as a gate.

Scripted path (two fleet agents, `creator-growth-worker` / `creator-growth-reviewer`, plus the relay):

1. Owner creates the job *"Grow audience 1,200 → 5,000"* → `create_objective` (metric `followers`,
   baseline 1200, target 5000), then one session per `agentTypeId`.
2. Owner posts one message to the job. Unaddressed → the worker participant.
3. Worker drafts, calls `handoff({to:"reviewer"})`. Relay cross-posts the final assistant message.
   Hop 1.
4. Reviewer critiques, calls `handoff({to:"worker"})`. Hop 2.
5. Worker revises, calls `ask_user` to approve the terminal action. The gate renders on the job with
   participant attribution and in the Inbox; the chain suspends.
6. Owner approves → worker calls `update_objective` → `chainState: "completed"`. Cap (3) never hit.

**Objective coupling is one-way and compensated.** The job points at `objectiveId`; `Objective` gains
no `threadId`, so PR #1382 is untouched. Creation is two writes (Objective, then projection record),
so it uses `clientRequestId` for the Objective (`types.ts:40`, "a retried create with the same key
returns the original objective") and, if the projection write fails, retries against the same key
rather than orphaning a second Objective. Whether an Objective is **mandatory** is owner question Q5.

**What the owner sees**: one job row with participant chips; one merged timeline where every block
names its participant; one inline approval; one Objective whose `current` moved. Sessions appear only
on drill-down.

## 6. Non-goals for v0 (explicit)

1. **No shared runtime transcript.** Participants keep private Pi sessions; the timeline is a
   projection. No "room" object.
2. **No native in-process agent-to-agent binding** — available and ratified (D24, `:364`), chosen
   against for v0 (Q2), not forbidden. No external A2A either (D25, `:413`).
3. **No canonical Thread or Seat identity minted.** `participantId` is a display handle (§8).
4. **More than 2 working participants**; parallel same-brief mode; cross-Workspace jobs (all
   participants share one `workspaceScopeId`, per `plan.md:211-213`).
5. **"Channels" in the transport sense.** No Slack/CLI ingress binds to a job.
6. **No Console collection integration** and no `AutomationGroup` (§7 gate note).
7. **No per-Thread budget** (§3) and **no context summarization** — oldest-first truncation only.
8. **No Level D claim** (§4).

## 7. Slices

Ordering lives here and nowhere else. **The real critical path is open PRs**, not the #1355 gate:
#1401 (naming ratification) and #1382 (objectives) block v0 content; #1393 blocks only the deferred
Console item. **Gate G** = #1355 Gate 1 architecture approval (`docs/issues/1355/plan.md:372-376`,
*"No implementation bead is ready before it"*), still unanswered — it binds **only** the deferred
follow-on, because v0 touches no Console store. Each slice is one session and follows the #1355 bead
idiom (`plan.md:378-417`).

**S1 — projection contract + store.** `JobProjectionV0`, `JobParticipantV0`, `JobRelayReceiptV0`
schemas; file store with revision CAS, lock, atomic rename, load diagnostics. No relay, no UI, no
agent tool.
- *Blocked by:* owner ruling on Q1 (noun); PR #1401 merged.
- *Scope:* `plugins/job-threads/src/shared/{types,schema}.ts`, `src/server/jobProjectionStore.ts` + tests.
- *Proof:* `pnpm --filter @hachej/boring-job-threads test -- src/server/__tests__/jobProjectionStore.test.ts src/shared/__tests__/schema.test.ts`; `pnpm --filter @hachej/boring-job-threads typecheck`.
- *Negative proof:* a record whose `participantId` collides, or whose CAS revision is stale, is
  rejected rather than merged; `grep -r "seatId\|threadId" plugins/job-threads/src` returns nothing.

**S2 — actor-scoped dispatch + handoff tool.** Relay turn function over `runWithWorkspaceAgent`
(per-invocation `agentTypeId`); `handoff({to, message})` tool registration; receipt written from
`onAccepted` before events are consumed. No chain logic yet.
- *Blocked by:* S1.
- *Scope:* `plugins/job-threads/src/server/{relayTurn,handoffTool}.ts` + tests.
- *Proof:* `pnpm --filter @hachej/boring-job-threads test -- src/server/__tests__/relayTurn.test.ts`; `pnpm lint:invariants`.
- *Negative proof:* the lease-bound capability is not retained past the callback (test asserts use
  after return throws); no `new EmbeddedAgentGateway` anywhere in the plugin.

**S3 — relay state machine.** Chain advance on settled turns, `willRetry` filtering, posts-only
crossing, caps, context bound with truncation marker, and every row of §2's failure table including
restart resume.
- *Blocked by:* S2.
- *Scope:* `plugins/job-threads/src/server/relayChain.ts` + tests (scripted adapter).
- *Proof:* `pnpm --filter @hachej/boring-job-threads test -- src/server/__tests__/relayChain.test.ts`.
- *Negative proof:* a restart mid-chain neither re-sends a dispatched turn nor resets the hop count;
  `willRetry:true` does not advance the chain.

**S4 — front projection.** Merged timeline by `(threadTurnId, seq)` with participant attribution,
ask-user join on the full triple, drill-down links. Plugin panel only — no Console pane changes.
- *Blocked by:* S3.
- *Scope:* `plugins/job-threads/src/front/` + tests.
- *Proof:* `pnpm --filter @hachej/boring-job-threads test -- src/front/__tests__/`.
- *Negative proof:* an ask-user hint whose triple matches no participant renders nowhere and answers
  nothing.

**S5 — K7 demo fixture.** Two-agent fleet, scripted adapter acceptance asserting the §5 sequence,
Objective compensation path, plus a separately-labelled live smoke.
- *Blocked by:* S4; PR #1382 merged.
- *Scope:* demo fleet config + `src/server/__tests__/k7Demo.test.ts`.
- *Proof:* `pnpm --filter @hachej/boring-job-threads test -- src/server/__tests__/k7Demo.test.ts`.
- *Negative proof:* the acceptance run performs zero live model calls; a failed projection write
  after `create_objective` leaves exactly one Objective on retry.

**Deferred follow-on (not v0) — Console nav reframe.** Jobs primary, Agents as a directory,
participant chips in `ConsoleSpikeRowSlots.metaTag`, by-agent lens = "jobs this agent participates
in". **Gate G blocked**, depends on #1393, and needs the `ConsoleThreadRefV1` repair below. It does
not depend on S4.

**Filed separately, not a v0 slice:** #1355's `ConsoleThreadRefV1` and its session-tuple unique key
are single-seat by construction and cannot hold a multi-participant job as one row. Per #1401 this
must be repaired **before #1355 implements**, independent of whether v0 ships.

## 8. Audit honesty

`participantId` values minted in this plugin are **temporary display handles**. They are not `seatId`,
not envelope identity, and carry no audit weight: they live in a mutable record, and membership edits
or deletion can change or destroy them retroactively. Round 1's claim that per-Run `seatId` gives
"the same audit story from the envelope" is **withdrawn** — no seat attribution exists in the envelope
(`agent-host/types.ts:47-57`), and ratified P0 puts `seatId` in C7 (`RECONCILIATION.md:150-155`).

Two principals must not be conflated. The **authorization principal** for every relay send is the
owner's `authSubjectId` — correct, and enforced: the lease rejects a mismatch between the verified
claim and the request context (`workspaceAgentLease.ts:97-102`). The **causal initiator** may be the
human (a posted message) or the relay (a handoff). v0 records the distinction in
`JobRelayReceiptV0.sourceRef`/`handoffEdge` and renders it, matching D24's ratified audit model:
*"the principal is the originating user/workspace, with the acting agent recorded as actor in
provenance"* (`docs/DECISIONS.md:365`). Envelope-grade attribution arrives with C7, not with v0.

## 9. Owner questions

1. **The noun.** Q1-A projection descriptor with a distinct noun (`JobProjectionV0`, recommended,
   R-c untouched) or Q1-B canonical multi-seat Thread (better end state; costs an R-c amendment, C7
   Thread ownership, seatId-in-C7 pulled forward, and a #1355 ref rework)?
2. **Relay vs native binding.** D24 (`:364`) ratifies a native in-process agent-to-agent binding with
   `input-required`. v0 proposes the relay (no agent-facing capability, deletable, caps centrally
   enforced). Confirm the relay for v0, or build the ratified binding instead?
3. **Attribution grade.** Accept explicitly display-grade `participantId` for v0, or pull ratified
   C7 `seatId` forward now so the demo's audit story is envelope-grade?
4. **Post/Run boundary.** Confirm only settled final assistant posts + relay system markers cross
   seats — no tool calls, no intermediate messages?
5. **Objective coupling.** Is an Objective **mandatory** for a job? Confirm one-way ref with
   `clientRequestId` compensation, or should `Objective` gain a `threadId`?
6. **Context and budget.** Confirm oldest-first truncation with no summarization, and confirm that
   per-Thread *spend* is out of v0 (it needs a job dimension on `MeteringRunScope`, §3)?
7. **Level D.** v0 ships against Level B with the §4 limitation accepted. Complete Level D
   conformance (streaming lane #1009) now, or defer?
8. **Acceptance bar.** Confirm fixture-driven acceptance as the gate, with the live-model walkthrough
   labelled a non-deterministic smoke check?
