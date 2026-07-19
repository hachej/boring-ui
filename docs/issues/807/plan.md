---
github: https://github.com/hachej/boring-ui/issues/807
issue: 807
state: ready-for-human
updated: 2026-07-18
flag: not-needed
track: owner
---

# gh-807 Durable task/event replay for restart-safe agent sessions

## Authority and planning status

This is the canonical plan for the remaining #807 work package. It recuts the
useful T1/T2 research under Decision 26 without restoring any retired runtime
authority.

Current authority, in order:

1. [`../../DECISIONS.md`](../../DECISIONS.md), Decision 26.
2. [`../391/plan.md`](../391/plan.md), especially Step 1A session compatibility
   and the consumer-backed Step 3 trigger.
3. [`../391/AGENT-CONSUMPTION-MODES.md`](../391/AGENT-CONSUMPTION-MODES.md),
   especially trusted workspace/agent binding before session-only addressing.
4. [`../391/ROADMAP-ALIGNMENT.md`](../391/ROADMAP-ALIGNMENT.md), which retains
   T1 durable events and makes T2/channels thin, triggered follow-ons.
5. [`../391/AGENT-CLOUD-VISION.md`](../391/AGENT-CLOUD-VISION.md), the
   non-binding north-star for the control-plane/data-plane split.

The documents under [`runtime-refactor/work/`](runtime-refactor/work/) are
historical research inputs only. Their current P1/D1 route family, full
approval migration, Durable Streams wire protocol, input-asset, and Slack
work orders are not dispatch authority. This plan selectively retains their
landed event-store research, append-before-fanout invariant, replay-offset
semantics, and fault-injection ideas.

Planning baseline: `origin/main` at
`556aed587d2272ee1f6e41153dc3517818067712`, inspected on 2026-07-18.
This recut changes documentation only. It does not authorize product code and
does not mutate `.beads`.

## Outcome

### Today

The repository already has a useful durability foundation, but the live
product still behaves as process-local streaming:

- `AgentEvent`, `Agent.start()`, `Agent.stream()`, and the server/core package
  skeletons exist.
- `SqliteEventStreamStore` already provides transactional monotonic append,
  idempotent append, reads, schema versioning, and conformance tests.
- `HarnessPiChatService` can append an event before live fanout when an event
  store is injected, and tests prove ordering, isolation, restart sequence
  seeding, and fail-closed append behavior.
- Production composers do not inject a file-backed store. The event-store seam
  remains optional, so normal hosts still rely on `PiChatReplayBuffer` and the
  in-memory `AgentLiveEventBuffer` for replay.
- Pi JSONL transcripts already live under the host-owned session root and are
  the durable conversation-history authority.
- Decision 22's canonical, data-only `AgentTask` v2 and seven-state `TaskState`
  lifecycle already exist in `packages/agent/src/shared/agent-consumption.ts`;
  no dispatcher or persistence connects them to `Agent.start()` yet.
- The managed-agent MCP delegate already calls the public Agent facade, but its
  delegation/task status is a process-local `Map`; #806 has not yet been recut
  for Decision 26.

### Delta

After the implementation slices in this plan:

```text
authorized request + trusted workspace/agent binding + requestId
-> canonical AgentTask + replay receipt committed on the control plane
-> control-plane agent loop owns the turn
-> every tool effect crosses the existing Workspace + Sandbox Operations boundary
-> AgentEvent append commits before delivery
-> current UI or same-process MCP consumer reads by sessionId/startIndex
-> process restart reopens the same host-side store and replays from disk
```

The first result is deliberately narrow: durable task admission, event replay,
explicit canonical failure recovery, and Seneca deploy/rollback proof. It does
not prebuild approvals, A2A, a new browser transport, or a channel framework.

## Hard gates — no implementation before both clear

The plan can be written, reviewed, and merged now. **Implementation blocked
until #814/#816/#817 merge.** No code bead below may be dispatched ahead of
that gate.

Status verified with `gh pr view` on 2026-07-18:

