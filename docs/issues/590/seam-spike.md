# Issue 590 — Slice 0 seam-confirmation spike

## Outcome

State: `ready-for-agent` for the next **local execution seam** slice. Hosted persistence remains `ready-for-human` because migration ownership and scheduled-run billing identity are product/platform decisions.

This spike confirms that the automation domain can remain plugin-owned, but two generic host capabilities are missing for clean execution:

1. access to the host's existing workspace-scoped `Agent` dispatcher from a trusted integration; and
2. a verified scheduled actor/service-principal path for unattended hosted triggers.

Do not create a second agent runtime inside the plugin and do not call the app's own public HTTP routes internally.

## Evidence summary

| Question | Finding | Decision |
| --- | --- | --- |
| Headless session launch | Public `Agent.send()` already creates a session when `sessionId` is absent, accepts model/context, streams terminal events, and uses the normal session store. The workspace runtime's `Agent` is internal to `registerAgentRoutes` and not available to trusted plugins. | Add a minimal generic host dispatcher injection; automation executor calls the existing `Agent.send()`. |
| Trigger model | `WorkspaceServerPlugin` has boot-time routes/tools/resources but no start/dispose lifecycle. | Keep due evaluation as an idempotent callable operation. CLI uses explicit/manual or OS cron invocation; hosted uses a platform/host trigger. No hidden plugin timer. |
| Hosted topology | Full app is a persistent authenticated Fastify host. Production requires `vercel-sandbox` (or optional remote worker) for workspace operations. Agent/session coordination stays on the public host; transcripts use `BORING_AGENT_SESSION_ROOT`. | Scheduler/orchestration runs on the host, not inside the sandbox/worker. Work still executes through the existing agent runtime pair. |
| Hosted DB | Core creates and owns the Drizzle/Postgres connection and migration runner. Plugin resolve context currently contains workspace root + bridge, not DB/migrations. | Do not open a second plugin DB connection. Add/approve a generic host persistence/migration contribution before hosted automation tables. |
| Hosted identity | Core has authenticated membership resolution; raw workspace headers are only selectors and are not authorization. Plugin routes currently receive no verified actor helper. | Hosted composition injects a verified actor resolver. Scheduled runs use a stored owner plus verified service principal. |
| Token usage | `Agent.send()` streams `PiChatEvent`, including usage events. Metering also records session/run IDs, but its generated Pi run ID is not exposed by `Agent.send()`. | Aggregate token usage from the executor's live event stream for v1. Persist partial/unknown on interruption. Do not query billing tables from the plugin. |

## 1. Headless session launch

### Confirmed existing seam

`packages/agent/src/shared/events.ts` exposes:

```ts
interface Agent {
  start(input: AgentSendInput): Promise<AgentStartReceipt>
  send(input: AgentSendInput): AsyncIterable<AgentEvent>
  sessions: SessionStore
}
```

`AgentSendInput` already carries:

- optional `sessionId`;
- prompt content;
- `ctx: { workspaceId, userId }`;
- model `{ provider, id }`;
- thinking level and attachments.

`packages/agent/src/server/createAgent.ts` proves the behavior:

- `ensureSession()` calls the existing Pi chat service's `createSession()` when no session ID is supplied;
- `start()` submits through `runtime.service.prompt()`;
- `send()` streams until the turn reaches a terminal event;
- `toPromptPayload()` forwards `model` into the normal prompt payload.

`packages/agent/src/server/pi-chat/harnessPiChatService.ts` uses `payload.model` when the adapter does not already hold a current model. Therefore model override is supported by the canonical prompt path.

### Missing host seam

The workspace-scoped `Agent` exists inside `registerAgentRoutes`' private `RuntimeBinding`. Trusted plugin route factories receive a Fastify instance but not the existing runtime/agent. Constructing another `createAgent()` inside `boring-automation` would duplicate:

- runtime binding and readiness;
- session/runtime caches;
- metering coordination;
- workspace/sandbox pairing.

### Decision

Introduce a small **generic**, automation-agnostic host capability, conceptually:

```ts
interface WorkspaceAgentDispatcher {
  send(input: AgentSendInput): AsyncIterable<AgentEvent>
  interrupt(sessionId: string, ctx: SessionCtx): Promise<unknown>
  stop(sessionId: string, ctx: SessionCtx): Promise<unknown>
}
```

The host resolves the existing runtime binding and delegates to its existing `Agent`. This is a trusted in-process capability: it trusts caller-supplied context, while authorization remains the upstream verified-actor resolver's responsibility. The automation server plugin receives it by explicit trusted composition, not through generated-plugin APIs.

The next implementation slice should first land this generic seam with tests, then inject it into an executor owned by `boring-automation`.

### Rejected alternatives

