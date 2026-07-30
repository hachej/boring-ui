---
github: https://github.com/hachej/boring-ui/issues/896
issue: 896
state: ready-for-agent
updated: 2026-07-29
track: owner
---

# gh-896 Replace shutdown callbacks with a managed host-worker intent

## Problem

PR #906 adds the hosted Automation scheduler and correctly enforces this shutdown order:

1. stop admitting timer ticks;
2. let an admitted tick finish while AgentHost dispatch remains usable;
3. close worker-owned resources needed only by that worker;
4. close AgentHost admission, then drain and close AgentHost.

The implementation currently expresses that order as a raw plugin callback contribution:

```ts
shutdown: {
  begin(): void | Promise<void>
  drain(): Promise<void>
}
```

Workspace collects the callback, Core/Workspace forward it, and Agent duplicates it as `AgentShutdownParticipant`. AgentHost then changes its drain algorithm depending on whether participants exist. Automation also owns separate Fastify `onReady` and `onClose` scheduler hooks. The same scheduler therefore has split ownership and duplicate stop paths.

This is mechanically correct but the wrong public abstraction. It describes *how another component should shut the plugin down* rather than the plugin's intent: *this trusted plugin owns one process-level background worker whose admitted work depends on AgentHost*.

The branch has not merged, so there is no compatibility requirement for `shutdown`, `shutdownParticipants`, or `AgentShutdownParticipant`. They should be replaced rather than deprecated.

## Solution

Introduce one narrow, host-owned background-worker primitive. A trusted boot-time server plugin may declare a finite set of process-level workers. Each worker supplies a lifetime promise:

```ts
type AgentHostWorkerLogger = Pick<FastifyBaseLogger, 'debug' | 'info' | 'warn' | 'error'>

interface AgentHostWorkerIntent {
  readonly id: string
  run(context: {
    readonly signal: AbortSignal
    readonly logger: AgentHostWorkerLogger
  }): Promise<void>
}
```

Contract:

- `run()` starts exactly once from Fastify `onListen`, after global readiness has completed successfully and the server begins listening. Non-listening embeddings must call the explicit Host start method after completing their own readiness barrier.
- The returned promise represents the worker's complete lifetime.
- It must remain pending during normal operation.
- Abort means “stop admitting new work and drain work already admitted.” Worker abort listeners must not throw; native `AbortSignal` listener exceptions cannot be contained by the caller.
- The promise may resolve only after timers, callbacks, and child promises owned by that worker are stopped/joined.
- Unexpected resolve/reject before abort is a worker failure and is logged with a stable worker id; it does not crash the process or trigger an implicit restart.
- The host aborts workers before AgentHost admission closes, awaits every worker, and only then drains AgentHost.
- Worker startup/cardinality/lifecycle belongs to AgentHost, not plugin routes.

For #906 this is intentionally a lifetime-runner primitive, not a scheduler framework or general supervisor.

Automation contributes one worker, `boring-automation/hosted-scheduler`, whose lifetime owns scheduler start, cancellation, active-tick drain, and hosted event-bus disposal. HTTP routes continue to share the same `HostedDueCoordinator`, but no route hook starts or stops the scheduler.

## Decisions

### 1. Name it a host worker, not an agent worker

The scheduler scans creators/workspaces across the hosted process. It is not instantiated per agent type, runtime binding, workspace, or actor. `hostWorkers`/`AgentHostWorkerIntent` communicates once-per-Host cardinality and avoids multiplying the scheduler in a multi-agent fleet.

### 2. Use a lifetime promise plus AbortSignal

An AbortSignal alone is not structured concurrency: JavaScript permits a callback to spawn timers/promises and return immediately. The normative join contract is therefore the promise returned by `run()`. A conforming worker resolves only after abort and after all admitted descendants are joined.

Do not expose equivalent `start`, `begin`, `drain`, and `stop` callbacks under a new name.

### 3. Host owns lifecycle; Fastify only supplies readiness and logging

Worker intents are collected before `createAgentHost()`. AgentHost stores them and exposes idempotent lifecycle phases used by every projection/app path:

