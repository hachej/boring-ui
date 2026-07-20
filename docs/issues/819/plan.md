---
github: https://github.com/hachej/boring-ui/issues/819
issue: 819
state: ready-for-human
updated: 2026-07-19
flag: not-needed
track: owner
---

# gh-819 Control-plane observability and usage facts

## Authority and sequencing

This is the canonical implementation plan for issue #819. It is plan-only until
the owner accepts it and the activation gates below are satisfied.

- Parent programme: [#391](https://github.com/hachej/boring-ui/issues/391) and
  [`../391/plan.md`](../391/plan.md).
- Control-plane/data-plane authority:
  [`../391/AGENT-CLOUD-VISION.md`](../391/AGENT-CLOUD-VISION.md).
- Workspace and agent identity authority:
  [`../391/AGENT-CONSUMPTION-MODES.md`](../391/AGENT-CONSUMPTION-MODES.md).
- Locked decisions: [`../../DECISIONS.md`](../../DECISIONS.md), Decisions 25
  and 26.
- Event-shaped work: [#807](https://github.com/hachej/boring-ui/issues/807) and
  [`../807/plan.md`](../807/plan.md), especially the T1 durable `AgentEvent`
  contract and its one-store rule.
- Billing consumer: [#809](https://github.com/hachej/boring-ui/issues/809), BL1.
  #809 may consume trustworthy usage facts later; it does not own or inject
  pricing into this plan.

Decision 26 is binding: no #819 implementation starts before #391 Step 1A's
production proof, 1A.10b, completes. OB1 completes before any OB2 implementation
starts. Planning and the proposed Bead graph do not make either package
dispatchable.

## Outcome

Operators can answer, from the control-plane console:

1. How many model tokens, agent tool calls, and sandbox execution minutes did a
   workspace, its trusted agent, or one chat session consume in a bounded time
   window?
2. What was the workspace runtime's last observed state, and what tool or
   sandbox failures happened recently?
3. Which sessions belong to the selected workspace and trusted agent?

The result is operational evidence, not billing. It contains no prices,
credits, balances, reservations, invoices, quota enforcement, or payment
decision.

## Baseline audit

### Audited revision

The Today claims in this plan were checked against fetched `origin/main` at
`f93450902be7dfb8c26209f78f0aab49585e85c9` on 2026-07-19. The planning branch
was exactly at that SHA and clean before this document was written.

There is one material repository-state discrepancy that implementation must not
paper over. At the audited revision, GitHub reports #835, #839, #831, and #838
as open, not merged:

- #835 adds the concrete provider copy and
  [`packages/boring-sandbox/src/shared/providerV1.ts` at its reviewed
  head](https://github.com/hachej/boring-ui/blob/9037878a3cddd8bc04a7933b28df24645b0b56cb/packages/boring-sandbox/src/shared/providerV1.ts)
  `9037878a3cddd8bc04a7933b28df24645b0b56cb`.
- #839 is the stacked sandbox consumer swap and deletion of agent-owned
  provider copies.
- #831 adds the concrete bash/filesystem/tool copy to
  [`packages/boring-bash/src/agent/tools` at its reviewed
  head](https://github.com/hachej/boring-ui/tree/44b853d9a95c5ca458fd48d0be56cb3d86f5a04b/packages/boring-bash/src/agent/tools)
  `44b853d9a95c5ca458fd48d0be56cb3d86f5a04b`.
- #838 is the stacked bash consumer swap and deletion of agent-owned copies.

Current `main` therefore has both extracted package shells and capability
surfaces, but it does not yet have the final ownership swap described by those
four PRs. The first execution Bead must re-fetch `main`, verify their landed
state, and update exact paths if the final merge differs. It must not implement
against a PR head or preserve duplicate owners merely to match this audit.

### Today / Delta inventory

| Area | Today on audited `main` | Delta owned here |
| --- | --- | --- |
| Model token capture | [`packages/agent/src/server/pi-chat/metering.ts`](../../../packages/agent/src/server/pi-chat/metering.ts) normalizes native Pi input/output/cache token usage and coordinates a billing-oriented `AgentMeteringSink`. Its billing run ids intentionally omit workspace identity, and its id-less fallback may depend on a reservation or process-local instance; the coordinator is installed only when a host configures metering. | Extract the normalization into a product-neutral observation coordinator that runs whether billing is configured or not. Give it its own scope-bound run/occurrence identity before either the raw fact sink or optional billing sink. It does not reserve, price, debit, or block a run. |
| Existing usage DB | [`packages/core/src/server/db/schema.ts`](../../../packages/core/src/server/db/schema.ts) defines `boring_usage_ledger`, and [`packages/core/src/server/db/stores/PostgresMeteringStore.ts`](../../../packages/core/src/server/db/stores/PostgresMeteringStore.ts) records tokens plus provider/billed cost for the credits product. It has workspace/session fields but no trusted agent field and is coupled to credit semantics. | Add a separate append-only observability fact table/store in the same control-plane Postgres layer. Do not widen the credit ledger into the observability authority. |
| Tool-call facts | [`packages/agent/src/server/harness/pi-coding-agent/tool-adapter.ts`](../../../packages/agent/src/server/harness/pi-coding-agent/tool-adapter.ts) is the single generic Pi adapter around every `AgentTool`; it already observes tool name, terminal success/error, duration, session, and stable error code for best-effort telemetry. | Persist exactly one terminal tool-call fact at this generic seam, adding trusted workspace and agent identity. Do not count low-level filesystem/exec operations as extra tool calls. |
| Telemetry | [`packages/agent/src/shared/telemetry.ts`](../../../packages/agent/src/shared/telemetry.ts) deliberately swallows sink failures. [`packages/core/src/server/telemetry/db.ts`](../../../packages/core/src/server/telemetry/db.ts) is optional, allowlisted, and disabled unless configured; [`packages/core/src/server/telemetry/posthog.ts`](../../../packages/core/src/server/telemetry/posthog.ts) is an optional external analytics adapter. | Keep telemetry separate. Raw usage facts use a typed Postgres store and exact idempotency checks. No external APM choice is made. |
| Sandbox result facts | [`packages/agent/src/shared/sandbox.ts`](../../../packages/agent/src/shared/sandbox.ts) exposes provider/id and returns `ExecResult.durationMs`, exit status, and truncation from `Sandbox.exec`, but `ExecOptions` carries no workspace/agent/session/operation scope. [`packages/agent/src/server/tools/operations/remoteSandbox.ts`](../../../packages/agent/src/server/tools/operations/remoteSandbox.ts) currently drops the trusted context available one level up in the generic tool adapter. | After extraction lands, add an exact trusted per-execution envelope for model-visible sandbox operations. Make provider-reported duration/status cross `SandboxProviderV1`; persist milliseconds and convert to minutes only in reads/UI. Provisioning work without a chat session is explicitly excluded from OB1. |
| Sandbox provider boundary | On audited `main`, [`packages/boring-sandbox/src/shared/providerMatrix.ts`](../../../packages/boring-sandbox/src/shared/providerMatrix.ts) publishes contract version `boring-sandbox.provider.v1`, while `packages/boring-sandbox/src/index.ts` and `src/providers/index.ts` remain scaffolds. #835's head defines `SandboxProviderV1.create(context) -> WorkspaceSandboxPairV1`, provider capabilities, `checkHealth`, and paired disposal in the intended `packages/boring-sandbox/src/shared/providerV1.ts`; its create-time `sessionId` is not a per-chat execution scope. | Extend the landed V1 seam additively with a sanitized per-execution envelope/reporter in OB1. Add runtime lifecycle/health observations only in OB2, after the OB1 gate. `boring-sandbox` never imports Core or opens Postgres. |
| Bash/tool runtime boundary | Audited `main`'s [`packages/boring-bash/src/server/runtimeBindingManager.ts`](../../../packages/boring-bash/src/server/runtimeBindingManager.ts) owns scoped filesystem binding lifecycle, but shell/filesystem tools and Operations adapters still live under [`packages/agent/src/server/tools`](../../../packages/agent/src/server/tools). #831/#838 move them to `packages/boring-bash/src/agent/tools/**`. | After the swap, `boring-bash` carries trusted per-call execution scope to the sandbox provider. It does not own model-token facts, generic tool-call counting, or the control-plane store. |
| Durable events | [`packages/agent/src/shared/events.ts`](../../../packages/agent/src/shared/events.ts) defines `AgentEvent { v, eventIndex, timestamp, sessionId, chunk }`. [`packages/agent/src/server/events/eventStreamStore.ts`](../../../packages/agent/src/server/events/eventStreamStore.ts) supplies the one indexed SQLite store, and [`packages/agent/src/server/pi-chat/harnessPiChatService.ts`](../../../packages/agent/src/server/pi-chat/harnessPiChatService.ts) appends before live fanout when configured. #807 T1 makes that authority production-durable. | No second event bus, replay log, SSE route, or notification stream. Fact producers call the control-plane sink directly; the console uses bounded reads/polling. Any later push/event projection must consume #807 T1 rather than define a parallel envelope or store. |
| Session list | [`packages/agent/src/shared/session.ts`](../../../packages/agent/src/shared/session.ts) defines bounded `SessionStore.list`, and [`packages/agent/src/server/http/routes/piChat.ts`](../../../packages/agent/src/server/http/routes/piChat.ts) exposes the currently authorized workspace session list. Pi JSONL lives under the host session root through [`packages/agent/src/server/harness/pi-coding-agent/sessions.ts`](../../../packages/agent/src/server/harness/pi-coding-agent/sessions.ts). [`packages/workspace/src/front/chrome/session-list/SessionBrowser.tsx`](../../../packages/workspace/src/front/chrome/session-list/SessionBrowser.tsx) is existing session-list UI. | Add a read-only operator adapter for one selected workspace and trusted agent namespace. Do not copy transcripts into Postgres, scan every namespace globally, create a persistent session ownership index, or start a Workspace/Sandbox runtime merely to list sessions. |
| Console composition | [`packages/core/src/front/CompanyAdminProvider.tsx`](../../../packages/core/src/front/CompanyAdminProvider.tsx) and [`packages/core/src/front/workspace/CompanyAdminPage.tsx`](../../../packages/core/src/front/workspace/CompanyAdminPage.tsx) provide an app-composed admin page. Full-app supplies the tenant-governance implementation from [`plugins/boring-governance/src/front/GovernanceAdminView.tsx`](../../../plugins/boring-governance/src/front/GovernanceAdminView.tsx). | Reuse the app-composed console/page seam. The host owns platform-operator authentication and chooses placement. Do not reinterpret workspace owner/editor roles as platform-operator authority. |

## Problem

The repository observes useful fragments but has no durable, product-neutral
control-plane record joining them under trusted workspace, agent, and session
identity.

- Native token usage reaches the credit ledger only when billing metering is
  configured.
- Tool results and sandbox setup emit optional telemetry that may be disabled or
  dropped.
- Provider execution duration is returned to runtime callers but is not retained
  for operator aggregation.
- The existing session list is scoped to the current workspace interaction; no
  operator read path combines it with health and failures.

Reusing credits or generic telemetry as the authority would make observability
depend on billing policy or an optional analytics pipeline. Adding a new event
bus would duplicate #807. Allocating a workspace-shared runtime's wall-clock
lease across multiple chat sessions would create billing policy disguised as a
fact.

## Solution

Ship two strictly ordered work packages.

### OB1 — Product-neutral usage facts

1. Define one versioned, data-only fact union with trusted dimensions.
2. Persist it idempotently in a new Core Postgres table/store.
3. Record native model usage once per assistant usage record.
4. Record each generic agent tool call once at terminal completion.
5. Record provider-reported, chat-scoped sandbox executions across the extracted
   sandbox contract.
6. Prove bounded aggregation by workspace, agent, and session.

### OB2 — Operator read model and console

Only after OB1 is complete:

1. Add runtime lifecycle/provider-health observations and deterministic
   last-observed health projection.
2. Add host-authorized, read-only operator endpoints for app-wide workspace
   summaries and recent failures.
3. Add a selected-workspace session-list adapter over the existing host session
   store.
4. Render a compact console table and workspace drill-down.
5. Qualify the exact package cohort in the real control-plane host.

## Binding decisions

### 1. Trusted scope is required; callers never submit attribution

Every metered usage fact binds:

```text
appId + authorized workspaceId + trusted agentTypeId + runtime-owned sessionId
```

`workspaceId` comes from the authenticated Core resolution. `agentTypeId` comes
from Decision 26's immutable host binding after membership and workspace-type
validation. `sessionId` comes from the runtime/session service. Request bodies,
query parameters, arbitrary headers, model output, tool arguments, and sandbox
stdout cannot override any dimension.

The agent identity is called `agentId` in the fact/read DTOs for compactness but
means the trusted Step 1A `agentTypeId`; it is not an AgentHost deployment,
definition digest, mutable registry row, or client-supplied identifier.

Step 1A has one trusted agent per workspace type. If Step 2 multiple-agent work
lands before #819 implementation, stop and recut namespace/list queries rather
than assuming a default agent or merging several agents' facts.

### 2. One canonical write contract, not the credit ledger

Create `AgentUsageFactV1` and `AgentObservabilitySinkV1` in
`packages/agent/src/shared/observability.ts`, exported from
`@hachej/boring-agent/shared`. These are the one canonical, data-only OB1 write
union and direct sink port. They are realizable with the landed package graph: Core
already consumes agent, and #835 makes `boring-sandbox` use the agent shared
contract through its existing peer/type dependency. No producer imports Core.

Do not create parallel `SandboxExecutionFactV1` or Core-only producer DTOs.
`boring-sandbox` may expose only a narrowed scope/facade type derived from the
canonical shared export, and its injected reporter accepts the same canonical
union. Core implements `AgentObservabilitySinkV1` and stores the union in one
`agent_observability_facts` table. An exhaustive `never` contract test covers
every V1 producer kind and the import audit proves the dependency direction.
OB2's later runtime observation is a versioned V2 superset, not a mutation of
this completed V1 union.

The common columns are:

- `source_id`: producer identity described below; Core combines it with trusted
  scope/kind to create the stable `fact_id` primary key;
- `version`: `1` for OB1 usage facts; fwh.6 later admits the explicitly
  versioned runtime-observation V2 variant;
- `app_id`, `workspace_id`, `agent_id`;
- `session_id`, required for every OB1 usage kind;
- `kind`;
- `occurred_at`: producer-observed UTC time, stored as `timestamptz`;
- `recorded_at`: Postgres insertion time, stored as `timestamptz`;
- optional stable correlation ids (`run_id`, `request_id`) with
  bounded identifier grammar.

Kind-specific columns are typed and database-constrained; there is no arbitrary
metadata JSON escape hatch:

| Kind | Required payload | Meaning |
| --- | --- | --- |
| `model_usage` | provider/model when known; input, output, cache-read, cache-write tokens; optional native stop reason; product-neutral observation run and occurrence ids | One native assistant usage record. Zero-token provider reports remain facts and are distinguishable from no report. A tool-loop message may carry usage without being the terminal run state; no synthetic terminal status is stored. |
| `tool_call` | tool name; `ok`, `error`, or `aborted`; duration ms; stable error code on error | One model-visible `AgentTool` invocation, regardless of how many Operations/sandbox calls it performs. |
| `sandbox_execution` | provider id; sandbox id when available; operation kind; `ok`, `error`, `timeout`, or `aborted`; provider-measured duration ms; stable error code on failure | One provider operation with chat-session attribution. Its summed duration is sandbox execution time. |

Checks require non-negative safe integer token/duration values, recognized kind
and status combinations, and absence of unrelated kind columns. Indexes cover:

- `(app_id, occurred_at DESC, fact_id)` for bounded operator paging;
- `(workspace_id, agent_id, session_id, occurred_at DESC)` for drill-down and
  aggregation.

Do not add foreign keys to deleted AgentHost tables or any publication/runtime
registry. Workspace visibility is enforced by joining/revalidating the current
Core workspace/app authority at query time.

### 3. Idempotency is scope-bound and billing-independent

Core constructs every `fact_id` from a versioned, length-prefixed canonical
encoding of:

```text
kind + appId + workspaceId + agentId + sessionId-or-runtime-sentinel + producer identity
```

The server-side helper hashes that canonical encoding to a bounded identifier;
no browser/shared `Buffer` or `node:*` import is introduced. Producer identity
is kind-specific:

- model: a product-neutral `observationRunInstanceId` plus native message id when
  present, otherwise the deterministic usage occurrence ordinal within that
  accepted run;
- tool: Pi `toolCallId` plus terminal marker;
- sandbox execution: `toolCallId` plus the provider-operation ordinal/id
  allocated when that operation starts.

The raw `observationRunInstanceId` is a product-neutral cryptographically random
identifier allocated once after a prompt/follow-up is admitted and before its
model effect starts. The same in-memory run object reuses it for sink retries;
re-accepting the same client nonce/sequence creates a new instance id because it
is a new actual execution. Client nonce/sequence remain correlation only. This
id is not `promptRunId`, `reservationId`, or the incrementing process-local
`instanceId` in `packages/agent/src/server/pi-chat/metering.ts`. Thus raw capture
remains active when billing is absent, two workspaces/agents may safely reuse the
same public ids, and two real executions that reuse a nonce do not collide. The
occurrence counter distinguishes identical id-less tool-loop usage records
within one execution.

OB1 does not claim crash-replay deduplication: after a crash there is no raw
event replay in this plan, and a post-effect/pre-write crash remains the explicit
gap below. If #807 later replays usage-shaped input, that projection must persist
and reuse an execution identity under T1 rather than infer one from a nonce.

`INSERT ... ON CONFLICT DO NOTHING` is not sufficient. On conflict, the store
loads and compares every immutable field. An exact retry returns
`inserted: false`; a mismatched payload throws stable
`OBSERVABILITY_FACT_CONFLICT` and
logs the producer/kind without content.

Producers await their terminal write so normal process shutdown does not
discard an in-flight fact. A write failure never changes an already-completed
model/tool/sandbox outcome, never retries a side effect, and never substitutes a
credit charge. It is logged with stable `OBSERVABILITY_WRITE_FAILED`. There is
no memory queue, sidecar, broker, or second journal in OB1.

Because post-effect database failure can cause a gap, BL1 must not claim exact
billing from OB1 until #809 separately defines completeness, reconciliation,
and commercial policy. #819 reports what was durably observed.

### 4. Token facts are independent from billing metering

Use the existing native Pi normalization and correlation seam in
`packages/agent/src/server/pi-chat/metering.ts`, but add a separate
product-neutral path to the canonical `AgentObservabilitySinkV1`. It must operate
when credits are disabled and must not call
`reserveRun`, `settleRun`, `releaseRun`, `PostgresMeteringStore`, budget stores,
or any price function.

If both sinks are installed, one normalized native usage object feeds each
independently:

```text
native Pi usage
  -> raw AgentObservabilitySinkV1 (OB1; always product-neutral)
  -> optional AgentMeteringSink (existing credits/billing behavior)
```

The raw sink stores token quantities only. Provider-reported monetary cost and
host-billed cost stay out of `agent_observability_facts`.

The read model returns input, output, cache-read, and cache-write counters
separately. It does not invent a single “total tokens” by summing cache counters
with input/output because provider contracts may report overlapping categories.
The console labels the breakdown explicitly; #809 may price each native field
only under its later provider policy.

### 5. Generic tool counting stays in `boring-agent`

The single counting hook remains the generic wrapper in
`packages/agent/src/server/harness/pi-coding-agent/tool-adapter.ts`. That wrapper
sees standard tools, extracted boring-bash tools, trusted plugin tools, and
future sandbox-entrypoint tools uniformly. It records exactly one terminal fact
whether a tool returns `isError`, throws, or is aborted.

`boring-bash` owns the concrete shell/filesystem tool and Operations
implementations after #831/#838. It supplies the trusted execution scope when a
tool descends into the sandbox, but it does not increment the tool-call count.
This avoids double counting `bash -> Sandbox.exec` and multi-operation tools.

### 6. Sandbox minutes mean provider execution duration

For OB1, `sandbox minutes` is defined exactly as:

```text
sum(sandbox_execution.duration_ms) / 60_000
```

The raw store keeps integer milliseconds; API/UI conversion does not round the
stored value. Overlapping operations are summed because they are distinct
provider work. Host-only filesystem operations that never cross the sandbox do
not produce sandbox execution time.

This definition is deliberately not runtime-pair wall-clock lease uptime. The
runtime pair is workspace-keyed today—`registerAgentRoutes.ts` currently passes
`sessionId: workspaceId` while creating/provisioning a runtime—and future
same-workspace agents share it. Assigning a shared lease's wall time to one chat
session would be fabricated allocation policy. If a provider invoice or #809
requires lease uptime, idle time, concurrency weighting, or provider-rounded
billing minutes, that fires a separate named trigger and metric; it does not
reinterpret historical `sandbox_execution` facts.

After #835/#839 land, extend the actual
`packages/boring-sandbox/src/shared/providerV1.ts` additively:

- add `SandboxExecutionScopeV1` with trusted `appId`, `workspaceId`, `agentId`,
  `sessionId`, `toolCallId`, and `operationId` fields;
- add `WorkspaceSandboxPairV1.execution`, a provider-owned
  `SandboxExecutionV1` facade whose `exec(scope, ...)` and
  `executeIsolatedCode(scope, ...)` methods require that envelope; do not add
  caller attribution to ordinary `ExecOptions` or overload the create-time
  `SandboxProviderCreateContextV1.sessionId`, which is workspace-keyed today;
- inject `AgentObservabilitySinkV1` at provider composition and report the
  canonical `sandbox_execution` fact after the provider operation reaches a
  terminal result; and
- carry only provider id, sandbox id when available, operation kind/id, status,
  duration, and stable error code beside trusted scope.

The generic agent tool adapter creates/propagates the trusted `toolCallId` and
scope. Extracted `boring-bash` Operations receive the pair's scoped facade,
allocate `operationId` as that tool call plus a monotonically assigned operation
ordinal at call start, and call the facade for every model-visible sandbox
operation. Tool arguments cannot populate or override it. Two concurrent
sessions sharing the same workspace pair therefore keep distinct envelopes.
Provider setup/provisioning continues to use the pair's existing unscoped
provisioning operations; it has no chat session, emits no `sandbox_execution`,
and does not enter OB1 minutes. A later provider-lease billing trigger must
define it separately.

Providers never receive a Core DB handle. The callback carries no command,
arguments, environment, paths, stdout/stderr, stack, credentials, or runtime
handle. Provider conformance tests prove success, throw, timeout, abort,
idempotent retry, missing-scope rejection at the model-visible Operations seam,
and two concurrent chat sessions on one workspace pair.

### 7. OB2 health is last-observed evidence, not invented liveness

No runtime/health producer, query, DTO, or UI is implemented in fwh.1–fwh.5.
After OB1 passes, fwh.6 adds `AgentRuntimeObservationV2` and
`AgentObservabilitySinkV2`, a versioned superset of the V1 sink, and widens the
same table constraint/index in a second migration. The `sandbox_runtime` V2
payload is provider id; pair/sandbox id when available; `ready`, `retired`,
`create-error`, `retire-error`, `health-ok`, or `health-recreate`; observed time;
and optional stable error code. Its session id is null, and fwh.6 adds the
partial failure/runtime indexes needed by OB2. It never enters usage aggregates.

V1 usage reads always filter the three recognized V1 kinds/version and ignore
later rows. Fwh.6 adds a downgrade-compatibility test that runs the fwh.5 V1
read contract against a database containing V2 runtime rows. Rollback disables
the V2 producers/routes but keeps the widened migration and rows, so the fwh.5
cohort continues reading usage without parsing an unknown discriminant.

OB2 reports two explicit runtime fields:

- last lifecycle state: `loaded`, `not-loaded`, `error`, or `unknown`;
- last provider health probe: `ok`, `recreate`, or `unknown`, plus
  `observedAt`.

The lifecycle source is the existing agent-owned
`packages/agent/src/server/runtime/runtimeBindingLifecycle.ts`: the successful
`pending -> ready` transition emits `ready`; completed retirement emits
`retired`; creation/retirement failures emit their corresponding safe error
state. The deterministic projection is `ready -> loaded`, `retired ->
not-loaded`, either error -> `error`, and no observation -> `unknown`.
`SandboxProviderV1`'s `WorkspaceSandboxPairV1.checkHealth` is the health source
when a provider supports it. Existing normal runtime health checks may record
their result; reading the console does not create a runtime, start a poller, or
probe a stopped workspace. The UI always shows observation time and never
labels an old observation “currently healthy.” Tool failures appear separately
under recent failures and do not redefine sandbox health.

Each admitted runtime-binding entry receives one server-generated observation
instance id; lifecycle transition ordinal plus state forms its V2 source id.
Each normal provider health invocation receives its own observation id before
the probe. Exact sink retries reuse those ids; console reads never allocate
them. These are observations only, not a runtime registry or controller.

### 8. The control-plane DB is the only usage-fact store

Attach the new Drizzle table beside the existing usage/telemetry definitions in
`packages/core/src/server/db/schema.ts`, add an additive migration under
`packages/core/drizzle/`, and implement a dedicated
`PostgresObservabilityStore` under `packages/core/src/server/db/stores/`.

During OB1 the store owns:

- exact-idempotent inserts;
- bounded workspace/agent/session summaries over explicit `[from, to)` UTC
  windows; and
- database-to-usage-summary mapping.

Only fwh.6 adds cursor-paged recent-failure reads, runtime/health projection,
and operator-safe DTO mapping. This keeps OB2 implementation strictly after the
completed OB1 conformance gate.

It does not own producer execution, prices, credit state, provider clients,
session files, auth policy, or UI composition. Do not attach to or revive the
retired `agentHost*` schema that still exists on this audited historical
baseline.

### 9. Operator APIs are opt-in and host-authorized

Core supplies an optional read-only route module. It mounts only when the host
provides an `authorizeOperator(request)` function and the observability store.
Workspace owner/editor/viewer membership alone is not platform-operator
authorization.

Proposed routes:

```text
GET /api/v1/operator/observability/workspaces
GET /api/v1/operator/observability/workspaces/:workspaceId/failures
GET /api/v1/operator/observability/workspaces/:workspaceId/sessions
```

All routes:

- authenticate and authorize before workspace existence or metric disclosure;
- restrict workspaces to the current host app/control-plane scope;
- use bounded limits and stable `(occurredAt, factId)` cursors;
- accept an explicit bounded UTC window for aggregates;
- return stable safe errors; and
- expose no mutation.

The workspace route does not call the membership-filtered
`WorkspaceStore.list(userId, appId)` in
`packages/core/src/server/app/types.ts`. After operator authorization, a new
internal Core query starts from non-deleted `workspaces` for the host's exact
`appId`, then left-joins bounded usage aggregates and latest OB2 runtime
observations. This is the authoritative app-wide operator inventory: an in-app
workspace with zero facts still appears with zero usage and `unknown` health;
foreign-app and soft-deleted rows do not appear. The query is bounded and
cursor-paged by workspace identity/order, so it is neither a membership bypass
on user routes nor a fact-first partial inventory.

The workspace list returns identity/name, last-observed runtime/health, token
totals, tool total/failure count, sandbox execution milliseconds, and newest
fact time. The failure endpoint returns kind, safe name/provider, status,
duration, stable error code, session id, and timestamp. It never returns prompt
text, model output, tool parameters/results, command text, paths, stdout/stderr,
stack traces, or environment.

### 10. Session summaries remain on the host session volume

Session transcripts/history remain host app user data under
`BORING_AGENT_SESSION_ROOT`, per AGENTS.md and Decision 26. OB2 does not move or
duplicate transcripts into Postgres.

The operator sessions route uses a host-supplied read-only adapter that:

1. revalidates operator scope and the selected workspace;
2. resolves the workspace's trusted Step 1A agent type and deterministic session
   namespace;
3. invokes bounded `SessionStore.list` without constructing a Workspace/Sandbox
   pair; and
4. maps to a separate `OperatorSessionSummaryV1` containing only `id`,
   `createdAt`, `updatedAt`, `turnCount`, trusted `agentId`, and optional usage
   totals queried from Postgres.

It deliberately omits `SessionSummary.title`: the current shared type includes a
client-settable title, so it can contain prompt, command, path, or credential
text. It also returns no transcript preview. A hostile title redaction test
must prove the operator response does not contain the submitted title or any
credential/path canary.

The UI fetches sessions only after selecting a workspace. There is no unbounded
global filesystem scan, session ownership index, transcript search, or
cross-workspace transcript view.

### 11. The console reuses existing composition

Expose a reusable operator view through the existing app-composed admin page
shape rather than inventing a fleet/controller host. The real control-plane host
chooses navigation and supplies operator status/auth.

Minimum view:

- workspace table: workspace, last-observed runtime/health, tokens, tool calls,
  tool failures, sandbox execution minutes, latest activity;
- bounded time-window selector and manual refresh;
- workspace drill-down with recent failures and a read-only session list;
- empty, unavailable, unauthorized, and partial-data states.

No charts, alerts, dashboards framework, live stream, repair button, runtime
mutation, workspace impersonation, transcript body viewer, or billing controls
are needed for OB2.

### 12. #807 owns event-shaped delivery

The Postgres rows are facts written through direct typed calls; they are not a
new event log. The operator API uses normal bounded reads and front-end polling.

If a named consumer later requires live failure push, replayable alerts, or a
session task timeline, stop and consume the landed #807 T1 contract:

- keep `AgentEvent` as the sole agent event envelope;
- keep the one T1 event store/offset authority;
- append before live fanout;
- do not add a metric-event union, second SQLite file, broker, Durable Streams
  sidecar, or parallel SSE cursor.

The control-plane fact table remains the aggregate/query authority; an approved
projection may link to T1 by stable ids without duplicating task lifecycle.

## Package ownership after extraction

| Package | Owns | Explicitly does not own |
| --- | --- | --- |
| `@hachej/boring-agent` | Canonical `AgentUsageFactV1`/`AgentObservabilitySinkV1` shared export; trusted product-neutral run scope; native token observation; one generic terminal tool-call hook; in OB2, the versioned V2 runtime-observation/sink superset and runtime-binding lifecycle observations. | Credits/pricing, Postgres, concrete bash/fs operations, concrete sandbox providers, console UI. |
| `@hachej/boring-bash` | Concrete shell/filesystem tools and Operations; operation-id allocation and forwarding the trusted per-call scope through the sandbox scoped facade after #831/#838. | Generic tool-call counting, model usage, provider lifecycle, DB writes. |
| `@hachej/boring-sandbox` | `SandboxProviderV1`, concrete providers, OB1 scoped execution duration/status, and OB2 provider-health observations after #835/#839; type-only use of the one canonical agent fact/sink export. | A second fact DTO, Core auth, agent selection, prices, DB access, operator UI, agent runtime value imports. |
| `@hachej/boring-core` | V1 then V2 `AgentObservabilitySink` implementations; fact-id construction; Postgres schema/migrations/store; app-wide operator workspace query; safe aggregation/read DTOs; operator authorization hook/routes; reusable console view seam. | Executing model/tool/sandbox work, provider adapters, session transcript storage, billing policy. |
| `@hachej/boring-workspace` | Existing session-list presentation pieces where reuse is clean. | A new observability store, operator auth, runtime registry, fleet controller. |
| Host/control-plane app | Enabling writers/routes, operator identity/policy, trusted Step 1A mappings, navigation, exact package qualification and rollout. | Client-derived attribution, an app-private duplicate meter, a new runtime authority. |

## Failure semantics and stable errors

Add stable package-owned errors with safe public messages:

| Code | Owner | Meaning |
| --- | --- | --- |
| `OBSERVABILITY_FACT_INVALID` | Agent shared contract/Core adapter | Fact violates V1 shape or trusted dimensions. |
| `OBSERVABILITY_FACT_CONFLICT` | Core store | Stable fact id exists with different immutable content. |
| `OBSERVABILITY_WRITE_FAILED` | Producer logging boundary | Control-plane persistence failed after/beside work; original execution result remains authoritative. |
| `OBSERVABILITY_NOT_CONFIGURED` | Core route | Optional store/session reader is absent; route normally remains unmounted. |
| `OBSERVABILITY_WINDOW_INVALID` | Core route | Time window/limit/cursor is malformed or out of bounds. |
| `OPERATOR_FORBIDDEN` | Host/Core route | Authenticated principal lacks host-defined operator authority. |

Unknown workspace, foreign app, and unauthorized operator handling follows
Core's existing non-disclosure ordering. Provider/tool errors retain their
existing stable code inside the sanitized fact; unknown error text is never
stored as a substitute.

## Test seams

### Highest public seams

- Drizzle migration plus `PostgresObservabilityStore` conformance.
- Native Pi usage -> raw fact sink, independently of credit metering.
- Generic `AgentTool` adapter -> one terminal fact.
- Each landed `SandboxProviderV1` implementation -> execution/runtime fact
  conformance.
- Core operator route auth, paging, aggregation, and redaction.
- Read-only session reader over a selected trusted namespace.
- App-composed console view and real host qualification.

### Existing prior art

- Migration/store setup:
  [`packages/core/src/server/db/migrate.ts`](../../../packages/core/src/server/db/migrate.ts),
  [`packages/core/src/server/db/__tests__/migrate.test.ts`](../../../packages/core/src/server/db/__tests__/migrate.test.ts),
  and
  [`packages/core/src/server/db/stores/__tests__/PostgresMeteringStore.test.ts`](../../../packages/core/src/server/db/stores/__tests__/PostgresMeteringStore.test.ts).
- Native usage lifecycle:
  [`packages/agent/src/server/pi-chat/__tests__/metering.test.ts`](../../../packages/agent/src/server/pi-chat/__tests__/metering.test.ts).
- Generic tool lifecycle:
  [`packages/agent/src/server/harness/pi-coding-agent/__tests__/tool-adapter.telemetry.test.ts`](../../../packages/agent/src/server/harness/pi-coding-agent/__tests__/tool-adapter.telemetry.test.ts).
- Provider conformance pattern: #835's intended
  `packages/boring-sandbox/src/providers/__tests__/conformance/` plus current
  [`packages/boring-sandbox/src/shared/__tests__/providerMatrix.test.ts`](../../../packages/boring-sandbox/src/shared/__tests__/providerMatrix.test.ts).
- Session route/list:
  [`packages/agent/src/server/http/routes/__tests__/piChat.test.ts`](../../../packages/agent/src/server/http/routes/__tests__/piChat.test.ts).
- Admin composition:
  [`packages/core/src/front/__tests__/CompanyAdminPage.test.tsx`](../../../packages/core/src/front/__tests__/CompanyAdminPage.test.tsx).

### Required fault and negative matrix

1. same fact exact retry versus mismatched collision;
2. zero/maximum token and duration boundaries; reject negative, fractional,
   overflowing, NaN, and infinite values;
3. token observation with billing sink absent, present, rejecting, and disabled;
4. tool success, returned error, throw, abort, and fact-store failure without a
   second tool effect;
5. sandbox success, non-zero exit, provider throw, timeout, abort, missing
   sandbox id, concurrent same-workspace/different-session execution, and
   rejection of model-visible execution without trusted scope;
6. same public session id in two workspaces/agents cannot collide or aggregate;
7. unauthenticated, non-operator, foreign app/workspace, spoofed agent/session,
   malformed cursor/window, and over-limit requests;
8. redaction corpus containing prompts, commands, paths, stdout, stack traces,
   tokens, credential-like strings, and a hostile session title never reaches
   stored/returned fields;
9. session list uses one selected namespace and causes zero runtime/provider
   create calls;
10. the operator workspace inventory includes an in-app zero-fact workspace
    with zero/unknown state, but excludes foreign-app and deleted workspaces;
11. lifecycle ready/retired/error and provider ok/recreate project
    deterministically with observation time and without a console-triggered
    probe; and
12. OB1 data remains readable after writer/UI disable and forward app restart.

### Avoid testing

- credit prices, grants, balances, holds, budgets, or payment providers;
- external APM delivery;
- private helper implementation when store/route/provider conformance proves it;
- transcript content or global session search;
- workspace-shared lease allocation;
- deleted AgentHost/controller/CAS/publication behavior; or
- a new event transport.

## Acceptance

#819 is complete only when:

1. #391 Step 1A.10b and the landed extraction ownership gates are recorded
   before the first code Bead starts;
2. every stored usage fact carries trusted app/workspace/agent/session identity
   and validates against V1;
3. model tokens are recorded when credits are off and contain no monetary
   fields;
4. every model-visible tool call produces at most one exact terminal fact, while
   one tool may legitimately produce several sandbox execution facts;
5. provider-reported execution durations aggregate exactly to sandbox execution
   milliseconds/minutes by workspace, agent, and session;
6. latest runtime/health evidence and recent safe failures are queryable from
   control-plane Postgres;
7. operator auth precedes all workspace/fact/session disclosure;
8. selected-workspace session listing uses the durable host session store and
   creates no runtime/sandbox;
9. the console renders bounded workspace summaries, recent failures, and
   sessions, including safe empty/error/unauthorized states;
10. no prompt, output, tool args/results, command, path, stdout/stderr, stack,
    environment, credential, or runtime handle is stored or returned;
11. no billing logic, external APM choice, new event bus, AgentHost, controller,
    CAS, publication journal, mutable runtime registry, or second runtime owner
    is introduced;
12. focused package gates, repository invariants, exact consumer qualification,
    and independent review are green; and
13. rollback disables writers/routes/UI without deleting facts, session history,
    or workspace data.

## Proposed Bead chain — do not create in this planning PR

The stable aliases are proposed plan ids. Physical Bead ids may differ later,
but titles, OB ordering, gates, and dependency edges remain intact. This PR
makes zero `.beads` edits.

### fwh.1 — Freeze V1 scope and verify activation/ownership gates (OB1)

**Delivers:** Record the completed Step 1A proof, re-audit `main`, verify both
package extraction swaps, freeze the exact trusted agent/session identity and
landed `SandboxProviderV1` paths, and add a short proof note. No schema or
producer code.

**Depends on:** merged #819 plan; completed #391 1A.10b; merged #835/#839 and
#831/#838.

**Machine-checkable acceptance gate:**

```bash
set -euo pipefail
br show wt-391-forward-o0b.27 --json \
  | jq -e '.[0].status == "closed" and .[0].id == "wt-391-forward-o0b.27"'
test -f docs/issues/819/proof/activation.json
jq -e '
  .schema == "boring-observability-activation:v1" and
  .step1A10b.beadId == "wt-391-forward-o0b.27" and
  .step1A10b.status == "complete" and
  .step1A10b.rollbackExecuted == true and
  (.step1A10b.proofUrl | type == "string" and length > 0) and
  (.step1A10b.boringUiSha | test("^[0-9a-f]{40}$"))
' docs/issues/819/proof/activation.json
activation_sha="$(jq -r '.step1A10b.boringUiSha' docs/issues/819/proof/activation.json)"
git merge-base --is-ancestor "$activation_sha" HEAD
for pr in 831 835 838 839; do
  merge_sha="$(gh pr view "$pr" --repo hachej/boring-ui \
    --json state,mergeCommit \
    --jq 'if .state == "MERGED" then .mergeCommit.oid else "" end')"
  [[ "$merge_sha" =~ ^[0-9a-f]{40}$ ]]
  git merge-base --is-ancestor "$merge_sha" HEAD
done
test -f packages/boring-sandbox/src/shared/providerV1.ts
grep -q 'interface SandboxProviderV1' packages/boring-sandbox/src/shared/providerV1.ts
test -f packages/boring-bash/src/agent/tools/harness/index.ts
test ! -f packages/agent/src/server/sandbox/vercel-sandbox/createVercelSandboxExec.ts
test ! -f packages/agent/src/server/sandbox/direct/createDirectSandbox.ts
test ! -f packages/agent/src/server/sandbox/bwrap/createBwrapSandbox.ts
test ! -d packages/agent/src/server/tools/operations
pnpm lint:invariants
git diff --check
```

The activation manifest names the exact Step 1A.10b proof/rollback and consumed
Boring UI SHA. The retained agent-owned Vercel readiness helper is allowed;
concrete providers and Operations ownership are what this gate checks. Any
failed gate stops execution and amends this plan; it does not copy code back
into `boring-agent`.

**Review budget:** 15–20 minutes, package-ownership review.

### fwh.2 — Persist exact control-plane observability facts (OB1)

**Delivers:** canonical V1 usage fact/sink export, additive Drizzle migration,
`PostgresObservabilityStore`, scope-bound fact-id construction,
exact-idempotent inserts, and windowed usage aggregates. No producers, failure
read model, runtime/health kind, operator DTO, route, or UI.

**Depends on:** `fwh.1`.

**Machine-checkable acceptance gate:**

```bash
pnpm --filter @hachej/boring-agent exec vitest run \
  src/shared/__tests__/observabilityContract.test.ts
pnpm --filter @hachej/boring-agent run typecheck
pnpm --filter @hachej/boring-agent run build
pnpm --filter @hachej/boring-core exec vitest run \
  src/server/db/__tests__/migrate.test.ts \
  src/server/db/stores/__tests__/PostgresObservabilityStore.test.ts \
  src/server/observability/__tests__/contractMapping.test.ts
pnpm --filter @hachej/boring-core run typecheck
pnpm --filter @hachej/boring-core run build
pnpm audit:imports
git diff --check
```

Tests prove the published Agent shared export before Core consumes it and cover
all three OB1 kinds/shapes, exhaustive producer mapping, exact
retry/collision, numeric limits, indexes/query ordering, same-session/message
cross-scope isolation, and populated/fresh DB migration. The import audit proves
that agent/sandbox/bash do not import Core and sandbox uses the canonical shared
fact/sink type rather than a duplicate.

**Rollback:** leave the additive table/migration in place; disable all writers.

**Review budget:** 30–45 minutes with migration/security review.

### fwh.3 — Record native token and generic tool-call facts (OB1)

**Delivers:** product-neutral agent sink, trusted `agentId` in run/tool scope,
native token observation independent of billing, and one generic terminal tool
fact. No sandbox facts or read API.

**Depends on:** `fwh.2`.

**Machine-checkable acceptance gate:**

```bash
pnpm --filter @hachej/boring-agent exec vitest run \
  src/server/pi-chat/__tests__/usageFacts.test.ts \
  src/server/pi-chat/__tests__/metering.test.ts \
  src/server/harness/pi-coding-agent/__tests__/tool-adapter.usageFacts.test.ts
pnpm --filter @hachej/boring-agent run typecheck
pnpm --filter @hachej/boring-agent run lint:invariants
git diff --check
```

Tests prove credits-off capture, credits-on independence, no monetary fields,
scope-bound product-neutral run-instance/occurrence identity (including two
scopes with the same session/message ids, the same nonce admitted for two actual
executions, exact retry within one execution, and distinct id-less tool-loop
records), one tool fact across terminal paths, redaction, and no repeated effect
when fact persistence fails.

**Rollback:** omit the raw usage sink; existing billing and telemetry behavior
remain unchanged.

**Review budget:** 30–45 minutes with metering/tool-lifecycle review.

### fwh.4 — Report chat-scoped sandbox execution facts through V1 (OB1)

**Delivers:** additive `WorkspaceSandboxPairV1.execution` scoped facade,
provider conformance, boring-bash call-scope/operation-id forwarding, and
provider execution duration/error facts. Provisioning and runtime/health
observations remain excluded. No Core imports in runtime packages.

**Depends on:** `fwh.3`.

**Machine-checkable acceptance gate:**

```bash
pnpm --filter @hachej/boring-sandbox exec vitest run \
  src/shared/__tests__/providerV1.test.ts \
  src/providers/__tests__/conformance/observabilityFacts.test.ts
pnpm --filter @hachej/boring-bash exec vitest run \
  src/agent/tools/__tests__/sandboxUsageScope.test.ts
pnpm --filter @hachej/boring-sandbox run typecheck
pnpm --filter @hachej/boring-bash run typecheck
pnpm lint:invariants
pnpm audit:imports
git diff --check
```

Conformance runs direct, bwrap, and Vercel providers through success/error/
timeout/abort, proves provider-measured duration and safe payloads, and asserts
two concurrent sessions on one workspace pair never cross-attribute. It rejects
missing trusted scope at the model-visible Operations seam, proves provisioning
emits no per-session fact, and proves one tool call can emit N sandbox execution
facts without changing the tool-call count.

**Rollback:** omit the provider reporting port; provider behavior and paired
lifecycle remain unchanged.

**Review budget:** 45–60 minutes with package/isolation review.

### fwh.5 — Prove OB1 usage metering end to end (OB1)

**Delivers:** Core composition of the raw sink; cross-package conformance fixture
covering model -> tool -> sandbox; exact workspace/agent/session aggregates;
and writer disable/re-enable proof. It adds no runtime/health writer, failure
query, operator DTO/route, session reader, or UI.

**Depends on:** `fwh.4`.

**Machine-checkable acceptance gate:**

```bash
pnpm --filter @hachej/boring-core exec vitest run \
  src/app/server/__tests__/createCoreWorkspaceAgentServer.observability.test.ts
pnpm --filter @hachej/boring-agent exec vitest run \
  src/server/pi-chat/__tests__/observability.conformance.test.ts
pnpm --filter @hachej/boring-core run typecheck
pnpm --filter @hachej/boring-agent run typecheck
pnpm lint:invariants
pnpm audit:imports
git diff --check
```

The fixture asserts exact token totals, one tool call, provider execution-ms
sum, no costs/content/secrets, idempotent replay, and no use of telemetry or the
credit ledger as the fact authority.

**Rollback:** disable the composed sink; retained facts remain queryable.

**Review budget:** 30–45 minutes. OB1 is not complete until this gate passes.

### fwh.6 — Add runtime evidence and the OB2 Core read model (OB2)

**Delivers:** versioned V2 runtime-observation/sink superset and additive
migration; agent lifecycle and provider-health hooks; deterministic
last-observed projection; V1 downgrade-compatible usage reads; opt-in operator
read-store methods for an app-wide non-deleted workspace inventory left-joined
to bounded summaries; and failure cursors. No route, session reader, or UI.

**Depends on:** `fwh.5` (OB1 complete).

**Machine-checkable acceptance gate:**

```bash
pnpm --filter @hachej/boring-core exec vitest run \
  src/server/db/__tests__/migrate.test.ts \
  src/server/db/stores/__tests__/PostgresObservabilityStore.runtime.test.ts
pnpm --filter @hachej/boring-agent exec vitest run \
  src/server/runtime/__tests__/runtimeBindingObservability.test.ts
pnpm --filter @hachej/boring-sandbox exec vitest run \
  src/providers/__tests__/conformance/healthObservations.test.ts
pnpm --filter @hachej/boring-core run typecheck
pnpm --filter @hachej/boring-agent run typecheck
pnpm --filter @hachej/boring-sandbox run typecheck
pnpm lint:invariants
pnpm audit:imports
git diff --check
```

Tests prove lifecycle/health projection and timestamps, bounded windows/cursors,
app/workspace/agent isolation, and fwh.5 V1-reader compatibility against retained
V2 rows. The app-scoped store query returns every current non-deleted workspace
in the requested app, including a zero-fact workspace with zero usage/unknown
health, while foreign-app and deleted rows remain absent. No read triggers a
provider probe or runtime creation.

**Rollback:** omit the runtime/health observation hooks; stored usage/runtime
facts remain and no route has shipped yet.

**Review budget:** 30–45 minutes with migration/runtime-contract review.

### fwh.7 — Add host-authorized routes and scoped sessions (OB2)

**Delivers:** opt-in operator authorization hook/routes over fwh.6's bounded
read model; selected-workspace `OperatorSessionSummaryV1` adapter; zero runtime
creation; stable errors/redaction. No UI.

**Depends on:** `fwh.6`.

**Machine-checkable acceptance gate:**

```bash
pnpm --filter @hachej/boring-core exec vitest run \
  src/server/routes/__tests__/operatorObservability.test.ts
pnpm --filter @hachej/boring-agent exec vitest run \
  src/server/observability/__tests__/operatorSessionReader.test.ts
pnpm --filter @hachej/boring-core run typecheck
pnpm --filter @hachej/boring-agent run typecheck
pnpm lint:invariants
git diff --check
```

Tests prove auth before existence/metric/session disclosure, bounded route
inputs, and app/workspace/agent isolation. A non-member authorized operator can
read the app-scoped zero-fact workspace while non-operators cannot. Session
tests use hostile secret/path/prompt titles and prove the operator DTO omits
them, reads one selected namespace, and makes zero Workspace/Sandbox/provider
creation calls.

**Rollback:** unmount the optional route module; agent/session routes and stored
facts remain unchanged.

**Review budget:** 30–45 minutes with auth/security review.

### fwh.8 — Build the operator console view (OB2)

**Delivers:** app-composed workspace table, time window/manual refresh,
last-observed health, recent failure drill-down, read-only session list, and
empty/error/unauthorized/partial-data states. No actions or live stream.

**Depends on:** `fwh.7`.

**Machine-checkable acceptance gate:**

```bash
pnpm --filter @hachej/boring-core exec vitest run \
  src/front/__tests__/OperatorObservabilityView.test.tsx \
  src/front/__tests__/CompanyAdminPage.test.tsx
pnpm --filter @hachej/boring-core run typecheck
pnpm --filter @hachej/boring-core run build
git diff --check
```

Component tests cover all required states, exact units, timestamps, paging,
keyboard navigation, accessible table/detail labels, no mutation controls, and
no requests before operator status is authorized.

**Rollback:** remove the host navigation/composition option; read APIs may
remain dark.

**Review budget:** 30–45 minutes plus visual/accessibility review.

### fwh.9 — Qualify the real control-plane host and rollback (OB2)

**Delivers:** exact package cohort packed/published through the normal process;
real console operator authorization; at least two workspaces and sessions;
token/tool/sandbox/failure evidence; restart; writer/UI rollback and restore;
and a redacted proof record under `docs/issues/819/proof.md`.

**Depends on:** `fwh.8`; release-owner approval/credentials; a real Seneca or
equivalent control-plane console checkout with completed Step 1A.

**Machine-checkable acceptance gate:**

```bash
set -euo pipefail
pnpm lint
pnpm typecheck
pnpm test
pnpm lint:invariants
pnpm e2e
test -f docs/issues/819/proof.md
test -f docs/issues/819/proof/qualification.json
jq -e '
  .schema == "boring-observability-qualification:v1" and
  (.implementationSha | test("^[0-9a-f]{40}$")) and
  (.hostCommit | type == "string" and length > 0) and
  (.image | type == "string" and length > 0) and
  (.packages | type == "array" and length > 0 and
    all(.[]; (.name | type == "string" and length > 0) and
      (.version | type == "string" and length > 0))) and
  ((.scenarios | map(select(.status == "pass") | .id)) as $passed |
    (["two-workspace-isolation", "token-tool-sandbox-failure", "restart", "writer-ui-disable", "retained-reads", "restore"]
      - $passed | length == 0)) and
  .rollback.executed == true and
  .reviews.security == "approved" and
  .reviews.product == "approved" and
  .reviews.operations == "approved"
' docs/issues/819/proof/qualification.json
implementation_sha="$(jq -r '.implementationSha' docs/issues/819/proof/qualification.json)"
git merge-base --is-ancestor "$implementation_sha" HEAD
git diff --check
```

The redacted prose proof links the evidence; the structured manifest makes its
exact commit/image/package cohort, scenarios, executed rollback, and three
independent approvals fail closed in CI. Secret values, domains that require
redaction, commands, paths, prompts, and transcript content never enter either
artifact.

**Rollback:** disable writers/routes/navigation while preserving the additive
table and host session volume; restore the qualified cohort and re-read the same
safe aggregates/sessions.

**Review budget:** 45–60 minutes plus release owner and host operator.

### Dependency graph

```text
merged plan + completed #391 1A.10b + merged #835/#839 + merged #831/#838
-> fwh.1 -> fwh.2 -> fwh.3 -> fwh.4 -> fwh.5
                                      OB1 complete |
                                                   v
                          fwh.6 -> fwh.7 -> fwh.8 -> fwh.9
                                  OB2
```

Before future Bead dispatch, the graph owner must create the approved graph with
`br`, then run `br dep cycles` and `bv --robot-insights`; never bare `bv`.

## Rollout and rollback

1. Land the additive schema/store with no producer configured.
2. Enable raw writers in a non-production/test host and compare deterministic
   fixture totals.
3. Enable writers in one control-plane host; observe write errors and query
   latency. Do not backfill old sessions or credit rows.
4. Mount operator reads only after host authorization is proven.
5. Mount the console page after the read API is qualified.
6. Prove restart and writer/route/UI disable/re-enable without deleting facts or
   session history.

Rollback is configuration/composition removal, not schema rollback. The table
and rows remain inert. No down migration or destructive cleanup is required.

## Explicit non-goals

- Billing, prices, credits, reservations, budgets, quotas, invoices, refunds,
  entitlements, provider-cost reconciliation, or payment UI (#809/BL1).
- Choosing Datadog, an OpenTelemetry vendor/collector, or any external SaaS APM.
- Replacing or making correctness depend on optional PostHog/DB telemetry.
- A new event bus, event envelope, durable stream, broker, sidecar, SSE route,
  WebSocket, alert stream, or notification system; #807 T1 owns event-shaped
  delivery.
- AgentHost, controller, CAS, deployment/revision resolver, publication journal,
  mutable runtime/agent registry, scheduler, daemon, or second Workspace/Sandbox
  authority.
- Allocating workspace-shared runtime lease uptime to chat sessions, provider
  invoice rounding, idle-time attribution, or concurrent-use apportionment.
- Persisting prompts, outputs, reasoning, tool arguments/results, commands,
  paths, stdout/stderr, stacks, environment, credentials, or runtime handles.
- Moving transcripts/session history into Postgres, creating a global session
  index/search, or loading every workspace's sessions on the workspace list.
- Retention/pruning, historical backfill, data export/warehouse, charts,
  alerting/SLOs, automated repair, workspace impersonation, or mutation controls.
- Step 2 selectors/delegation, Step 3 A2A/MCP durability, contracted agents, or
  marketplace features.

## Trigger-gated follow-ons

| Waiting work | Exact trigger | Required recut | Still forbidden before trigger |
| --- | --- | --- | --- |
| Billing consumption | #809/BL1 has an approved pricing, reconciliation, completeness, refund, and audit contract | Consume immutable OB1 facts through a separately reviewed billing projection; define missing-fact handling | No price/cost/balance fields or hard stops in #819 |
| Provider lease minutes | A named provider invoice or contract requires wall-clock lease/idle accounting | Add a distinct provider lease metric with provider receipt identity and explicit shared-runtime allocation policy | Never reinterpret `sandbox_execution.duration_ms` |
| Live operator updates/alerts | A named operator cannot meet the need with bounded refresh and #807 T1.4 is landed | Project/link through the canonical durable `AgentEvent`/offset contract and one event store | No second bus, SSE cursor, metric event union, or broker |
| Multiple agents per workspace | #391 Step 2 is approved before/after #819 | Recut trusted agent namespace selection, session listing, and shared-runtime attribution; preserve separate agent totals | No `default` fallback or merged agent bucket |
| Horizontal replicas | A real second tenant/replica or measured writer contention requires it | Define DB concurrency, provider fact ownership, dedupe, and operational proof | No lease controller or mutable runtime registry |
| Retention/pruning | Measured table growth plus owner-approved audit/retry window names a limit | Add partition/retention policy that preserves required billing/audit windows and proves backups | No silent deletion or arbitrary TTL |
| External APM | An operator names a concrete diagnostic gap that the control-plane view cannot answer | Compare vendor-neutral export options in a separate decision | No vendor selection or SDK dependency here |

## Stop conditions

Stop and amend this plan rather than improvise if:

1. Step 1A does not land a trusted agent identity usable at the producer and
   operator session seams;
2. final #835/#839 or #831/#838 package ownership differs materially from the
   audited PR heads;
3. recording a fact would require tool args/results, commands, output, paths,
   environment, credentials, or raw error text;
4. sandbox execution duration cannot be reported with a stable provider
   operation id and trusted chat-session scope;
5. an implementation tries to use credit/telemetry rows as the only raw
   observability authority;
6. operator reads would start a runtime or scan all session namespaces;
7. a console view requires platform-operator authority to be inferred from a
   workspace membership role;
8. a proposed live view requires a second event envelope/store instead of
   #807 T1;
9. BL1 demands billable completeness or shared-lease allocation from OB1
   without a separate approved billing/reconciliation plan; or
10. any AgentHost/controller/CAS/publication/mutable-registry concept appears
    necessary to complete OB1 or OB2.

## Proof path and next action

This plan is the canonical artifact. After owner and required plan review:

```text
/skill:exec fwh.1
```

is the next action only when Step 1A.10b and all four extraction PR gates are
actually satisfied. Until then, state remains `ready-for-human` and no code or
Bead mutation is authorized.
