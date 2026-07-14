# AC1-D — in-process subagent dispatcher micro-spec

Status: **Accepted — AC1-D dispatchable.** This is the dispatch gate named by
bead `wt-391-forward-17q` (AC1-D-SPEC); its acceptance unblocks
`wt-391-forward-wrr` (AC1-D dispatcher). It settles the eight required
decisions. Dispatcher code may now land against this spec.

## Owner ratification (2026-07-14)

The owner ratified all four `OWNER-DECISION` callouts in §12 as written in the
draft. Recorded verbatim:

1. **Durability (§6, §12.2).** Confirmed: a **durable** narrow
   `SubagentTaskRecord` in the existing `agent.db` store (no new store) for
   `{state, deadline, chain, idempotencyKey}`, plus reuse of the existing T1
   durable event store for the conversational transcript, plus a boot-recovery
   scan/timeout sweep on restart. The owner reviewed the in-memory-only
   alternative and kept durability as mandatory — best-effort in-memory state
   is rejected.
2. **Sequencing (§12.1).** Confirmed: **subagent mode (AC1-D) ships BEFORE
   contracted mode (AC1-M).** Contracted mode is a decorator layered on top of
   this pipeline per Decision 22 and stays blocked on `wrr`, not the reverse.
3. **B-failure surfacing (§12.4).** Confirmed: B's failure returns a
   **structured** `{ status: 'failed', code: AGENT_CONSUMPTION_SUBAGENT_FAILED }`
   `SubagentTurnResult` to A's tool call. A decides what to do with the
   failure. No throw-through that faults A's own turn.
4. **Guard override surface (§12.3).** **Deferred.** Platform defaults
   (`maxDepth = 3`, `inputRequiredTimeoutMs = 24h`) stand as-is for AC1-D; no
   per-`AgentDefinition` override plumbing is built until a consumer needs it.
   `ConsumptionGuards` continues to be passed in per-invoke exactly as this
   spec defines; only the "override authored on the `AgentDefinition` itself"
   path is out of scope for this bead.

All four rulings match this spec's own recommendation; no body text changed
as a result of ratification — only this section and the status line were
added.