```ts
host.startWorkers({ logger })
host.beginDrain()
await host.drain() // explicit/embedder use
await host.close() // implicitly drains; Fastify onClose uses this alone
```

Semantics:

- `startWorkers` starts all workers once. Listening apps call it from Fastify `onListen`, so a failed readiness phase starts no worker. No production non-listening embedding currently exists in-repo; explicit invocation after an embedder-owned readiness barrier is a test/SDK affordance.
- `beginDrain` synchronously marks Host closing and aborts every worker signal. Worker abort listeners are contractually non-throwing. It must return promptly and is safe in timed `preClose`.
- `drain` first joins all worker lifetime promises while previously admitted AgentHost dispatch remains usable, then closes AgentHost admission and drains runtime effects.
- `close` is idempotent and completes remaining binding/resource cleanup.
- Repeated calls and close-before-ready are safe.

The API is fixed as `CreateAgentHostOptions.hostWorkers` plus `AgentHostHandle.startWorkers`, `beginDrain`, `drain`, and `close`; worker arrays never appear on HTTP projection options. The phase algorithm is unconditional and must not branch on `workers.length`.

Legacy binding admission is registered into Host at projection mount time. Host permits at most one legacy binding lifecycle; a second registration fails boot with a coded `AGENT_HOST_LIFECYCLE_CONFLICT` error rather than the current uncoded `TypeError`. `drain()` aborts workers, awaits all started lifetimes with all-settled semantics, closes legacy binding admission, then drains runtime effects. It advances to `drained` after all cleanup attempts even when it rejects with the first normalized failure. `close()` internally captures any drain error, closes legacy bindings and remaining Host resources regardless, advances to `closed`, then rejects with the retained first failure. Repeated terminal `drain()`/`close()` calls preserve state and rethrow the retained normalized failure.

### 4. One lifecycle implementation

The managed-worker algorithm lives in AgentHost. Every Fastify projection uses the same error-safe mapping: `onListen -> host.startWorkers({ logger })`, prompt `preClose -> host.beginDrain()`, and untimed `onClose -> host.close()`. `close()` is the sole projection cleanup call because it implicitly drains and guarantees later cleanup even when worker drain fails. The addressed projection must stop calling full `host.drain()` from `preClose`. `createAgentApp`, legacy route projection, and addressed HTTP projection never iterate worker arrays or duplicate error aggregation.

Workspace and Core only collect/name worker intents and pass them at Host construction. They do not execute worker callbacks.

### 5. Namespace worker identity at composition

Plugin-local worker ids are stable within the plugin. Bootstrap produces a diagnostic id such as `boring-automation/hosted-scheduler`. Duplicate final ids fail during boot with a stable error code. Diagnostics always include the final id, never raw plugin state or secrets.

### 6. Trusted boot-time plugins only

Only app/prebuilt plugins and directory entries explicitly marked `trust: "internal"` may contribute Host workers. Generated or untrusted directory plugins must not gain background execution or AgentHost lifecycle authority. Import `hotReload` mode does not grant or remove authority: admitted workers are captured once at boot and never replaced by diagnostic re-imports.

Trust must be enforced while the resolved `DirPluginEntry` provenance is still available. Generalize the existing privileged bridge assertion in `pluginEntryResolver.ts` to validate all privileged Host contributions in both Workspace and Core resolution loops before bootstrap erases provenance. `bootstrapServer` validates shape, ids, and namespacing only.

This is lifecycle correctness and least-authority ergonomics, not a malicious-plugin sandbox; trusted server plugins already execute in-process code.

### 7. Do not add multi-agent capabilities in this slice

Workers receive cancellation and logging only. Automation continues to use its existing trusted dispatcher closure. Raw AgentHost/Gateway access, scope issuance, fleet discovery, operation grants, and arbitrary agent-type selection are out of scope and require a separate security-reviewed design.

### 8. Preserve existing actor authorization

Hosted due evaluation continues to verify every candidate actor before request-free resolution. No long-lived actor capability is stored in the process-level worker. The worker merely invokes the existing `HostedDueRunService`; authorization remains per candidate/run.

