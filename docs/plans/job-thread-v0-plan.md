---
title: Job Thread v0 — 1 Thread = 1 job
state: draft
issue: 1399
review: pending cross-model review; no implementation before it
---

# Job Thread v0 — multi-seat Thread projection, K7 demo

**Concept** (owner, [#1399](https://github.com/hachej/boring-ui/issues/1399)): the Thread is the unit
of WORK, not of agent. The human talks to the job; staffing collapses behind one merged timeline, and
per-agent sessions demote to drill-down provenance — CI logs behind a PR check. Convergence:
**1 Thread = 1 job = 1 Objective**, staffed by Seats.

**Naming is ratified, not free**: *multi-seat Thread* / *Job Thread*, never "channel" — `channel` is
reserved for transport/ingress (C5 "channel-answerable", Track C, Slack/CLI). See #1399's
reconciliation comment and PR [#1401](https://github.com/hachej/boring-ui/pull/1401) (open), which
appends to `RECONCILIATION.md` §7 and `VISION.md` R-c: *"A Thread may span multiple Seats, projected
as one timeline; one Thread per job."*

**Hard constraint (v0)**: no A2A loopback — agents never call agents. An **orchestrator seat**, an
ordinary in-process gateway client and not an agent, relays between per-agent sessions; the Thread
timeline is a **projection** merging per-session Runs. Decision 28 (`docs/DECISIONS.md:461`) defers
A2A and v0 does not reopen it. Ordering and dependencies live only in §6; §§1–5 describe shape.

## 1. Data — what a Job Thread record is, and where it lives

### Today

- **No Thread noun exists in code.** `ConversationRef|threadId|ThreadRef` and
  `ConsoleCollection|ConsoleThreadRefV1|AutomationGroup` → 0 hits across `packages/ plugins/ apps/`.
- The only shipped conversation address is `AgentSessionRef { agentTypeId, sessionId }`
  (`packages/agent/src/shared/gateway/types.ts:54-57`), deliberately carrying no `hostId`
  (Decision 29, `docs/DECISIONS.md:471`). Real identity is the triple
  `(workspaceScopeId, agentTypeId, sessionId)` — `agent-host/agentSessionKey.ts:3`.
- The 1355 Console plan (merged to main as `docs/issues/1355/plan.md`, PR #1356) proposes
  `ConsoleThreadRefV1 { workspaceScopeId, agentTypeId, sessionId }` (`plan.md:74-78`), persisted in
  `ConsoleCollectionThreadAssignment` under a unique key
  `(appId, principalId, workspaceScopeId, agentTypeId, sessionId)` (`plan.md:102-104`).
  **Single-seat by construction**: one Thread = one session tuple.
- Run identity: the ratified `RunId := RequestKey` ships as `AgentRequestKey
  { workspaceScopeId, authSubjectId, operation, target, requestId }` (`agent-host/types.ts:51-57`),
  durably ledgered by `SqliteAgentRequestLedger` (`sqliteRequestLedger.ts:39`) at
  `.agent-request-ledger.sqlite` (`createAgentHost.ts:291`).
- **`seatId` does not exist anywhere in code**, and `trajectory` → 0 occurrences repo-wide. The
  spine (`runId·agentId·digest·seatId·cost·outcome`, `VISION.md:37`, `RECONCILIATION.md:137`) and
  `Seat { seatId; workspaceId; agentId; role?; budget?; permissions?; bindingState }`
  (`V2-IMPLEMENTATION-SPEC.md:119`) are doc-only — 1355 says so itself: *"C7 SessionCatalog and
  full Seat projection are target architecture, not current prior art"* (`plan.md:163-165`). The
  `seat: string` in `loadConfiguredAgentFleet.ts:28` is an unrelated fleet.yaml field, explicitly
  warned about at `agent-host/types.ts:148-149`.
- Objectives (PR [#1382](https://github.com/hachej/boring-ui/pull/1382), **OPEN, not merged**)
  persist `Objective { id, title, objective, metric, baseline, target, current, status,
  constraints, evidenceRefs, outcome, ... }` (`plugins/objectives/src/shared/types.ts:10-27`) to
  `.boring/objectives.json` via `FileObjectiveStore` (`objectiveStore.ts:58`) — versioned, lock
  sidecar, atomic tmp-rename. **No session/thread/run ref field**; the only outbound seam is the
  free-string `evidenceRefs: string[]`.

### Delta

The smallest honest record — `objectiveId` and `seats` carry the whole concept:

```ts
interface JobThreadV0 {
  id: string                       // `jth-<uuid>`
  title: string
  objectiveId?: string             // one-way ref into the objectives plugin; objectives unchanged
  seats: JobThreadSeatV0[]         // v0: exactly 2 working seats (worker, reviewer) — see §5
  createdAt: string; updatedAt: string; revision: number
}
interface JobThreadSeatV0 {
  seatId: string                   // FIRST real seatId in the codebase
  role: "orchestrator" | "worker" | "reviewer"
  conversation: ConsoleThreadRefV1 // { workspaceScopeId, agentTypeId, sessionId }
}
```

- **A Job Thread is a typed conversation *ref set* plus a role per ref.** It owns no transcript,
  authority, or runtime, and each `conversation` is independently authorized on every read/write —
  the 1355 rule that a collection "does not own a Thread record ... those domains expose
  independently authorized references" (`plan.md:89-93`).
- **Per-Run seat attribution**: the join is `seatId × AgentRequestKey`. The honest v0 move is *not*
  to widen `AgentRequestKey` (P0 host work, `RECONCILIATION.md:153` "seatId in C7") but to **derive**
  it: a `AgentRequestKey.target` of `{kind:'session', ref}` resolves to exactly one seat within a
  Thread, so `runId → seatId` is a lookup over the ref set. v0 stores nothing extra. Promotion
  trigger for a stored seatId: a second Thread sharing one session.
- **Durable home**: a `plugins/job-threads/` file store cloned from `FileObjectiveStore` —
  `.boring/job-threads.json`, same versioned + lock + atomic-rename pattern. Why not the 1355
  Console store: its hosted persistence is `packages/core/src/server/db/stores/consoleCollectionStore`
  (Postgres, `plan.md:512-519`) and is **gate-blocked** — Gate 1 (`plan.md:372-376`, *"No
  implementation bead is ready before it"*) is unanswered, all 21 beads `status: open`. A plugin file
  store needs no Core migration, no principal-ownership contract, and is deletable.
- **The conflict to surface for 1355** (the hook PR #1401 names): `ConsoleThreadRefV1`'s unique key
  is the session 5-tuple, so a Console collection cannot hold a multi-seat Thread as one row. Minimal
  repair: an assignment's subject becomes `jobThreadId` *or* a session tuple. That is a **1355
  amendment, not a v0 slice** — v0 ships without Console collection integration.

## 2. Mechanism — the orchestrator relay

### Today

- `EmbeddedAgentGateway` (`agent-host/embeddedGateway.ts:126`) is exported from
  `packages/agent/src/server/index.ts:178`. Holding it plus one `AuthorizedAgentScope`, an in-process
  caller can `connectSession` on **any** `(agentTypeId, sessionId)` it is authorized for and `send()`
  on the returned `AgentSessionConnection` (`shared/gateway/types.ts:196-204`: `events`, `send`,
  `interrupt`, `stop`, `clearQueue`, `close`). **Nothing forces one sender per session.** The
  orchestrator seat needs no new machinery.
- The two existing programmatic drivers are **unusable** for relay: `runWithWorkspaceAgentLease`
  (`workspaceAgentLease.ts:87`) and `createBoundWorkspaceAgentDispatcher`
  (`server/workspaceAgentDispatcher.ts:92`) are each bound to a single `agentTypeId`
  (`WorkspaceAgentGatewayBinding {gateway, scope, agentTypeId}`, `shared/workspaceAgentDispatcher.ts:68-72`).
- There is **no actor identity below the auth subject** — `AuthorizedAgentScope
  { workspaceScopeId, authSubjectId }` (`shared/gateway/types.ts:44-48`) is all the model carries, so
  the orchestrator acts *as the human's auth subject*. Correct: it is a client, not an agent, and
  cannot mint authority (invariant 7, `VISION.md`).
- Cost bounds are per-run and metering-local: reservations key on
  `runId = pi-run:${sessionId}:prompt:${clientNonce}` (`pi-chat/metering.ts:197-202`). **No
  per-Thread budget exists today.**

### Delta

An `OrchestratorRelay` in the job-threads plugin server: a plain class holding
`{ gateway, scope, thread }`, no agent, no LLM.

1. **Trigger**: a human message posted to the Thread, or a seat's Run reaching terminal state
   (`agent-end` on that seat's `AgentSessionEvent` stream — the same signal
   `AgentSessionActivityIndex` already consumes, `sessionInventory.ts:138-142`).
2. **Fan-out of a human message**: addressing-gated (below). Unaddressed → the Thread's default
   worker seat. Addressed → `connectSession` on that seat's ref and `send` the projected Thread
   history since that seat's last turn, plus the new message.
3. **Handoff**: when a seat's Run ends with an addressed handoff, the relay cross-posts that seat's
   final message into the addressed seat's session as an attributed quote. **The relay is the only
   writer**; neither seat has a tool that reaches the other.
4. **Cost bounds**, enforced centrally in the relay and never in agent instructions:
   `maxHandoffDepth` (default 3) and `maxSeatInvocations` per human turn, plus a per-Thread budget
   hook in front of the existing reservation path (`metering.ts`). Exceeding a cap posts a terminal
   system event on the Thread and stops — it does not silently truncate.

#### Turn policy — prior art: Buzz by Block

[Buzz](https://block.xyz/) (Block, July 2026) is an @-mention-gated agent group chat on Nostr, and
is the closest shipped prior art. What we adopt and what we fix:

- **Addressing-gated turns.** A seat responds only when explicitly addressed — by the human, or by
  another seat's relayed handoff. No ambient reactions, no router model in v0. Buzz's proven
  anti-noise mechanism, and it maps one-to-one onto our per-`agentTypeId` session addressing
  (`/api/v1/agents/:agentTypeId/sessions/...`, `httpProjection.ts:221-582`).
- **Loop safety — Buzz's documented gap; do not repeat it.** Buzz leaves stopping conditions to
  agent authors, and mention loops are a real failure mode. v0 enforces the §2.4 caps centrally.
- **Transcript model.** One full shared timeline visible to all seats (Buzz-validated); each seat's
  private session receives the projected history on its turn. **Attribution is free for us**: Buzz
  needs signed per-agent Nostr identities, while per-Run `seatId` over the request ledger gives the
  same audit story from the envelope rather than from cryptography.
- **Human role.** Approver of terminal actions, not a participant in every turn — Buzz's "steer or
  approve" is our Inbox Human Intentions surface. A convergence to cite, not a mode to invent.
- **Modes.** Sequential handoff and parallel same-brief are distinct explicit modes (Buzz supports
  both). **v0 ships handoff only**; parallel is v1 and its mechanism already has a name — 1355's
  `AutomationGroup` fan-out (`plan.md:253-279`), each target getting its own Thread, Run, receipt.
- **Posture.** Buzz (shared thread, mixed trust, signed identity) vs Grok Bot (single-owner private
  fleet, internal handoffs): our product spans both, so we adopt Buzz's audit/identity posture even
  while v0 runs a single-owner fleet.

#### ask-user gates on the Thread

Today: `AskUserQuestion { questionId, sessionId, ownerPrincipalId, status, schema, answerToken, ...}`
(`plugins/ask-user/src/shared/types.ts:113-127`) is keyed by **`sessionId` only** — no `agentTypeId`,
no thread — with one pending question per session (`getPending(sessionId)` is singular,
`askUserStore.ts:28`). Pending state reaches the UI as
`AskUserPendingState { hint, hintsBySession }` (`askUserStatePublisher.ts:6-21`); the Inbox left-pane
action already exists (`plugins/ask-user/src/front/index.tsx:239-251`).

Delta: **no ask-user change.** The Thread projection joins `hintsBySession` against the ref set
(`sessionId ∈ thread.seats[].conversation.sessionId`) and renders the question inline with its seat's
attribution; answering still routes through `ask-user.v1.answer` and its `answerToken` capability
(`askUserRuntime.ts:160-177`). The relay treats a seat blocked on `ask_user` as *not* a terminal Run,
and does not advance the handoff chain.

## 3. Projection — the merged timeline

### Today

- The left-pane row model is `AppLeftPaneSession { id, agentTypeId?, title?, updatedAt?, turnCount?,
  nativeSessionId?, hasAssistantReply?, ephemeral?, status? }`
  (`packages/workspace/src/front/layout/plugin-tabs/AppLeftPane.tsx:17-27`) — **session-shaped, with
  no `kind` discriminator**, and PR [#1393](https://github.com/hachej/boring-ui/pull/1393) (OPEN)
  leaves it byte-for-byte unchanged. Correcting the brief: the "conversation-kind-agnostic row model"
  is **not yet built**. #1393 adds `AppLeftPaneConsoleSpike` with
  `AppLeftPaneConsoleSpikeView = "recent" | "project" | "agent"`,
  `ConsoleSpikeRowSlots { leadingBadge?, metaTag? }` and
  `AppSessionRowAffordances = "default" | "console"` — the seams where it would land.
- Per-session events are `AgentSessionEvent { ref, seq, event }` (`shared/gateway/events.ts:5-9`),
  NDJSON at `GET /api/v1/agents/:agentTypeId/sessions/:sessionId/events` (`httpProjection.ts:402`),
  cursor = `seq`. Transcripts are Pi JSONL under `sessionNamespaceForAgent()`
  (`sessionInventory.ts:13-22`), rooted at `BORING_AGENT_SESSION_ROOT`.
- **Durable replay is opt-in and off**: `BORING_CHAT_DURABLE_STREAM` / `.agent-event-stream.sqlite`
  (`buildAgentComposition.ts:37-40`). Decision 29 shipped Conformance **Level B** and deferred Level
  D because *"durable replay is only load-bearing once concurrent multi-agent streams exist"*
  (`docs/DECISIONS.md:472`). **A Job Thread is exactly that condition arriving** — the single most
  important Today/Delta finding in this plan.

### Delta

- **A Thread view is interleaved Runs with seat attribution.** New: a `useJobThreadTimeline` opening
  one `AgentSessionConnection` per seat ref, merging frames on `(wallclock, seq)` per source and
  tagging each with `seatId` + role. No new transport, no new store — a client-side merge over
  streams that already exist. Cross-session ordering is best-effort and explicitly *not* a total
  order; a system event marks each relayed handoff so the reader has an anchor.
- **Drill-down**: each merged block links to its origin session's own view — the "CI logs behind a
  PR check" affordance from #1399.
- **Left-nav framing (owner direction, 2026-08-24)**: the primary list becomes **Threads (jobs)**;
  **Agents becomes a DIRECTORY entry** (a roster of all agents); and Thread participation is an
  **attribute on the Thread** — the 1..n participant chips rendered in #1393's
  `ConsoleSpikeRowSlots.metaTag` slot. The **by-agent lens then reads as "Threads this agent
  participates in"** (a directory view), *not* a grouping of private sessions. That is a semantic
  change to #1393's `"agent"` view mode, whose `OrganizedSession` grouping assumes one `agentTypeId`
  per row.
- **Level D activation** is the honest prerequisite for a Thread surviving a reload with more than
  one live stream. The v0 demo runs with `BORING_CHAT_DURABLE_STREAM` on; defaulting it is a
  Decision-29 re-evaluation (`docs/DECISIONS.md:474`), out of scope here.

## 4. K7 demo — "grow audience X→Y"

### Today

The pieces exist but have never been composed. `Objective` (PR #1382, open) already has exactly the
right shape for K7 — `metric`, `baseline`, `target`, `current`
(`plugins/objectives/src/shared/types.ts:10-27`), created by the `create_objective` tool and
navigable via the `objective` surface kind. There is no Thread, no second seat, no relay.

### Delta — the scripted deterministic path

Fleet: two `agentTypeId`s in the demo `fleet.yaml` — `creator-growth-worker` and
`creator-growth-reviewer` — plus the orchestrator seat (a client, not a fleet entry).

1. Owner creates a Job Thread *"Grow audience 1,200 → 5,000"*. Creation calls `create_objective`
   once (metric `followers`, baseline 1200, target 5000), stores the returned `obj-<uuid>` as
   `objectiveId`, and `createSession`s one session per `agentTypeId` as the two seats.
2. Owner posts one message to the **Thread**, not to an agent. Unaddressed → relay routes to worker.
3. Worker drafts a growth plan, hands off `@reviewer`; relay cross-posts the draft. Depth = 1.
4. Reviewer returns a critique addressed back to `@worker`. Depth = 2.
5. Worker revises and calls `ask_user` to approve the terminal action (publish / move the
   Objective's `current`). The gate appears **on the Thread** with worker attribution, and in Inbox.
6. Owner approves; worker calls `update_objective`; relay stops. The depth cap (3) is never reached.

**What the owner sees**: one Thread row with two participant chips; one merged timeline where every
block names its seat; one inline approval card; one Objective whose `current` moved. Sessions appear
only on drill-down. No agent-to-agent call exists anywhere in the request ledger — every send
carries `authSubjectId` = the owner. The demo is scripted (fixed prompts, fixed handoff points, caps
never hit): a *demo path*, not a claim of general multi-agent competence.

## 5. Non-goals for v0 (explicit)

1. **No shared runtime transcript.** Seats keep private Pi JSONL sessions (`sessions.ts:154`); the
   shared timeline is a projection only. No "room" object.
2. **No A2A activation.** No agent-callable tool reaches another agent. Decision 28 defers A2A
   (`docs/DECISIONS.md:461`); PR #1401's amendment states the non-change explicitly.
3. **More than 2 working seats.** v0 is worker + reviewer + orchestrator; a third seat is a v1
   routing question, not a mechanism question.
4. **"Channels" in the transport sense.** No Slack/CLI/Nostr ingress binds to a Thread; `channel`
   stays reserved for C5 channel-answerable / Track C.
5. **Console collection integration** — no `ConsoleCollection`, Postgres store, or
   `AutomationGroup`; gate-blocked (§1).
6. **A durable `seatId` on the request ledger** — derived in v0 (§1).
7. **Parallel same-brief mode.** Handoff only (§2).
8. **Cross-Workspace Threads.** All seats share one `workspaceScopeId`, matching 1355's rule that
   cross-Workspace transfer is a separate protocol (`plan.md:211-213`).

## 6. Slices

Ordering lives here and nowhere else. **Gate G** = 1355 Gate 1 architecture approval
(`docs/issues/1355/plan.md:372-376`, *"No implementation bead is ready before it"*), currently
**unanswered** — all 21 `wt-391-forward-gh-1355-persistent-console-q9ba` beads are `status: open`.
**Gate R** = owner merge of PR #1401 (the ratification of "one Thread per job").

| # | Slice | Depends on | Gate |
| --- | --- | --- | --- |
| S1 | `plugins/job-threads` record + file store (`JobThreadV0`, `JobThreadSeatV0`, `.boring/job-threads.json`), cloned from `FileObjectiveStore`; bridge ops + schema; no UI | PR #1382 merged (for `objectiveId` to mean anything) | **Gate R** only — free of G |
| S2 | `OrchestratorRelay`: multi-`agentTypeId` client over `EmbeddedAgentGateway`, addressing-gated turn policy, central depth/invocation caps, handoff cross-post. Server-only, driven by tests | S1 | free |
| S3 | Thread timeline projection: multi-connection merge with `seatId` attribution, ask-user join over `hintsBySession`, drill-down links. Requires `BORING_CHAT_DURABLE_STREAM` on | S2 | free |
| S4 | Left-nav reframe: Threads primary, Agents as directory, participant chips in `ConsoleSpikeRowSlots.metaTag`, by-agent lens = "Threads this agent participates in" | S3, PR #1393 | **Gate G** — touches the Console pane contract |
| S5 | K7 demo composition: two-agent fleet, scripted path, owner-facing walkthrough | S3 (S4 optional for the demo) | free if run on the playground route; **Gate G** if it ships in the Console |

S1–S3 and S5 are deliverable without the 1355 decision — they add a plugin and a projection, touching
no Console store and no Core migration. Only S4 negotiates the Console contract, carrying §1's
`ConsoleThreadRefV1` repair: file that as a 1355 amendment before S4 starts.

## Open questions for the owner

1. **Derived vs stored `seatId`** (§1): accept the deferral, or pull "seatId in C7"
   (`RECONCILIATION.md:153`) forward into v0?
2. **Level D**: the Thread projection is the first genuine multi-stream consumer — the exact
   re-evaluation trigger Decision 29 names (`docs/DECISIONS.md:474`). Flip
   `BORING_CHAT_DURABLE_STREAM` default-on, or keep v0 behind the flag?
3. **`ConsoleThreadRefV1` repair**: amend 1355 now (assignment subject becomes `jobThreadId` or a
   session tuple), or ship v0 Console-less and amend later?
4. **Objective coupling direction**: v0 points Thread → Objective one-way, leaving PR #1382
   untouched. Acceptable, or should `Objective` gain a `threadId`?
5. **Orchestrator identity**: the relay acts as the owner's `authSubjectId`, so every relayed send is
   attributed to the human in the request ledger. Correct — it *is* the human's client — or does the
   audit story need a distinct non-agent principal?