> Phase: Phase AC1 — agent consumption contract (issue #636)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md)
> Binding decisions: [DECISIONS.md](../../../../DECISIONS.md) #21, #22, #23
> Binding contract: [IMPLEMENTATION-GUARDRAILS.md](../../IMPLEMENTATION-GUARDRAILS.md) AC1 section
> Consumed types (merged, AC1-T2, PR #657): `packages/agent/src/shared/agent-consumption.ts`
> Authoritative path: `docs/issues/391/runtime-refactor/work/AC1-agent-consumption-contract/AC1-D-SPEC.md`

## 1. Decision and scope

AC1-D delivers **one** in-process dispatcher for **SUBAGENT mode** (Decision 22
mode (a)): agent A, mid-turn, delegates a task to agent B, and **B runs inside
A's workspace with full shared context**. It is the native in-process binding
of the one consumption contract — no MCP loopback, no serialization, no wire
transport. It reuses, and does not reinvent: the merged AgentTask v2 contract +
guards (AC1-T2), the P6-R deployment resolver (`resolveAgentDeployment`), the pi
session machinery (`AgentCoreSessionService`), and the T1 durable pi-chat event
store.

**This spec settles the dispatcher's API, ownership mapping, correlation,
durability seam, audit model, error codes, target files, and proof matrix. It
writes no implementation code.** Contracted/SERVICE mode (Decision 22 mode (b))
is explicitly out of scope and, per Decision 22, ships LATER as a decorator
layered on this same pipeline (AC1-M, bead `kon`) — never a forked path.

### 1.1 What settles here vs what a later bead settles

Settled here: the dispatcher public seam, task↔session ownership, the durable
task record shape and recovery semantics, the audit event shape, the AC1-D
error codes, the file targets, and the acceptance/proof matrix. NOT settled
here: governed projection (AC1-P / bead `7t6`), contracted mode + metering
(AC1-M / bead `kon`), engagement data hygiene (AC1-H / bead `psc`), and any
cross-workspace artifact transfer (AR1 Lane X).

## 2. Decisions table

| # | Question | Ruling |
|---|---|---|
| 1 | Dispatcher API surface | `SubagentDispatcher` with two methods: `invoke(input)` and `respond(input)`, each returning a `SubagentTurnResult` discriminated union. A thin call over the AgentTask contract; resolves B via P6-R; binds B to the CALLER's workspace. §3. |
| 2 | Task ↔ pi-session ownership | B gets its OWN fresh pi session, scoped to the caller's `workspaceId`. 1:1 `taskId ↔ sessionId`. Parented by shared `contextId` + `parentTaskId`. §4. |
| 3 | input-required correlation | Same `taskId`/`contextId` throughout. B's pi-session `input-required` pauses the task and returns synchronously to A's tool call; A answers via `respond({ taskId, ... })`, routed to B's session as a follow-up; `input-required → working`. §5. |
| 4 | Restart/timeout persistence | Durability REQUIRED (owner-ratified 2026-07-14). Narrow durable task record in the existing `agent.db` store for `{state, deadline, chain, idempotencyKey}`; conversational turns ride the existing T1 pi-chat event store. Live waiter timer is ephemeral, re-armed by a boot recovery scan. §6. |
| 5 | Audit events | On every task-state transition emit an audit record: `principal` = A's originating user+workspace (never B's), `actor` = B's `AgentRef`, plus `chain`, `taskId`, `contextId`, `parentTaskId`, `from`/`to`, optional `code`, `ts`. Reuses the existing structured-log/event sink (`ErrorLogFields` precedent); no new audit store. §7. |
| 6 | Stable error codes | Reuse `AGENT_CONSUMPTION_DEPTH_EXCEEDED`, `AGENT_CONSUMPTION_CYCLE_DETECTED` (already merged). Add three to the scoped `AgentConsumptionErrorCode` enum (#647 precedent): `AGENT_CONSUMPTION_SUBAGENT_RESOLVE_FAILED`, `AGENT_CONSUMPTION_INPUT_REQUIRED_TIMEOUT`, `AGENT_CONSUMPTION_SUBAGENT_FAILED`. §8. |
| 7 | Target files | New `packages/agent/src/server/consumption/{subagentDispatcher,subagentTaskStore,subagentRecovery}.ts` + a pi tool-factory entry `delegateToSubagent`; touch `shared/error-codes.ts`. Reuse P6-R resolver, `AgentCoreSessionService`, T1 event store. §9. |
| 8 | Proof matrix | Unit at the dispatcher/guard seam + integration/e2e for the delegate→input-required→answer→artifacts flow, depth-4 refusal, A→B→A cycle refusal, 24h timeout→canceled, and restart recovery. §10. |

## 3. Decision 1 — Dispatcher API surface

The tool-layer (a pi tool B... i.e. a tool A's harness exposes) calls exactly
this seam. No other surface may invoke a subagent.

```ts
// packages/agent/src/server/consumption/subagentDispatcher.ts
import type {
  AgentMessage, AgentRef, AgentTask, ArtifactRef,
  ConsumptionGuards, PrincipalRef,
} from '../../shared/agent-consumption'

/** Everything needed to start a subagent turn. */
export interface SubagentInvokeInput {
  /** Agent B to resolve via P6-R (resolveAgentDeployment). */
  readonly target: AgentRef
  /** The task/instructions A sends to B (typed parts; role 'consumer'). */
  readonly message: AgentMessage
  /** Who is asking + ancestry, for binding, audit, and guards. */
  readonly caller: {
    /** Originating user + workspace. B binds to THIS workspace (subagent). */
    readonly principal: PrincipalRef
    /** Delegation ancestry INCLUDING A. Depth = chain.length; next hop = B. */
    readonly chain: readonly AgentRef[]
    /** Parent task/conversation, when A itself runs under a task. */
    readonly parentTaskId?: string
    readonly parentContextId?: string
  }
  /** Effective guards (platform defaults; consumers may tighten). */
  readonly guards: ConsumptionGuards
  /** Idempotency key so a retried tool call re-attaches, never double-spawns. */
  readonly idempotencyKey: string
}

/** Answer B's input-required. */
export interface SubagentRespondInput {
  readonly taskId: string
  readonly message: AgentMessage // role 'consumer'
  readonly caller: Pick<SubagentInvokeInput['caller'], 'principal'>
}

export type SubagentTurnResult =
  | { readonly status: 'input-required'; readonly task: AgentTask; readonly prompt: AgentMessage }
  | { readonly status: 'completed'; readonly task: AgentTask; readonly artifacts: readonly ArtifactRef[] }
  | { readonly status: 'failed'; readonly task: AgentTask; readonly code: AgentConsumptionErrorCode; readonly message: string }
  | { readonly status: 'canceled'; readonly task: AgentTask; readonly code: AgentConsumptionErrorCode; readonly reason: 'input-required-timeout' | 'restart' }

export interface SubagentDispatcher {
  invoke(input: SubagentInvokeInput): Promise<SubagentTurnResult>
  respond(input: SubagentRespondInput): Promise<SubagentTurnResult>
}
```

**Binding is the whole ballgame.** `invoke` resolves B by calling
`resolveAgentDeployment(bundleForB, deploymentForB, authorizedBinding)` where
`authorizedBinding.workspaceId === input.caller.principal.workspaceId`. That
single parameter — the caller's workspace as B's binding — is what makes this
SUBAGENT mode. Contracted mode (later) passes B's OWN workspace instead; nothing
else in this pipeline changes (Decision 22 layering constraint). Resolver failure
→ `AGENT_CONSUMPTION_SUBAGENT_RESOLVE_FAILED`.

**Guard order in `invoke`, before any session is created** (all from the merged
contract, pure validators):
1. `assertWithinConsumptionDepth(chain, guards)` → `AGENT_CONSUMPTION_DEPTH_EXCEEDED`.
2. `assertNoConsumptionCycle(chain, target)` → `AGENT_CONSUMPTION_CYCLE_DETECTED`
   (full-ancestry, catches A→B→A).
3. Resolve B (P6-R). 4. Mint/attach task by `idempotencyKey`. 5. Create session.

The returned `AgentTask.actor` is B's `AgentRef`; `AgentTask.principal` is A's
`PrincipalRef`. The tool result A sees is the `SubagentTurnResult` — A never
sees B's session id or any raw path (only `ArtifactRef`/`WorkspaceFileLocator`,
per AC1-T2).

## 4. Decision 2 — Task ↔ pi-session ownership/mapping

- **B gets its OWN pi session.** `invoke` calls
  `service.createSession(ctx, init)` with `ctx.workspaceId = caller.principal.workspaceId`.
  This is the loop engine; the dispatcher does NOT reimplement turn execution.
- **1:1 mapping.** The durable task record (§6) stores `taskId ↔ sessionId`.
  A's tool re-entry (`respond`, retries) always resolves the session through the
  task, never a raw session id.
- **Parenting.** The subagent task's `contextId` = `caller.parentContextId` when
  present (B's turns join A's conversation for inspection/audit), else a fresh
  contextId minted from the parent task. `parentTaskId` is recorded on the
  durable record (not a contract field; kept in the store + audit).
- **Lifecycle = task lifecycle.** Task terminal states drive session teardown:
  on `completed`/`failed`/`canceled` the dispatcher disposes/abandons the pi
  session. No orphan sessions.

The pi session is reused wholesale for streaming, follow-ups, interrupts, and
metering; the dispatcher is a **thin task-projection + guard + durability layer
over one pi session**, satisfying invariant 9 (file/shell tools still flow
through pi factories + Operations adapters — the dispatcher adds no new tool
runtime).

## 5. Decision 3 — input-required response correlation

The merged TaskState machine already supports `working → input-required → working`
and `input-required → canceled`. Wiring:

1. B's pi session emits an input-required signal (a pi ask/permission/clarify
   event surfaced by the harness). The dispatcher transitions the task
   `working → input-required` (`assertValidTransition`), records B's prompt as an
   `AgentMessage` (role `agent`), writes the durable record with a
   `deadline = now + guards.inputRequiredTimeoutMs`, and returns
   `{ status: 'input-required', task, prompt }` **synchronously** to A's tool call.
2. A (its own turn) reads the prompt, produces an answer, and calls
   `dispatcher.respond({ taskId, message, caller })`. The dispatcher resolves the
   session via the task record, asserts the caller principal matches the task
   principal, transitions `input-required → working`, and forwards the answer to
   B's session as a **follow-up** (`service.followUp` / `prompt` on the same
   `sessionId`). B resumes with full prior context (resumable — the pi session
   was never torn down).