- **Loopback HTTP to `/api/v1/agent/pi-chat/*`:** duplicates auth/context handling and couples server code to public transport.
- **Create a second `Agent` in the plugin:** breaks the canonical runtime/session/metering ownership.
- **Write Pi session JSONL directly:** bypasses the agent loop and violates session ownership.

## 2. Trigger model

### Evidence

`packages/workspace/src/server/plugins/defineServerPlugin.ts` exposes routes, tools, Pi resources, provisioning, assets, and bridge handlers. It has no background service lifecycle.

`packages/workspace/docs/PLUGIN_SYSTEM.md` describes trusted server contributions as boot-time composition; it does not define timer ownership or hot-wired server lifecycle.

### Decision

Automation scheduling is split into two layers:

1. plugin-owned pure `findDue(now)` / idempotent `runDue(now)` policy; and
2. host-owned cadence invocation.

For local CLI:

- `Run now` works through a normal authenticated/local route or CLI invocation;
- due evaluation is invoked explicitly or by user OS cron/systemd;
- no always-on timer is required for Slice 3B.

For hosted:

- a platform scheduler or host control-plane job invokes the due operation;
- duplicate protection lives in hosted persistence as a lease/unique scheduled occurrence;
- the trigger authenticates as an internal service principal, then executes as the automation's stored owner.

### Rejected alternatives

- `setInterval()` hidden in route registration;
- timer inside Vercel sandbox/remote worker;
- per-browser scheduling.

## 3. Hosted topology and sandbox boundary

### Confirmed

`apps/full-app/src/server/main.ts` and `dev.ts` compose a persistent core/workspace/agent Fastify host.

`apps/full-app/src/server/productionSafety.ts` requires `BORING_AGENT_MODE=vercel-sandbox` in production unless explicitly overridden. `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts` may also select a remote worker adapter when `BORING_WORKER_BASE_URL` is set.

The public host still owns:

- auth and workspace membership;
- workspace-scoped runtime binding selection;
- the Pi chat/session service;
- metering orchestration;
- plugin routes.

The sandbox/worker owns workspace filesystem and command execution. In remote-worker mode the core code explicitly avoids reading stale host-side workspace plugin state.

Session root resolution uses `options.sessionRoot`, `BORING_AGENT_SESSION_ROOT`, or the inferred durable host session root. Transcripts therefore remain host-side durable data, as required by `AGENTS.md`.

### Decision

- Run orchestration on the public host.
- Dispatch execution through the existing workspace-scoped agent runtime.
- Never put scheduler state in sandbox-local filesystem.
- Continue storing transcripts only in the existing session root.

## 4. Hosted persistence and migrations

### Confirmed

`createCoreWorkspaceAgentServer()` creates the core `Database`, Postgres user/workspace stores, and migration environment. Core's schema and migration runner own current application tables.

The trusted plugin resolution context currently provides `workspaceRoot` and an unavailable/static bridge placeholder in core composition, not `db`, migration registration, or a post-core-runtime service registry.

No first-party plugin currently establishes a separate Postgres connection/migration lifecycle.

### Decision

Hosted automation persistence is blocked on an owner-approved generic integration. Preferred direction:

- app/core owns the DB connection and migration transaction;
- trusted app composition injects a plugin-owned `AutomationStore` backed by that DB;
- plugin schema/migration files stay with the plugin, but the host migration runner explicitly registers/applies them;
- no plugin reads `DATABASE_URL` or opens a parallel connection by itself.

This requires a small platform design before implementation. Do not add automation tables to core merely to avoid defining plugin migration ownership.

### Human decision required

Choose one:

1. generic trusted-plugin migration contributions; or
2. app-owned explicit migration registration importing plugin migrations.

Option 2 is the smaller first implementation and does not expand the runtime plugin contract.

## 5. Verified hosted identity

### Confirmed

Core's `resolveAuthorizedWorkspaceId()` path validates the workspace selector against the authenticated user and membership store. `coreWorkspaceBridge` likewise authorizes workspace operations via membership.

Raw `x-boring-workspace-id` is only a selector. The Boring MCP full-app integration demonstrates the required shape: validate ID, load workspace, then check `getMemberRole(workspaceId, user.id)`.

Static plugin routes do not automatically receive a plugin-specific verified actor object.

### Decision

Hosted automation composition injects:

```ts
interface VerifiedWorkspaceActorResolver {
  resolve(request: FastifyRequest): Promise<{
    workspaceId: string
    userId: string
    role: "owner" | "editor" | "viewer"
  }>
}
```

- CRUD requires a verified member; destructive/admin policy is decided with hosted UX.
- Every hosted automation stores `ownerUserId`.
- Unattended trigger authentication is a service principal; execution/billing context uses the stored owner.
- A disabled/deleted/non-member owner causes the run to fail closed and require reassignment.

### Human decisions required

- Confirm whether scheduled usage is billed to the automation owner (recommended) or to a workspace billing account when such an account exists.
- Define which real workspace roles (`owner`, `editor`, `viewer`) may create, edit, disable, delete, or reassign automations.