| A1 tail PR | Verified state | Merge state / base | Consequence today |
| --- | --- | --- | --- |
| [#814](https://github.com/hachej/boring-ui/pull/814) A1.2 trusted authored tool catalogs | open | clean, base `main` | blocks #807 implementation |
| [#816](https://github.com/hachej/boring-ui/pull/816) A1.4a embeddable authored-agent dev app | open | clean, stacked on `feat/805-a1-tool-catalog` | blocks #807 implementation |
| [#817](https://github.com/hachej/boring-ui/pull/817) A1.4b sandbox-default agent dev CLI | open | clean, stacked on `feat/805-a1-dev-app` | blocks #807 implementation |

The second gate is the existing owner gate
`wt-391-forward-csk` (“T1/T2 named durable-contract consumer trigger”). The
current T1.0 planning bead `wt-391-forward-26v` names candidate consumers but
does not itself close `csk`; `csk` is currently `deferred`, not closed.

An implementation orchestrator must record both checks before dispatch:

```bash
for pr in 814 816 817; do
  test "$(gh pr view "$pr" --repo hachej/boring-ui --json state --jq .state)" = MERGED
done
br show wt-391-forward-csk --json | jq -e '.[0].status == "closed"'
```

If an A1 PR lands with a materially different `agentTypeId`, tool-catalog, or
runtime-composition contract, update this plan's exact type/file references
before implementation. Do not code around the merged A1 authority.

## Named consumers and ownership boundary

### Seneca production chat

**Today:** bead 1A.10b (`wt-391-forward-o0b.27`) already requires restart/history
and an executed rollback to the typed-aware compatibility floor while
preserving non-default rows and history. It explicitly excludes Step 1B,
Step 2, and Step 3, and it does not yet have durable task/event replay from
#807.

**Delta:** #807 supplies the reusable package contract and file-backed host
state. After 1A.10b completes on its own terms, a distinct #807-owned proof uses
the same Seneca product and normal deploy/rollback machinery to qualify durable
task replay. #807 does not add scope to 1A.10b or make that Step 1A proof depend
on post-v1 durability.

The qualifying journey is:

```text
start a Seneca chat task
-> observe and checkpoint its durable event index
-> restart/redeploy the app on the same host session volume
-> load the same session and replay from the checkpoint without duplicate model work
-> roll back to the typed-aware compatibility cohort without deleting session state
-> restore the durable cohort and read the same task/session/history
```

### Step 1B MCP ingress (#806)

**Today:** main contains a process-local managed-agent MCP delegate and polling
record. The canonical [#806 plan](../806/plan.md) is still deferred and says its
M1/M2 work must be recut after Step 1A.

**Delta:** #806 may consume the durable `Agent.start` receipt, task status, and
`Agent.stream(sessionId, { startIndex })` seam after #807 T1.4. #806 owns MCP
authentication, typed workspace/member resolution, exposure, protocol mapping,
limits, and its own Decision 26 recut. This plan does not implement #806.

## Proposed `csk` owner-gate closure criteria

The owner may close `wt-391-forward-csk` only when all of the following are
recorded in committed authority or an owner comment:

1. at least one approved consumer is named, not merely a candidate;
2. its concrete restart/replay use case is named;
3. its owning path is named (`#807` T1.5 for Seneca, using completed 1A.10b as
   the operational baseline, and/or `#806` Step 1B);
4. this #807 canonical plan is linked as the provider contract;
5. the approving owner and approval date are recorded; and
6. the closure states that approval does not waive the A1 PR-tail merge gate.

Recommended approval: accept Seneca production chat as the first consumer in a
distinct #807 proof after 1A.10b, with #806 Step 1B as the second named consumer
of the same seam. Until the owner records that decision and closes `csk`, T1.1
remains blocked even if all three A1 PRs merge.

## Today/Delta inventory

| Area | Today on main | Remaining delta |
| --- | --- | --- |
| Public event shape | `AgentEvent { v, eventIndex, timestamp, sessionId, chunk }` exists in `packages/agent/src/shared/events.ts`. | Add replay identity to the existing `AgentStartReceipt`; keep executable objects out of shared data. |
| Canonical task lifecycle | Decision 22's `AgentTask` v2, `TaskState`, transitions, principals, messages, and artifacts already exist in `packages/agent/src/shared/agent-consumption.ts`. | Persist and expose that contract through the Agent facade; do not invent a parallel task-state enum. |
| SQLite event core | `eventStreamStore.ts`, `sqlStorage.ts`, schema v1, and conformance tests exist. | Extend the same database authority for canonical task projections and idempotency metadata; do not create a second event store. |
| Event append | `HarnessPiChatService` serializes durable append before live fanout when a store is supplied. | Make the store required for durability-qualified production composition and associate terminal event ranges with the admitted task. |
| Event addressing | Harness paths derive from a process session key; `sessionStreamPath()` is currently a shared string helper. | Derive the canonical key server-side from trusted storage scope, workspace, selected A1 agent type, and runtime-owned session id. Keep constructors/path encoding out of shared/front exports. |
| Agent replay | `Agent.stream()` reads an in-memory buffer and throws once history is evicted. | Page persisted events, bridge to live tail without a read/subscribe race, and reopen cold after process restart. |
| Browser transport | Current `RemotePiSession` uses the existing `?cursor=` NDJSON route and `PiChatReplayBuffer`. | Keep the public route/client in this slice; make its replay source durable. No new wire protocol or UI rewrite. |
| Conversation history | Pi JSONL is durable when hosts mount `BORING_AGENT_SESSION_ROOT`; Core already infers sibling `/data/pi-sessions` for `/data/workspaces`. | Place `agent.db` under the same host-owned session namespace and define backup/restore plus JSONL/event divergence behavior. |
| Task admission | `Agent.start()` returns `{ sessionId, startIndex }`; canonical `AgentTask` types are not wired, and MCP delegation status is memory-only. | Commit a canonical `submitted` task plus request fingerprint before the first model/tool effect; exact retry returns the original receipt. |
| A1 authoring | Main materializes instructions but the A1 catalog/dev tail is still open. Definitions are declarative inputs. | After the gate, bind durable scope to trusted `agentTypeId`; never persist/import tool handler code in #807. |
| Runtime lifecycle | Existing runtime modes return one `RuntimeBundle { workspace, sandbox, ... }`. | Keep Workspace+Sandbox swap/disposal paired. Durable task/session state stays host-owned across a runtime-pair replacement. |
| Approvals | `resolveInput()` remains a T1 stub; ask-user has its own current path. | Wait for a named parked-input consumer. Do not migrate approvals in the first durability slice. |
| Channels/T2 | Slack and T2 documents contain useful thin-adapter research but no current consumer authority. | Wait for explicit triggers; do not add Chat SDK, Durable Streams, or a channel package now. |

## Problem

### Today

An event may be durably appended in focused tests, yet normal application
composition never owns that store. `Agent.stream()` cannot replay a completed
turn after process restart, and a request retried after response loss has no
durable task receipt. The existing JSONL transcript can preserve visible
history while the event stream and MCP polling record disappear, leaving
consumers unable to distinguish “never admitted,” “failed after restart,” and
“completed but response lost.”

### Delta

Make admission and replay explicit at the existing public seams, backed by one
host-owned SQLite file next to the Pi sessions. Preserve current UI and
workspace authorization. On an uncertain crash, move the canonical task to an
authorized terminal state with a stable interruption reason and preserve
durable history; never silently rerun a model turn or claim transparent resume.

## Solution and binding decisions

### 1. Persist Decision 22's canonical task; do not create another lifecycle

**Today:** `AgentTask` v2 already defines `submitted`, `working`,
`input-required`, `completed`, `failed`, `canceled`, and `rejected`. The Agent
facade has a session receipt but no durable task identity or status lookup.

**Delta:** persist that exact `AgentTask`/`TaskState` contract. Extend the
existing `AgentStartReceipt` additively with `taskId` and `requestId`, preserving
`sessionId` and `startIndex`; the T1 mapping uses the runtime-owned session id as
the task `contextId`. A narrow authorized `agent.tasks.get(taskId, ctx)` returns
the canonical `AgentTask`, not a second snapshot/status shape.

The durable SQL record may carry server-only replay/idempotency metadata—request
fingerprint, session id, start/terminal event indexes, and recovery code—beside
the canonical task. Those columns are not another public lifecycle. For this
human-chat slice, `messages`/`artifacts` may remain empty except for a versioned,
data-only recovery marker; #807 does not invent the Step 2/3 dispatcher or
artifact projection.

There is no task list, scheduler, daemon, priority queue, leasing system, or
automatic resume in this work package.

`AgentSendInput` may carry a caller `requestId`. Durability-qualified adapters
must supply one: the existing web adapter maps its stable prompt nonce, and
#806 will map its authenticated MCP request/delegation id. Compatibility callers
that omit it receive a generated id in the receipt, but cannot claim response-
loss deduplication because they cannot retry an id they never received.

### 2. One host-owned SQLite authority beside Pi JSONL

**Today:** SQLite event schema v1 exists, but the store is optional and normally
in-memory/unwired.

**Delta:** each trusted session namespace opens exactly one file-backed
`agent.db` beneath the effective `BORING_AGENT_SESSION_ROOT`, alongside—not
inside—the workspace/sandbox runtime data. The existing event tables, canonical
task rows/transitions, replay metadata, and request fingerprints use that one
connection/transaction authority.

Production composition that advertises durable task/replay behavior fails
startup with `DURABLE_AGENT_STATE_REQUIRED` if it has no file-backed store.
An in-memory adapter remains valid only for explicit unit/dev composition that
does not claim restart durability.

The host opens/migrates the database before routes/readiness, injects it into the
Agent runtime, and closes it once after producers and readers stop. Replacing a
Workspace+Sandbox runtime pair does not replace or delete this host-owned user
state. T1 permits one host process to own a session namespace; a second
concurrent replica is a separate triggered design because startup recovery must
never fail another live process's task.

### 3. Trusted session scope binds workspace and A1 agent identity

**Today:** stored stream paths are based on a session-context string and the
shared module exposes `sessionStreamPath()`.

**Delta:** a server-only canonical scope binds:

```text
storage scope + authorized workspace id + trusted A1 agentTypeId + runtime session id
```

The request principal is separately included in the admission/idempotency key.
It authorizes an operation; it does not rewrite the canonical session owner key
for another authorized collaborator. Host adapters derive all components after
authentication, membership, workspace-type, and sole-agent selection. URL/body
session ids are addresses only.

The canonical task uses `PrincipalRef { userId, workspaceId }` from that trusted
resolution and sets `actor.agentId` from the trusted A1 `agentTypeId`. Its
optional legacy `deploymentId` field remains absent and is not an authority.

The scope constructor, encoder, database path, and raw session root remain
server-only. No front/shared DTO accepts a storage path, workspace override, or
agent override.

### 4. Admission commits before the first model or tool effect

**Today:** `Agent.start()` creates/loads a session and then prompts the Pi
service; the durable event tap begins only when Pi emits events.

**Delta:** the idempotency/admission key is independent of the result session:

```text
storage scope + authorized workspace id + trusted A1 agentTypeId
+ principal user id + requestId
```

When a caller supplies an existing `sessionId`, include it in the semantic
fingerprint. For a new conversation, allocate the runtime session id only after
claiming the admission key, then store it on the task/receipt. This avoids a
circular key while preserving trusted session scope for later event access.

In one transaction:

1. claim the admission key above;
2. store a canonical semantic-input fingerprint—including any caller-supplied
   existing session id—never the raw prompt/tool payload;
3. allocate/store `taskId`, `sessionId`, and `startIndex`; and
4. commit canonical state `submitted` before starting the producer.

An exact request-id/fingerprint retry returns the original receipt. The same key
with a different fingerprint fails with `AGENT_TASK_REQUEST_CONFLICT`. A crash
after receipt commit never starts a second producer on retry. Starting a new
turn after an interruption requires a new request id.

A database constraint permits at most one unbound `submitted` task in a trusted
session scope. A per-session producer-start admission lock is held from that
task's commit until `agent-start` binds it or recovery rejects it, so concurrent
requests cannot both claim the next turn. On `agent-start`, an already-bound
matching `turnId` is a retry for its existing task; otherwise the event binds
the unique unbound submitted row in that session and moves it
`submitted -> working`. Zero or multiple candidate rows is an invariant failure,
not a guessed association.

If producer startup fails synchronously before `agent-start`, the same admission
service moves that row `submitted -> rejected` with the stable start failure and
releases the lock. A process death leaves recovery to perform the rejection; no
silent timeout or background scheduler is added.

Only events with the bound task's `turnId` may settle it; event append, task
transition, and internal range update share the same database transaction. The
binding is fixed:

| Persisted Pi event | Canonical task effect |
| --- | --- |
| new `agent-start(turnId)` with one unbound submitted task in that session | bind `turnId`; `submitted -> working` |
| repeated `agent-start` for an already-bound `turnId` | remain `working`; do not consume another submitted task |
| matching `agent-end(..., willRetry: true)` or retryable `error` | remain `working` |
| matching final `agent-end(..., status: ok)` | `working -> completed` |
| matching final `agent-end(..., status: aborted)` | `working -> canceled` |
| matching final `agent-end(..., status: error)` | `working -> failed` |
| matching non-retryable terminal `error` emitted without a final end | `working -> failed`; a later duplicate failed end is an idempotent no-op |

An uncorrelated terminal event is appended for diagnosis but cannot settle a
task. A duplicate identical terminal outcome is a no-op; a contradictory
terminal outcome is an invariant failure, never a second transition. The
existing append-before-live-delivery invariant remains mandatory.

Implement admission once as a server-side service used by both `Agent.start()`
and the current pi-chat prompt route. The web route maps `clientNonce` to
`requestId` and keeps its existing response shape; it does not create a second
task store or lifecycle.

### 5. Durable replay replaces memory as authority without changing the UI

**Today:** the core facade and HTTP route replay from bounded process memory.

**Delta:** `Agent.stream(sessionId, { startIndex })` authorizes the canonical
scope, pages persisted `AgentEvent` rows from the inclusive integer
`startIndex`, then tails live events. The reader must close the read/subscribe
race by registering for notification and re-reading from the last durable index
before it waits. It deduplicates only by monotonic `eventIndex`.

The current pi-chat NDJSON route uses the same durable source and preserves its
existing URL/frame contract for the browser. `RemotePiSession`, `usePiSessions`,
and `PiChatPanel` do not change in T1. The existing in-memory buffer may remain a
live fanout optimization, but it is no longer replay authority.

No new Durable Streams dependency, GET/HEAD route family, ChatTransport, SSE
client, or legacy-route deletion is justified by the two named consumers.

### 6. Explicit restart recovery; no transparent resume

**Today:** Pi JSONL can contain committed conversation state that has no
corresponding durable event if the process dies before the event tap appends.

**Delta:** T1 creates only `submitted` and `working` nonterminal tasks. On
reopening `agent.db`, those rows move through an existing legal transition:
`submitted -> rejected` if no producer-start commit exists, or
`working -> failed` after work began. Both store/project the stable reason
`AGENT_TASK_INTERRUPTED`; no new `interrupted` state is added. The task is never
re-prompted automatically. A fault between JSONL commit and event append
produces this explicit failed replay boundary; session history remains loadable
from JSONL and the event API never silently claims a complete log.

T1 never creates or parks `input-required`. If recovery encounters that
canonical state, it leaves the row untouched and fails durability readiness
with `DURABLE_AGENT_RECOVERY_UNSUPPORTED_STATE`; the on-stream approval trigger
must be recut before that state can be recovery-qualified. T1 does not silently
choose `input-required -> canceled` or resume it.

Same-process reconnect remains lossless from a committed offset. Cross-restart
replay is lossless for committed events and explicit about an interrupted tail.
This is the only recovery promise in v1.

### 7. T1 stays append-only; retention waits for evidence

**Today:** the SQLite event table is append-only and the live replay buffer
defaults to 1,000 events.

**Delta:** keep persisted task/event rows append-only for this first consumer.
The in-memory 1,000-event optimization does not become a durable deletion
policy. Backup/restore and operational proof must measure file growth, but T1
does not prune events, Pi JSONL transcripts, or task receipts.

Retention is recut only when an owner-approved storage/retention requirement or
measured production growth names a limit and retry window. That later work must
prune complete terminal-task ranges (never split a still-promised replay range),
persist an earliest retained index, and then introduce/prove
`AGENT_EVENT_OFFSET_EXPIRED`.

### 8. A1 and control-plane/data-plane boundaries remain intact

**Today:** A1 definitions and `MaterializedAgentSourceV1` are data-only
authoring inputs. The trusted tool catalog and dev-app/CLI tail are not yet all
merged.

**Delta:** task records persist the canonical data-only `AgentTask` projection,
identifiers, fingerprints, replay metadata, timestamps, and event data only.
They never serialize `AgentDefinition`, catalog functions, tool handlers,
Workspace, Sandbox, roots, credentials, or runtime handles.

Tool execution remains on the existing data-plane path: the trusted host
resolves A1 `toolRefs` through its per-agent `toolCatalog`, the current
Workspace+Sandbox pair supplies Operations adapters, and handler effects execute
through those sandbox/Operations seams. Tenant tool handlers execute only inside
the Sandbox; #807 does not import authored modules, run a handler on the control
plane, or add a second runtime composer.

### 9. Additive schema and rollback floor

**Today:** event schema v1 is additive and independent of Pi JSONL. Seneca
1A.10b already forbids rollback to a pre-typed application after non-default
rows exist.

**Delta:** migrate `agent.db` forward without rewriting event envelopes or Pi
JSONL. A typed-aware compatibility version may ignore the new database while
rolled back, but must leave it and the session volume intact. On restore, the
new version reads prior events/tasks and marks any turn produced only during the
rollback interval with the same explicit failed/rejected recovery boundary
rather than inventing events.

No down migration or destructive cleanup is part of rollback.

## Stable errors

### Today

Agent already exposes stable `SESSION_NOT_FOUND`, `UNAUTHORIZED`, `ABORTED`, and
`CURSOR_OUT_OF_RANGE` behavior.

### Delta

Add only the missing durable-contract codes to the canonical Agent registry:

- `DURABLE_AGENT_STATE_REQUIRED` — a durability-qualified production composer
  has no file-backed store;
- `AGENT_TASK_REQUEST_CONFLICT` — a request id is reused with different semantic
  input;
- `AGENT_TASK_INTERRUPTED` — recovery closed a previously nonterminal canonical
  task after process death without rerunning it; and
- `DURABLE_AGENT_RECOVERY_UNSUPPORTED_STATE` — recovery found a nonterminal
  canonical state, such as `input-required`, that T1 does not own.

Authorization/not-found precedence remains unchanged, so an offset or task
error cannot disclose a foreign workspace/session.

## Test seams

### Highest public seams

- `Agent.start()` replay receipt plus canonical `AgentTask` lookup and
  exact-retry behavior.
- `Agent.stream(sessionId, { startIndex })` cold replay plus live tail.
- Existing pi-chat route reconnect against a fresh process.
- `createAgentApp`, `registerAgentRoutes`, Core/Workspace/full-app composition
  with a temporary host session root.
- The distinct #807 Seneca qualification after 1A.10b completes.

### Reuse today

- `packages/agent/src/server/events/eventStreamStore.ts`
- `packages/agent/src/server/events/__tests__/eventStreamStore.conformance.test.ts`
- `packages/agent/src/server/pi-chat/harnessPiChatService.ts`
- `packages/agent/src/server/pi-chat/__tests__/harnessPiChatService.eventStore.test.ts`
- `packages/agent/src/core/createAgent.ts`
- `packages/agent/src/server/createAgent.ts`
- `packages/agent/src/server/createAgentApp.ts`
- `packages/agent/src/server/registerAgentRoutes.ts`
- `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts`
- `packages/agent/src/server/harness/pi-coding-agent/sessions.ts`

### Avoid testing

- private SQL helpers when store/facade conformance proves the behavior;
- a new wire protocol or browser transport;
- transparent continuation after process death;
- tool-handler execution inside the durable store;
- #806 MCP auth/exposure; or
- Slack/channel SDK concurrency.

## Implementation slices

No slice below is dispatchable until the A1 PR tail and `csk` owner gates are
both clear. One writer owns overlapping Agent/Core composition files at a time.

### T1.1 — File-backed host ownership and trusted durable scope

**Today:** SQLite/store code is landed, optional, and used mainly by focused
tests. Production Agent/Core/full-app composers do not open or own it.

**Delta:** add one server-only durable-state factory beneath the effective
session namespace; derive the trusted workspace/A1-agent scope; migrate before
readiness; inject a required store into durability-qualified runtime bindings;
close once after producer shutdown. Keep explicit memory-only dev/test support.

**Blocked by:** merged #814, #816, #817; closed `wt-391-forward-csk`.

**Machine gate:**

```bash
pnpm --filter @hachej/boring-agent exec vitest run \
  src/server/events/__tests__/eventStreamStore.conformance.test.ts \
  src/server/__tests__/createAgentApp.test.ts
pnpm --filter @hachej/boring-agent run typecheck
```

Focused tests must prove a temp file survives close/reopen, absent/in-memory
production storage rejects with `DURABLE_AGENT_STATE_REQUIRED`, raw paths do
not enter shared exports, and Workspace+Sandbox disposal counts remain paired.

**Rollback:** disable the durability-qualified composition option; leave
`agent.db` and Pi JSONL untouched.

### T1.2 — Durable task admission and exact-retry receipts

**Today:** `Agent.start()` has no durable task id/fingerprint and can repeat
model work after an uncertain caller retry.

**Delta:** persist the existing canonical `AgentTask` and same-DB replay
metadata; claim a trusted principal/request/fingerprint before the first
producer effect; add task/request ids to the existing receipt; return the
original receipt on exact retry; reject payload mismatch; expose one scoped
canonical task lookup; record terminal event range transactionally.

**Blocked by:** T1.1.

**Machine gate:**

```bash
pnpm --filter @hachej/boring-agent exec vitest run \
  src/server/events/__tests__/taskAdmission.conformance.test.ts \
  src/core/__tests__/createAgent.test.ts \
  src/server/http/routes/__tests__/piChat.test.ts
pnpm --filter @hachej/boring-agent run typecheck
```

Fault tests must prove: receipt commit precedes the model/tool spy; same key and
fingerprint starts one producer; same key/different fingerprint returns
`AGENT_TASK_REQUEST_CONFLICT`; response-loss retry after a fresh process returns
the same receipt; every persisted/projected task validates as `AgentTask` v2;
the pi-chat route maps an exact `clientNonce` retry without a second producer;
two sequential tasks in one session bind distinct `turnId` values; retryable
ends remain `working`; `ok`/`aborted`/`error` settle only the matching task as
`completed`/`canceled`/`failed`; concurrent distinct admissions cannot create
two unbound submitted rows or claim one `agent-start`; a repeated start for an
already-bound turn cannot consume the next task; and known foreign ids fail
before task/event access. A synchronous pre-start failure must reject the
submitted task and release the lock for the next request.

**Rollback:** old callers may ignore additive receipt fields; retained receipts
remain inert data. Do not delete them.

### T1.3 — Durable Agent replay through existing Agent and pi-chat seams

**Today:** committed events exist only when a store is manually injected, while
the public Agent stream and current browser route replay from memory.

**Delta:** make persisted `AgentEvent` rows the replay authority; implement cold
page-to-live handoff without a race; preserve inclusive `startIndex`; drive the
existing pi-chat NDJSON cursor route from the same durable source; retain the
front contract and live in-memory optimization.

**Blocked by:** T1.2.

**Machine gate:**

```bash
pnpm --filter @hachej/boring-agent exec vitest run \
  src/server/pi-chat/__tests__/harnessPiChatService.eventStore.test.ts \
  src/server/http/routes/__tests__/piChat.test.ts \
  src/core/__tests__/createAgent.test.ts
pnpm --filter @hachej/boring-agent run lint:invariants
```

Tests must force a disconnect between two committed events, restart the process,
and receive each missed event exactly once; prove concurrent append at the
read/subscribe boundary is neither lost nor duplicated; and prove workspace,
agent type, and principal authorization precede replay.

**Rollback:** the previous typed-aware cohort may use its legacy route/buffer
while leaving durable files untouched. Do not delete current route/client code
in this slice.

### T1.4 — Recovery, backup/restore, and reusable host conformance

**Today:** there is no complete crash-window or real-host proof and no
documented backup ordering between Pi JSONL and SQLite.

**Delta:** close nonterminal tasks through canonical `rejected`/`failed`
transitions with `AGENT_TASK_INTERRUPTED`; fault-test receipt/event/JSONL/fanout
windows; document SQLite checkpoint/backup plus JSONL ordering; measure database
growth without pruning; run the same contract through standalone,
Workspace/Core, and full-app composition.

**Blocked by:** T1.3.

**Machine gate:**

```bash
pnpm --filter @hachej/boring-agent test
pnpm --filter @hachej/boring-agent run typecheck
pnpm --filter @hachej/boring-agent run lint:invariants
pnpm run check:agent-isolation
pnpm run audit:imports
```

The reusable suite must kill/recreate at four boundaries: after task receipt
before producer start; after Pi JSONL write before event append; after event
append before fanout; and after terminal append before HTTP response. It must
prove no automatic rerun, explicit interruption, readable JSONL history,
retained committed events, valid canonical task transitions, and one close per
store. A seeded `input-required` row must remain byte-for-byte unchanged while
readiness fails with `DURABLE_AGENT_RECOVERY_UNSUPPORTED_STATE`.

**Rollback:** restore the typed-aware compatibility cohort, retain the host
session volume and database, then restore the durable cohort and rerun the cold
read proof.

### T1.5 — Record Seneca production consumer proof

**Today:** Seneca 1A.10b owns restart/history and rollback but has no accepted
#807 proof record yet.

**Delta:** after 1A.10b completes, run a separate #807 qualification against the
exact published durable package cohort using the established Seneca product and
deploy/rollback mechanism. Record versions, redacted session/task identifiers,
checkpoint, restart replay, rollback/restore, and negative cross-product access
in `docs/issues/807/proof.md`.

**Blocked by:** T1.4 and completed #391 1A.10b. This slice is not part of 1A.10b
and cannot delay or widen it; #807 owns the new evidence, not Seneca deployment
code or Step 1A authority.

**Machine gate:** the proof names exact commit/image/package versions and the
commands or captured results for forward deploy, restart, rollback, and restore;
independent security/product/operations review has no unresolved blocker.

**Rollback:** this slice proves rollback; it performs no state deletion.

## Proposed Bead chain — do not create in this planning PR

The aliases below are proposed stable plan ids. `br` may allocate different
physical ids later, but titles and dependency edges must remain intact.

| Proposed id | Title | Depends on | Dispatch state / trigger |
| --- | --- | --- | --- |
| `807-T1.0` | Recut durable transport plan per Decision 26 | current `wt-391-forward-26v` | this docs-only PR; no code |
| `807-T1.1` | Own one file-backed agent state store per trusted session namespace | `807-T1.0`, merged #814/#816/#817, closed `wt-391-forward-csk` | blocked today |
| `807-T1.2` | Persist canonical AgentTask admission and exact-retry receipts | `807-T1.1` | blocked today |
| `807-T1.3` | Replay persisted AgentEvents through existing Agent/pi-chat seams | `807-T1.2` | blocked today |
| `807-T1.4` | Prove restart recovery, backup/restore, and host conformance | `807-T1.3` | blocked today |
| `807-T1.5` | Record distinct Seneca durability restart/rollback proof | `807-T1.4`, completed #391 1A.10b | wait for 1A.10b completion; never widen it |

Cross-issue edges, proposed but not created here:

```text
wt-391-forward-26v (plan)
-> owner closes wt-391-forward-csk
-> 807-T1.1 -> 807-T1.2 -> 807-T1.3 -> 807-T1.4
#391 1A.10b -> distinct 807-T1.5 Seneca durability proof

807-T1.4 -> #806 Step 1B recut may consume durable Agent task/replay
807-T1.4 -> later T2/HITL/channel planning only when its trigger fires
```

No `.beads` mutation belongs in this PR. After plan approval, the future graph
owner must run `br dep cycles` and `bv --robot-insights` before dispatch.

## Trigger-gated follow-ons

These are deliberately not hidden inside T1.1–T1.5.

| Waiting work | Exact trigger | What happens then | What does not happen now |
| --- | --- | --- | --- |
| #806 Step 1B integration | #806's canonical Decision 26 recut is approved and explicitly requires restart-safe MCP polling/multi-turn behavior | #806 consumes T1.4 at the public Agent seam and adds its own auth/protocol tests | no MCP routes, auth, exposure, or artifact work in #807 |
| Durable retention/pruning | an owner-approved storage policy or measured production growth names a retention limit and promised retry window | prune only complete terminal-task ranges, persist the floor, and prove `AGENT_EVENT_OFFSET_EXPIRED` | no 1,000-event durable cap or deletion in T1 |
| New T2 HTTP/SSE transport | a named consumer cannot use the existing Agent API or current pi-chat NDJSON route and documents the missing wire behavior | recut a small shared transport conformance slice | no Durable Streams package, new route family, browser refit, or legacy deletion now |
| On-stream approval/input | a named task must park for approval/input across clients or restart, with an owner-approved recovery policy | recut `resolveInput`, pending-input persistence, recovery for canonical `input-required`, and ask-user migration as a separate chain | T1 leaves that state untouched and fails readiness; no approval table/Questions-pane migration now |
| Step 2 multiple agents | a real workspace requires two selectable agents and the #391 Step 2 recut is approved | extend trusted agent binding and test separate session/task attribution over the same Workspace+Sandbox pair | Step 2 is not a prerequisite for the single-agent T1 core and no selector is built now |
| External A2A | a named external multi-turn task consumer plus #809 identity/auth decision exists | map A2A at the edge onto the durable contract | no A2A loopback or public endpoint now |
| Slack/other channel | a product owner names the channel, confirms the target Slack surface, and ratifies the adapter choice | recut the historical Chat SDK research against T1.4 | no channel package, SDK, pump, CAS lease, or concurrency framework now |
| Second tenant / horizontal scale | a second real tenant, a required concurrent app replica, or a measured single-process limit demonstrates capacity/isolation need | run a new tenancy, lease/ownership, partitioning, quota, and operations review | no fleet, broker, cross-replica pump ownership, or mutable registry now |
| Custom tenant tools | the A1/custom-tool contract and sandbox-entrypoint hygiene are separately approved | execute handlers only through toolCatalog/Operations on the data plane | #807 stores no executable code and runs no tool handler |

## Acceptance

#807 T1 remaining work is complete only when:

1. the A1 tail and `csk` gates are recorded before the first code commit;
2. the existing SQLite/event append foundation is reused rather than rebuilt;
3. persisted task state validates as Decision 22's canonical `AgentTask` v2 and
   uses only its existing transitions—there is no parallel lifecycle;
4. a durability-qualified host cannot start without file-backed state under the
   host session root;
5. trusted workspace and A1 agent identity bind every task/session/event access
   before a caller-supplied id is used;
6. task receipt commit precedes model/tool effects and exact request retry never
   starts a second producer;
7. one unbound submitted task per trusted session plus persisted `turnId`
   correlation makes retry/ok/abort/error events settle only their matching
   canonical task;
8. `Agent.stream()` and the existing browser route replay committed events after
   a fresh process without gaps or duplicates;
9. uncertain crash tails become canonical `rejected`/`failed` tasks with
   `AGENT_TASK_INTERRUPTED`, never transparent resume or silent rerun;
10. T1 never creates `input-required`; recovery leaves it untouched and fails
    readiness until the approval trigger is recut;
11. Pi JSONL remains readable and authoritative for conversation history;
12. T1 task/events remain append-only and a measured trigger gates later
    retention work;
13. Workspace+Sandbox still swap/dispose as one runtime-mode pair while host
    session/task state survives that swap;
14. A1 definitions remain data-only and all handler effects stay behind the
    trusted toolCatalog/Operations/sandbox path;
15. after 1A.10b completes independently, #807 records a distinct Seneca
    restart, rollback, restore, and cross-product proof against exact released
    artifacts; and
16. no #806, Step 2, A2A, approval, new transport, or channel scope leaked into
    the T1 implementation.

## Proof

### Planning PR

```bash
git diff --check
git diff --name-only origin/main...HEAD
git diff --name-only origin/main...HEAD | awk '$0 !~ /^docs\// { bad=1 } END { exit bad }'
git status --short
```

Expected: docs-only diff, no `.beads` change, clean worktree after commit, and
tier-1 plus tier-2 review records in the PR or beside this plan.

### Implementation package gates

```bash
pnpm --filter @hachej/boring-agent test
pnpm --filter @hachej/boring-agent run typecheck
pnpm --filter @hachej/boring-agent run lint:invariants
pnpm run check:agent-isolation
pnpm run audit:imports
```

### Product proof

Seneca uses a clean checkout and exact published versions. Proof must include
the manual/automated steps for task start, checkpoint, restart/redeploy, replay,
typed-aware rollback, restore, history read, and a foreign workspace/agent
denial. A waiver cannot claim production durability.

## Rollout and rollback

### Today

No production host owns `agent.db`, so there is no durable feature to enable or
roll back.

### Delta rollout

1. land schema/factory dark and compatibility-safe;
2. enable it in standalone and package conformance with temporary roots;
3. enable it in full-app/Core with the current UI route unchanged;
4. pack and qualify the exact package cohort;
5. enable Seneca against its durable host session volume;
6. perform checkpoint/restart/replay;
7. execute the typed-aware rollback and restore; and
8. only then record T1.5 complete.

Rollback disables the durability-qualified composer or restores the prior
typed-aware cohort. It never deletes `agent.db`, Pi JSONL, workspace rows, or
non-default histories. A future version may read and recover the retained data.

## Explicit non-goals

- No AgentHost or similarly renamed third runtime service.
- No controller/reconciler, desired-state loop, scheduler, broker, or daemon.
- No CAS/content-addressed rollout, digest authority, publication journal, or
  active pointer.
- No `AgentDeployment`, `definitionRef`, `deploymentRef`, or runtime mutable
  registry.
- No executable agent definition or tool-handler code in durable state.
- No second Workspace, Sandbox, model loop, or runtime composer.
- No transparent turn resume or automatic re-prompt after process death.
- No task/event retention pruning or lifecycle policy in T1.
- No full approval/HITL path, ask-user migration, or pending-input inbox.
- No new Durable Streams/ChatTransport/SSE protocol or browser transport refit.
- No deletion of the current pi-chat route, replay buffer, or front helpers in
  this work package.
- No Slack/Discord/channel package or multi-replica pump design.
- No #806 MCP authentication/exposure/artifact implementation.
- No Step 2 selector, same-workspace multi-agent product, external A2A, or
  contracted cross-workspace execution.
- No input-asset intake, `boring-bash`/`boring-sandbox` extraction, custom-tool
  runtime, marketplace, billing, fleet, FUSE/S3, or second-tenant platform.
- No Pi JSONL rewrite, session deletion, workspace retyping, or down migration.

## Stop conditions

Stop and amend this plan rather than improvising if:

1. #814/#816/#817 have not all merged or `csk` is not closed;
2. merged A1 no longer provides a trusted server-only agent type/catalog seam;
3. admission cannot commit before the first model/tool effect;
4. cold replay would bypass workspace/agent authorization;
5. the existing route cannot use durable replay without a browser-visible
   contract change—trigger a bounded T2 recut instead;
6. JSONL/event divergence cannot be surfaced without pretending a complete log;
7. production storage would land inside a sandbox/workspace runtime volume;
8. rollback would require deleting or rewriting user session data;
9. more than one live app process must own the same session namespace; or
10. recovery encounters `input-required` or another nonterminal state outside
    T1's `submitted`/`working` ownership; or
11. a slice begins adding any explicit non-goal above.

No stop condition authorizes a retired authority or a second runtime owner.

## Planning review record

| Reviewer | Target | Verdict | Findings / disposition |
| --- | --- | --- | --- |
| Draft self-check | baseline plan | complete | corrected live PR/main drift and verified the `br show --json` gate shape |
| Tier 1 fresh-eyes | complete draft | changes integrated | reuse canonical Decision 22 task states; keep 1A.10b independent; link landed cloud vision; keep T1 append-only |
| Tier 2 structural review | tier-1-integrated draft | approved after corrections | bind task-to-turn terminal mapping; exclude `input-required`; make new-session admission key non-circular; refresh PR status |
| Final convergence check | reviewed draft | complete | Tier 2 signed off; live gates refreshed; no structural delta; docs-only publication ready |