3. Same `taskId`/`contextId` throughout; the answer is correlated by `taskId`
   alone. Answering a task not in `input-required` →
   `AGENT_CONSUMPTION_INVALID_TRANSITION`.

**Synchronous-ish, one workspace.** Because B lives in A's workspace and the
whole exchange is one process, the round-trip is a normal in-process await; the
durable record + deadline exist only to survive an untimely process death (§6),
not to model an async job.

## 6. Decision 4 — Restart/timeout persistence (THE engineering decision)

**Ruling: durability across process restart is REQUIRED, but scoped to a narrow
task record; the conversational transcript reuses the existing T1 store.**
Owner-ratified 2026-07-14 (see "Owner ratification" above): **a narrow durable
record, not best-effort in-memory.**

**Why not best-effort in-memory.** The single hard constraint is the
`input-required` 24h deadline: it outlives any plausible process lifetime, and a
pending question with a 24h answer window MUST still be answerable — and MUST
still auto-cancel on time — after a deploy/restart. In-memory-only state would
silently drop pending delegations on every deploy, and a `setTimeout`-only
deadline dies with the process. So the input-required task state + deadline are
non-negotiably durable. (Contrast contracted mode, AC1-M: it additionally needs
durability for cross-workspace projection + billing and is a longer-lived job —
another reason durability is introduced here once, correctly, and inherited.)