## 6. Token attribution

### Confirmed

`Agent.send()` returns `AgentEvent`, whose `chunk` is `PiChatEvent`. Pi chat emits `usage` chunks containing the provider's input/output/cache usage.

`packages/agent/src/server/pi-chat/metering.ts` also correlates usage to an internal `runId` derived from session ID + generated client nonce. The public `AgentSendInput` does not accept that nonce, and the plugin should not depend on the internal run-ID string format or query core billing tables.

### Decision

The automation executor aggregates live `usage` chunks while consuming `Agent.send()`:

- `inputTokens = input + cacheRead + cacheWrite` only if product copy calls that "input"; otherwise store each category separately later;
- `outputTokens = output`;
- `totalTokens` is a presentation aggregate;
- missing/interrupted usage remains `null`, never fabricated as zero.

Persist totals when the event stream terminates. These plugin-displayed totals are operational UX metadata, not an authoritative billing statement; billing may apply pricing and fallback holds that intentionally differ. A later crash-recovery slice may add a generic session-usage query or transcript replay; it is not required for the first manual-run tracer bullet.

### Rejected alternative

Direct reads from `usage_ledger`: that table is billing-owned, may omit zero-priced usage, and is not the plugin's domain API.

## 7. Revised implementation slices

### Slice 2 — Front UI (already unblocked)

Build CRUD + read-only history UI against Slice 1 routes. This does not depend on execution.

### Slice 3A — Generic workspace agent dispatcher

**Delivers:** a tested trusted host capability that resolves the existing workspace runtime and exposes `Agent.send()`, `interrupt()`, and `stop()` to trusted app integrations; actor authorization remains upstream.

**Boundary:** generic agent/workspace package work; no automation types.

### Slice 3B — Plugin manual-run executor

**Delivers:** executor-owned run creation/transitions, prompt/model snapshots, normal session creation, live token aggregation, and `Run now` route.

**Blocked by:** Slice 3A.

### Slice 4 — Pure due policy + external trigger adapter

**Delivers:** cron/timezone validation, deterministic `findDue/runDue`, no-backfill/overlap/DST/stale-run policy, and a CLI/host invocation adapter. No hidden timer.

**Blocked by:** Slice 3B.

### Slice 5 — Hosted persistence and actor composition

**Status:** owner decisions recorded; implementation is split into hosted persistence infrastructure and actor composition.

**Owner decisions:** deployment-owned explicit migration registration; scheduled usage is attributed to the automation creator; hosted runs execute as and remain owned by the creator and fail closed if creator authorization is unavailable.

**Delivers:** plugin-backed Postgres store, migration registration, verified actor resolver, owner reassignment/fail-closed behavior, and scheduled-occurrence lease.

### Slice 6 — Hosted platform trigger

**Delivers:** authenticated service-principal invocation and duplicate-safe hosted due runs.

**Blocked by:** Slice 5 and billing-owner decision.

## Proof for Slice 0

```bash
rg -n "interface Agent|send\(input: AgentSendInput\)" packages/agent/src/shared/events.ts
rg -n "ensureSession|service\.prompt|toPromptPayload" packages/agent/src/server/createAgent.ts
rg -n "interface WorkspaceServerPlugin" packages/workspace/src/server/plugins/defineServerPlugin.ts
rg -n "BORING_AGENT_SESSION_ROOT|remoteWorkerModeAdapter|resolveAuthorizedWorkspaceId" packages/core/src/app/server/createCoreWorkspaceAgentServer.ts
rg -n "MeteringUsageInput|runId|recordUsage" packages/agent/src/server/pi-chat/metering.ts packages/core/src/server/db/stores/PostgresMeteringStore.ts
git diff --check
```

Manual validation for the next execution slice:

1. create an automation with a known model;
2. invoke `Run now` as an authenticated/local actor;
3. verify a normal session appears in the standard session list;
4. open it through existing chat UI;
5. verify run status, duration, snapshots, and usage totals;
6. restart the host and verify transcript persistence.

## Residual risks

- `Agent.send()` currently generates the Pi client nonce internally, so billing-ledger run correlation is not available to the plugin.
- Live usage aggregation can remain incomplete after host crash.
- Hosted migration registration has no current plugin precedent.
- Creator authorization must be re-checked at execution time; ownership changes must fail closed rather than silently impersonate a new user.
- External trigger authentication must be designed before public deployment.

## Loop exit

- `ready-for-agent`: Slice 2 UI, Slice 3A generic dispatcher, and then Slice 3B local manual executor.
- `ready-for-human`: hosted actor composition and authenticated platform trigger design.
- First remaining hosted blocker: compose the verified creator actor/store into full-app routes and executor, then design the service-principal trigger.
- Next recommended implementation: Slice 2 UI can proceed independently; for execution, start Slice 3A.