### 9. Worker-owned resource ordering is explicit

Automation routes borrow the event bus: they neither start nor close it. Event-bus ownership is explicit, never inferred from `options.eventBus`. `createBoringAutomationServerPlugin` receives an ownership marker such as `eventBusOwner: "composition" | "caller"`; external/injected buses default to caller-owned, while `defaultBoringAutomationServerPlugin` marks a bus it constructs as composition-owned.

The full plugin/Host composition owns its internally created bus through one worker lifetime. Automation contributes this resource-owner worker even when `hostedSchedulerEnabled` is false; in that mode it waits for abort solely to close the composition-owned bus. The lifetime uses `try/finally` to stop Cron admission when enabled, join the active tick, and then close the bus exactly once. It never closes a caller-owned bus. In-memory close may remain a no-op.

Direct route mounting is route-only: it never starts hosted background work, and callers injecting an event bus own and close that bus. Direct mounting of the hosted default plugin without worker-aware Host composition is unsupported. This removes competing scheduler and event-bus owners.

### 10. Failure policy is bounded and observable

On startup:

- Worker declarations are boot-validated for array/object shape, safe local id, callable `run`, and duplicate final id. Lifetime behavior is contractual and tested; it cannot be proven by shape validation.
- `startWorkers()` invokes every declaration exactly once and immediately attaches settlement observers; one synchronous throw, rejection, non-Promise result, or early resolve never prevents later declarations from being invoked.
- Such failures are normalized, logged, and retained, but healthy peers continue until normal `beginDrain`; listening and explicit starts use the same rule.
- If app readiness fails, no worker has started because startup occurs at `onListen`.

On shutdown:

- Call every worker controller's `abort()` before joining; worker abort listeners must not throw.
- Await every worker even if one rejects.
- Preserve the first error for propagation and log later errors.
- Normalize synchronous throws/rejections into `AgentHostWorkerError` code `AGENT_HOST_WORKER_FAILED`. A non-Promise result or normal settlement before abort synthesizes `AGENT_HOST_WORKER_EXITED`. Both include only the final worker id; retained errors/logs omit raw cause, message, and stack.
- Continue AgentHost cleanup after worker failure.
- Do not add restart/backoff/readiness policy.

Core's existing process shutdown deadline remains the outer bound. The worker layer must not add a contradictory timeout. A stuck worker remains visible in shutdown diagnostics and is ultimately bounded by the process-level deadline.

### 11. Preserve scheduler product behavior

The refactor must preserve:

- immediate startup evaluation;
- one minute Croner wake-up;
- `unref: true`;
- no overlapping process-local ticks;
- authenticated external trigger endpoint;
- external scheduler opt-out;
- cross-process atomic dispatch claim;
- creator/workspace isolation;
- request-free internal dispatch;
- heartbeat, stale-run reconciliation, and CAS terminal fencing;
- actor-scoped invalidation publication;
- timer errors sanitized and contained.

## Lifecycle State Machine

Host worker manager states:

```text
created -> running -> aborting -> drained -> closed
    |                     ^
    +---------------------+
```

Rules:

- `startWorkers` is valid only from `created`; repeated calls are no-ops.
- `beginDrain` from `created` prevents later start and moves to `aborting` with no running workers.
- `beginDrain` from `running` aborts every worker once.
- `drain` implicitly calls `beginDrain`, joins all started workers, closes binding admission, and drains AgentHost. It reaches `drained` after all attempts even when returning an error.
- `close` implicitly drains, closes remaining resources, reaches `closed` after all attempts, and is idempotent.
- There is no direct `created -> closed` bypass.
- `startWorkers` in `aborting`, `drained`, or `closed` is an idempotent no-op; start never occurs after abort begins.
- A worker resolving before abort is recorded as an unexpected exit but remains joined.
- Worker rejection is observed immediately to prevent unhandled rejection and retained for lifecycle error aggregation.

## Files and Responsibilities

### Agent

- `packages/agent/src/server/agent-host/types.ts`
  - Add the worker intent/context/logger contracts.
  - Add `hostWorkers` to Host creation, never HTTP projection options.
  - Add `startWorkers`, `beginDrain`, `drain`, and `close` to the Host handle contract.