**Why narrow record, not T1 envelopes.** The T1 pi-chat event store is an
append-only per-session stream tuned for ordered event *replay*. The dispatcher
needs an indexed *query*: "all tasks in `input-required` whose `deadline < now`"
for the recovery scan and the timeout sweep. That is a keyed record, not a
stream scan. So:

- **Transcript / turn loop** → the existing T1 durable pi-chat event store
  (already survives restart; `harnessPiChatService` seeds seq from the durable
  tail). No new persistence for conversation.
- **Task control state** → a narrow durable record in the **existing** `agent.db`
  store (no new store — Guardrails: "no persistence beyond existing stores"):

```ts
interface SubagentTaskRecord {
  taskId: string            // primary key; 1:1 with sessionId
  sessionId: string
  contextId: string
  parentTaskId?: string
  state: TaskState          // authority for recovery/timeout
  principal: PrincipalRef   // A's originating user + workspace
  actor: AgentRef           // B
  chain: AgentRef[]         // full ancestry for audit
  deadline?: string         // set iff state === 'input-required'
  idempotencyKey: string    // unique; retried invoke re-attaches
  createdAt: string
  updatedAt: string
}
```

**Live waiter timer is ephemeral.** The in-memory `setTimeout` that fires the
24h cancel is a convenience, never the source of truth; the durable `deadline`
is. On boot a **recovery scan** (`subagentRecovery.ts`) runs once:
- Any `input-required` record with `deadline <= now` → transition to `canceled`
  (`AGENT_CONSUMPTION_INPUT_REQUIRED_TIMEOUT`), emit audit, tear down.
- Any `input-required` record with `deadline > now` → **re-arm** a fresh
  in-memory timer for the remaining window; task stays answerable.
- Any non-terminal record whose pi session cannot be re-attached (process died
  mid-`working`) → **clean cancellation** to `canceled` (reason `restart`,
  `AGENT_CONSUMPTION_SUBAGENT_FAILED` not used here — this is a controlled
  cancel, not a B failure), emit audit. No silent orphan, no auto-resume of an
  interrupted computation.

**Guards (ratified, PLAN.md 2026-07-12; platform defaults, owner-confirmed
deferred override — see §12.3/ratification item 4):** `maxDepth = 3`;
`inputRequiredTimeoutMs = 24h → canceled`; same-pair/full-ancestry cycle
refusal via `detectConsumptionCycle`.