- `packages/agent/src/server/agent-host/createAgentHost.ts`
  - Implement once-per-Host validation, start, abort, join, error aggregation, and worker-before-runtime drain ordering.
- `packages/agent/src/server/agent-host/httpProjection.ts`
  - Use the common Host lifecycle phases.
- `packages/agent/src/server/createAgentApp.ts` and legacy projection/runtime files
  - Remove participant loops and call common Host methods only.
- Delete `packages/agent/src/server/shutdown.ts` and its exports after migration.

### Workspace/Core

- `packages/workspace/src/server/plugins/defineServerPlugin.ts`
  - Replace `shutdown` with trusted `hostWorkers` declarations.
- `packages/workspace/src/app/server/pluginEntryResolver.ts` and the Workspace/Core plugin resolution loops
  - Enforce trusted provenance before entry metadata is erased.
- `packages/workspace/src/server/plugins/bootstrapServer.ts`
  - Validate shape/local ids, namespace, and collect already-authorized Host worker intents.
- `packages/workspace/src/app/server/createWorkspaceAgentServer.ts`
- `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts`
  - Pass collected workers into Host construction.
  - Remove shutdown-participant forwarding and collection mocks.
- `packages/workspace/docs/PLUGIN_SYSTEM.md`
  - Document lifetime, trust, cardinality, cancellation, and direct-route semantics.
  - Tell worker authors to log sanitized diagnostic context before rejecting because Host normalization deliberately omits raw cause/message/stack.

### Automation

- `plugins/boring-automation/src/server/index.ts`
  - Add an explicit composition-vs-caller event-bus ownership marker.
  - Construct the scheduler worker at plugin-body scope, sharing the existing coordinator; it takes logging from worker context rather than `app.log`.
  - Contribute one Host worker.
  - Remove scheduler `onReady`, scheduler `onClose`, route event-bus close, and `shutdown` callbacks.
  - Keep HTTP routes/coordinator wiring independent of worker activation.
- `plugins/boring-automation/src/server/hostedScheduler.ts`
  - Adapt scheduler lifetime to AbortSignal without weakening no-overlap or active-tick drain.
  - Keep Croner as the wake-up implementation.

## Flag / Abstraction

- **Needed?** No feature flag. This replaces an unmerged internal lifecycle API on the same PR.
- **Path:** Expand AgentHost worker support, migrate Automation/Workspace/Core, then delete shutdown plumbing.
- **Rollback:** Revert the worker-refactor commits while PR #906 remains unmerged; durable store/schema behavior is unaffected.
- **Compatibility:** No adapter or deprecation layer. The old API exists only on this branch.

## Test Seams

### Highest public seam

Start and close a Fastify app composed with AgentHost plus a test Host worker. Assert lifecycle order using observable promises/events rather than private fields.

### AgentHost contract tests

Cover:

1. workers start once at `app.listen()`/`onListen`, while failed `app.ready()` starts none;
2. two agent specs still produce one process worker;
3. startup immediate resolve/reject is observed and never becomes unhandled rejection;
4. close-before-ready prevents startup;
5. abort occurs before AgentHost admission closes;
6. an admitted worker dispatch can finish during worker drain;
7. no new worker work begins after abort;
8. every worker is aborted/joined after one failure;
9. worker rejection does not skip AgentHost cleanup;
10. repeated begin/drain/close is idempotent;
11. one synchronous worker throw does not prevent later declarations from starting; all healthy workers continue until subsequently aborted/joined;
12. failed readiness starts no worker, and explicit close after failed construction remains idempotent;
13. legacy and addressed-only projections both execute `onListen:start`, `preClose:beginDrain`, `onClose:close` (implicit drain), with no full join in `preClose`;
14. binding admission remains open during worker join, then closes immediately before runtime drain;
15. worker rejection still closes bindings and Host resources;
16. early normal exit, throw/rejection, duplicate lifecycle registration, and repeated terminal calls expose stable codes/worker ids without raw causes.

### Plugin composition tests

Cover:

- app/prebuilt and `trust: "internal"` entries may contribute workers, while untrusted/generated entries cannot;
- hot-reload import mode never replaces an admitted worker;
- worker ids are namespaced and deterministic;
- duplicate final ids fail boot;
- invalid shape, unsafe id, non-callable `run`, and duplicate final ids fail validation;
- generated or untrusted directory plugins cannot contribute workers; `trust: "internal"` directory entries may contribute once at boot even with `hotReload: true`, and diagnostic re-import cannot replace them;
- collection retains plugin identity for diagnostics.

### Automation tests

Retain scheduler unit coverage and add:

- plugin declares one hosted worker and route mounting alone does not start it;
- worker start preserves immediate tick and minute scheduling;
- abort stops Cron admission and joins active tick;
- final tick may publish before event bus closes;
- event bus closes once after scheduler drain;
- scheduler-disabled mode preserves authenticated external triggering and closes resources;
- multi-agent Host starts one scheduler;
- readiness failure leaves no timer/listener;
- an open SSE stream terminates promptly during Fastify close and unsubscribes; final durable state is observable after reconnect/restart rather than promised on the closing stream;
- real PostgreSQL scheduled run still persists receipt/session/status and stale recovery remains fenced.

### Avoid testing

- Source-code string matching.
- Private worker-manager fields.
- Croner's implementation details.
- General malicious-plugin sandboxing.
- Hypothetical arbitrary agent-type selection.

## Acceptance

- No `WorkspaceServerPlugin.shutdown`, `WorkspaceShutdownContribution`, `AgentShutdownParticipant`, or `shutdownParticipants` remains in implementation source, current API documentation, or tests; retained issue-plan/review history under `docs/issues/896/**` is excluded.
- A trusted plugin declares background intent as a once-per-Host lifetime worker.
- Automation has one scheduler owner and one shutdown path.
- Worker cancellation/join happens before AgentHost admission drain.
- Worker-owned event publication/storage resources remain live through the final admitted tick.
- Host lifecycle is projection-independent and idempotent.
- Actor/workspace authorization and all durable scheduler guarantees remain unchanged.
- Direct route mounting does not start background workers.
- Relevant typechecks, unit tests, real-PostgreSQL lifecycle proof, and full-app playground proof pass.
- Independent adversarial architecture review and final Fable review report no blockers.

## Proof

### Exact commands

```bash
pnpm --filter @hachej/boring-agent test
pnpm --filter @hachej/boring-workspace test
pnpm --filter @hachej/boring-core test
pnpm --filter @hachej/boring-automation test
pnpm --filter @hachej/boring-agent typecheck
pnpm --filter @hachej/boring-workspace typecheck
pnpm --filter @hachej/boring-core typecheck
pnpm --filter @hachej/boring-automation typecheck
pnpm --filter full-app typecheck
if rg -n 'WorkspaceServerPluginShutdown|WorkspaceShutdownContribution|AgentShutdownParticipant|shutdownParticipants' \
  packages plugins apps docs --glob '!docs/issues/896/**'; then exit 1; fi
if rg -n "addHook\\(['\"]on(Ready|Close)['\"]" plugins/boring-automation/src/server/index.ts; then exit 1; fi
if rg -n 'hostWorkers' \
  packages/agent/src/server/agent-host/httpProjection.ts \
  packages/agent/src/server/agentHostLegacyRouteOptions.ts; then exit 1; fi
rg -n 'eventBus\.close' plugins/boring-automation/src/server/index.ts
# The final search must show only the composition-owned worker finalizer, never a route hook.
git diff --check
```

With PostgreSQL available and the test database created, run:

```bash
DATABASE_URL=postgres://ubuntu:test@localhost/boring_ui_test \
  pnpm --filter @hachej/boring-automation exec vitest run \
  src/server/__tests__/migrations.test.ts src/server/__tests__/postgresStore.test.ts
```

Record database preconditions and exact output in the PR proof comment.

### Manual playground proof