## 7. Decision 5 — Audit events

On **every** task-state transition the dispatcher emits one audit record through
the existing structured-log/event sink (same seam as `ErrorLogFields`; no new
audit platform, no dashboard — P8 guardrail stands):

```ts
interface SubagentAuditEvent {
  kind: 'subagent-transition'
  principal: PrincipalRef  // A's originating user + workspace — WHO ASKED
  actor: AgentRef          // B — WHO DID IT
  chain: AgentRef[]        // full delegation ancestry
  taskId: string
  contextId: string
  parentTaskId?: string
  from: TaskState
  to: TaskState
  code?: AgentConsumptionErrorCode // present on failed/canceled/refused
  ts: string
}
```

Invariant: `principal` is ALWAYS the originating human user + workspace,
recorded unchanged down the whole delegation chain (Decision 22 audit model);
the acting agent is `actor`. Guard refusals (depth/cycle/resolve) that never
create a task emit a single refusal audit event carrying the attempted `target`
+ `chain` + `code`, with no `taskId`.

## 8. Decision 6 — Stable error codes (#647 scoped-enum precedent)

Extend the existing scoped `AgentConsumptionErrorCode` enum in
`shared/error-codes.ts` (do NOT graduate into the global `ErrorCode` registry
until a runtime route surfaces them over an API boundary — same discipline AR1
used for `MCP_AGENT_ARTIFACT_*`).

Reused (already merged): `AGENT_CONSUMPTION_DEPTH_EXCEEDED`,
`AGENT_CONSUMPTION_CYCLE_DETECTED`, `AGENT_CONSUMPTION_INVALID_TRANSITION`.

Added (this bead):
- `AGENT_CONSUMPTION_SUBAGENT_RESOLVE_FAILED` — P6-R could not resolve/bind B
  in the caller's workspace.
- `AGENT_CONSUMPTION_INPUT_REQUIRED_TIMEOUT` — `input-required` deadline elapsed;
  task canceled.
- `AGENT_CONSUMPTION_SUBAGENT_FAILED` — B's turn ended in `failed` (B raised an
  error / the pi session faulted). Owner-ratified (§12.4/ratification item 3):
  returned as a structured `SubagentTurnResult`, never thrown through into A's
  own turn.

No seventh code invented; controlled restart-cancel reuses the `canceled` state
with audit reason `restart`, not a distinct code.

## 9. Decision 7 — Target files

**New (`packages/agent/src/server/consumption/`):**
- `subagentDispatcher.ts` — the §3 seam: guard gate → P6-R resolve+bind →
  session create → task projection → input-required/respond → terminal.
- `subagentTaskStore.ts` — the §6 narrow `SubagentTaskRecord` over the existing
  `agent.db` store, with the indexed `findByState`/`findExpired`/`getByIdempotencyKey`
  queries the recovery scan needs.
- `subagentRecovery.ts` — the boot recovery scan + timeout sweep of §6.
- `__tests__/` — unit specs for the guard gate, correlation, timeout, recovery.

**New tool-layer entry:** a pi tool factory `delegateToSubagent` (co-located
with the agent's other pi tool factories) that constructs a `SubagentInvokeInput`
from the tool call, invokes the dispatcher, and returns the `SubagentTurnResult`
projected as a tool result. It is the ONLY caller of the dispatcher (invariant 9:
tools flow through pi factories + Operations adapters).

**Touched:** `shared/error-codes.ts` (add the three §8 codes);
`docs/ERROR_CODES.md` only if/when graduated (not now).

**Reused, not modified:** `resolveAgentDeployment` (P6-R),
`AgentCoreSessionService` (`createSession`/`prompt`/`followUp`/`interrupt`/
`subscribe`), the T1 durable pi-chat event store, and all AC1-T2 contract
validators.

## 10. Decision 8 — Proof matrix

| # | Proof | Level | Asserts |
|---|---|---|---|
| P1 | A delegates to B in A's workspace; B completes with a `WorkspaceFileLocator` artifact | integration/e2e | happy path; `task.principal` = A, `task.actor` = B; artifact is a typed locator, no raw path |
| P2 | B pauses via `input-required`; A answers; B resumes and completes | integration/e2e | correlation by `taskId`; `working→input-required→working→completed`; same `contextId` |
| P3 | Subagent binding | integration | B's pi session `ctx.workspaceId === A.principal.workspaceId` (subagent, not own workspace) |
| P4 | Depth-4 refused | unit | chain length 3, next hop → `AGENT_CONSUMPTION_DEPTH_EXCEEDED`, no session created, refusal audit |
| P5 | A→B→A cycle refused | unit | `detectConsumptionCycle` full-ancestry → `AGENT_CONSUMPTION_CYCLE_DETECTED` |
| P6 | input-required timeout → canceled | unit (fake timers) | deadline elapsed → `canceled` + `AGENT_CONSUMPTION_INPUT_REQUIRED_TIMEOUT` + audit |
| P7 | Restart recovery — pending answerable | integration | `input-required` record survives restart; timer re-armed from durable `deadline`; still answerable |
| P8 | Restart recovery — expired + dead-session | integration | expired `input-required` → canceled on scan; non-terminal record with unre-attachable session → clean `canceled` (reason `restart`), no orphan |
| P9 | Idempotency | unit | retried `invoke` with same `idempotencyKey` re-attaches to the existing task, never double-spawns a session |
| P10 | Audit invariant | unit | every transition emits `principal`=A / `actor`=B; principal unchanged along the chain |

Gate: package typecheck + the targeted `consumption/__tests__` suite + the plan
acceptance gate for AC1; redacted output attached to the AC1-D PR.

## 11. Non-goals (explicit)

- **No contracted/SERVICE mode**, no own-workspace binding, no governed
  projection, no metering — those are AC1-M/AC1-P decorators over this pipeline.
- **No task queue, broker, scheduler, `TaskScheduler`, or state-machine
  library** — the merged pure transition validators + one pi session are the
  whole engine.
- **No retry policy**, no backoff, no A2A wire transport, no MCP loopback.
- **No new persistence store** — narrow record rides existing `agent.db`;
  transcript rides existing T1 store.
- **No cross-workspace artifact transfer** (AR1 Lane X) — subagent artifacts are
  same-workspace `WorkspaceFileLocator`s only (AC1-T2 V1).
- **No new audit store/dashboard** — reuse the structured-log sink.
- **No global-registry error graduation** until a runtime route surfaces them.
- **No per-`AgentDefinition` guard-override plumbing** (owner-deferred
  2026-07-14, §12.3) — `ConsumptionGuards` remains a per-invoke parameter only.

## 12. OWNER-DECISION callouts — RESOLVED 2026-07-14

All four callouts below are now ratified; see "Owner ratification" at the top
of this document for the verbatim record. Kept here for traceability of what
was asked and what was decided.

1. **Ship order — RATIFIED: confirmed.** Subagent mode (AC1-D) ships BEFORE
   contracted mode (AC1-M). Decision 22 already frames contracted as a layering
   ON TOP of the subagent pipeline; the owner confirmed this as the explicit
   build order, so `kon`/`7t6`/`psc` stay blocked on `wrr`.
2. **Durability shape — RATIFIED: narrow record, confirmed.** Bead `17q`
   delegated "T1 envelope vs narrow table" to the engineer; this spec ruled a
   narrow `SubagentTaskRecord` in existing `agent.db` + transcript on T1. The
   owner confirmed this over a pure-T1-envelope approach, and confirmed
   `agent.db` as the home (no new store).
3. **Guard override surface — RATIFIED: deferred.** Defaults depth=3 / 24h
   stand as platform defaults that "consumers may tighten" via the per-invoke
   `ConsumptionGuards` parameter. The owner deferred the per-`AgentDefinition`
   override *plumbing* until a consumer needs it — out of scope for AC1-D.
4. **B-failure surfacing — RATIFIED: confirmed.** B's failure returns a
   structured `{ status: 'failed', code: AGENT_CONSUMPTION_SUBAGENT_FAILED }`
   to A's tool (A decides what to do), rather than throwing through and failing
   A's own turn. Confirmed: structured-return over throw-through.