1. Start full-app using its normal migration/start command.
2. Confirm the Automation tab appears.
3. Trigger a manual run and verify immediate state plus eventual terminal state.
4. Enable a due automation and verify the hosted worker starts it without the external endpoint.
5. Begin app shutdown while a controlled tick is active.
6. Verify the open SSE stream terminates promptly, the admitted run reaches a durable terminal state, no later tick starts, reconnect/read-after-restart observes that state, and the process exits within Core's existing 30-second shutdown deadline.

## Slices

### Slice 1: Expand AgentHost with managed lifetime workers

**Delivers:** Worker contract, state machine, common lifecycle implementation, projection integration, and AgentHost contract tests while the old branch-only participant API still exists temporarily.

**Blocked by:** None.

**Proof:** Agent tests for readiness, once-per-Host cardinality, abort/join ordering, failure aggregation, idempotence, and both projections.

**Review budget:** Exceeds a tiny review but remains one cohesive Agent package change. Requires adversarial lifecycle review.

### Slice 2: Migrate plugin composition and Automation

**Delivers:** Trusted worker declaration/validation/collection, Automation lifetime worker, explicit event-bus resource ordering, and removal of route-owned scheduler startup/shutdown.

**Blocked by:** Slice 1.

**Proof:** Workspace/Core/Automation tests plus real PostgreSQL scheduled-run proof.

**Review budget:** Cohesive cross-package migration. Requires actor-isolation and resource-order review.

### Slice 3: Contract old lifecycle API and prove the app

**Delivers:** Delete shutdown types/plumbing/tests, update plugin documentation, run complete quality gates and playground shutdown proof.

**Blocked by:** Slice 2.

**Proof:** Repository search shows no old API; all commands and manual proof above pass.

**Review budget:** Mostly deletion and proof; review verifies no compatibility shim or duplicate lifecycle path remains.

## Out of Scope

- Generic scheduler framework, queue, leader election, restart policy, backoff, health dashboard, or readiness protocol.
- Per-agent/per-workspace worker instances.
- Public third-party plugin sandboxing or marketplace permission manifests.
- Raw AgentGateway/AgentHost exposure to plugins.
- Arbitrary agent type selection or fleet discovery.
- Refactoring all existing dispatcher consumers.
- Changing Automation database schema, lease duration, event transport, or scheduling semantics.
- Retaining a compatibility adapter for the unmerged shutdown API.

## Resolved Questions

1. **Naming:** Use `hostWorkers` / `AgentHostWorkerIntent`; cardinality is process-level.
2. **Unexpected worker exit:** Normalize and log with no restart; the app remains available. Restart supervision is out of scope.
3. **Direct mounting:** `plugin.routes` alone is route-only and never starts process workers. Supported hosted composition goes through Workspace/Core.
4. **Outer deadline:** Core's existing 30-second process shutdown deadline is the only hard timeout in full-app. The worker manager adds no independent timeout. Non-Core embeddings own and document their outer process deadline.

## Review Record

- Pre-plan adversarial review: direction accepted, but required a lifetime/join contract, once-per-Host cardinality, explicit resource order, bounded scope, and no raw agent capability. Integrated above.
- Adversarial round 1: required `onListen` rather than `onReady`, provenance checks before bootstrap, non-throwing abort-listener contract, explicit event-bus/SSE ownership, a fixed Host lifecycle API, and resolution of speculative/open design. Integrated.
- Adversarial round 2: required explicit composition-vs-caller event-bus ownership, identical Fastify hook-to-Host phase mapping, plugin-body worker construction, explicit test/embedder start semantics, and single legacy lifecycle registration. Integrated.
- Adversarial round 3: retained the converged architecture but required error-safe `onClose -> close` mapping, one uniform worker-start failure policy, stable normalized worker/lifecycle codes, and terminal error retention. Integrated.
- Adversarial round 4: found only marginal contradictions; aligned worker-resource ordering, trusted hot-reload wording, and executable fail-on-match proof guards. Integrated.
- Adversarial round 5: CLEAN convergence gate.
- Final Claude Code Fable review: CLEAN. Optional clarifications for logger shape, post-abort start behavior, sanitized worker diagnostics, and scheduler-disabled resource ownership were integrated.
