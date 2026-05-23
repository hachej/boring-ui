# WorkspaceBridge RPC Plan

## Status

Plan refined through planning-workflow and multi-model review, then simplified for v1 scope. WorkspaceBridge beads have been rewritten from this version of the plan.

Authority ADR: [`docs/adr/workspace-bridge-v1-authority-model.md`](../../docs/adr/workspace-bridge-v1-authority-model.md).

Do not start implementation until Phase 0 closes and the authority model is accepted.

## Goal

Remove plugin-owned server routes where a plugin only needs protected communication with the workspace host.

This plan targets two concrete migrations and one cross-cutting route-removal goal:

- Bridge-capable plugin features should not require plugin-owned server routes. Macro data/domain access moves to WorkspaceBridge instead of requiring `/api/macro/*` routes.

Concrete migrations:

1. **`@hachej/boring-ask-user`**
   - Long-term package shape: `front` + `agent` + `shared` only.
   - No custom ask-user server plugin/routes required by normal setup.
   - Pending-question/runtime coordination becomes a small workspace-owned pending-question coordinator exposed through `human-input.v1.*` bridge ops.
2. **Plugin/runtime SDK calls such as boring-macro**
   - SDKs running inside direct/local/remote agent runtimes call host-owned operations through protected WorkspaceBridge RPC.
   - SDKs no longer need hardcoded app URLs, localhost assumptions, or ad-hoc auth headers.
   - Macro browser UI and runtime SDK calls should both use WorkspaceBridge for data/domain operations so the plugin no longer requires custom server routes.

## Non-goals

- Do not create a generic route proxy such as `bridge.call('/api/anything')`.
- Do not keep backward-compatible aliases for the UI side-effect rename. This plan intentionally replaces `postCommand` with `emitUiEffect`.
- Do not couple `@hachej/boring-agent` to workspace. Agent may expose generic runtime env/context seams; workspace/core inject workspace bridge specifics.

## Core idea

Replace the existing UI bridge concept with a broader `WorkspaceBridge` that has two lanes:

1. **UI effect lane** — `emitUiEffect` behavior.
  - Opens panes.
  - Focuses files.
  - Shows toasts/banners.
  - Publishes UI-only effects.
  - Remains the single dispatch source for UI side effects.
2. **RPC/request lane** — `call/registerHandler` behavior.
  - Bounded request/response calls.
  - Capability-scoped and schema-validated.
  - Used by agent tools, runtime SDKs, iframe/runtime plugins, and browser UI submissions.

UI side effects caused by RPC handlers must still flow through `emitUiEffect`; `call()` must not become a second UI effect dispatcher.

## Naming and invariant migration

The UI side-effect API is named `emitUiEffect`, not `postCommand`.

This is a deliberate hard rename:

- `emitUiEffect` means "tell the UI to do something".
- `call` means "invoke a host capability and receive a response".
- No deprecated `postCommand` alias should be kept in the final implementation.
- Migration work must update call sites and tests in the same focused phase that introduces `WorkspaceBridge.emitUiEffect`.

This plan intentionally changes a current architectural invariant. Current `AGENTS.md` still names `UiBridge.postCommand` as the single UI dispatch source. The implementation must update `AGENTS.md`, invariant-lint rules, docs, and tests in the same phase that introduces `WorkspaceBridge.emitUiEffect`.

Required end state:

- `WorkspaceBridge.emitUiEffect` is the single dispatch source for UI effects.
- `WorkspaceBridge.call` is never used as a UI-command transport.
- No deprecated `postCommand` alias remains in public APIs or invariant docs.
- Chat-stream `data-ui-command` parts remain display-only derivatives of emitted UI effects.
- Historical/archive docs may mention old names only if clearly archival.

## Transport versus abstraction

WorkspaceBridge is the abstraction. The backend route is only one transport.


| Caller                                 | Transport                                                     | Expected frontend involvement                          |
| -------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------ |
| Server/internal code                   | Direct in-process function call                               | None unless handler emits UI effect                    |
| Pi extension in host process           | Explicit bridge context seam; direct in-process bridge client | None unless handler emits UI effect                    |
| SDK/CLI in direct/local/remote runtime | Protected backend route                                       | None unless handler emits UI effect                    |
| Browser UI                             | Backend route with browser auth/CSRF                          | The browser is the caller                              |
| Iframe plugin                          | Future postMessage bridge to host, then bridge call           | Iframe only; shell UI effects still use `emitUiEffect` |


Most bridge calls should not route to the frontend. For example, `macro.v1.series.data` is SDK/runtime → host service → response. The frontend is not involved.

Some bridge calls intentionally create UI work. For example, `human-input.v1.request` is agent/runtime → workspace pending-question coordinator → `emitUiEffect` opens the Questions UI → browser answers via `human-input.v1.answer` → waiting tool resolves.

## Package boundary rules

These rules protect the existing package architecture.

- `packages/workspace/src/shared/**` remains platform-neutral: no `node:*`, no `Buffer`.
- Workspace and agent remain DB-free. Persistence uses injected stores; core/cloud can inject DB-backed stores.
- `@hachej/boring-agent` must not import workspace-specific bridge code. It may expose generic runtime env/context hooks.
- Workspace/core owns injection of `BORING_WORKSPACE_BRIDGE_*` env vars and bridge tokens.
- Workspace base front/shared code must not value-import `@hachej/boring-agent`.
- Routes/tools/bridge handlers that touch files operate through `Workspace` / runtime adapters, not raw root paths.
- Path validation remains adapter-owned.
- Workspace + Sandbox remain paired through `RuntimeModeAdapter`; bridge env injection must respect the active pair.
- Stable bridge errors must use the canonical error-code import site; no scattered raw string codes.

## Caller classes

### Browser workspace UI

- Uses existing app/session auth.
- Uses CSRF/origin checks for mutations.
- Does **not** receive runtime bridge bearer tokens.
- May call only ops explicitly allowlisted for `browser` callers.

### Agent/runtime/sandbox SDK

- Uses short-lived WorkspaceBridge bearer token injected through runtime execution context/env.
- Does not require cookies.
- Token is never written to workspace files or logs.
- Token is visible to code running in that same runtime, so it protects the host and other workspaces, not secrecy from the current agent.

### Server/internal code

- Uses direct in-process bridge calls with trusted server context.
- App/internal plugins may register trusted static handlers at boot.


## Actor attribution for observability

`callerClass` answers **how the call entered the bridge**. It is not enough for audit/observability because a browser call, runtime call, or server call may be caused by different actors.

Add a lightweight actor-attribution context to every bridge dispatch:

```ts
type BridgeActorKind = "human" | "agent" | "system" | "service"

interface BridgeActorAttribution {
  actorKind: BridgeActorKind
  performedBy?: {
    userId?: string
    agentSessionId?: string
    runtimeId?: string
    pluginId?: string
    serviceId?: string
    toolCallId?: string
    requestId?: string
  }
  onBehalfOf?: {
    userId?: string
    workspaceId?: string
    sessionId?: string
    tenantId?: string
  }
}
```

Examples:

| callerClass | actorKind | Example |
| --- | --- | --- |
| `browser` | `human` | user answers an ask-user form |
| `runtime` | `agent` | agent/Macro SDK reads series data |
| `server` | `system` | server startup abandons stale human-input request |
| `server` | `service` | trusted app background refresh |

Rules for v1:

- This is observability/audit context first, not a new authorization layer.
- Do not overcomplicate rate limiting in v1. Rate limiting remains keyed by the already planned workspace/session/principal/plugin/runtime/callerClass/op fields; actorKind may be logged for later analysis, but no new distributed limiter semantics are required.
- Auth still comes from runtime tokens, BridgeAuthPolicy, or trusted server context.
- Actor attribution must be derived by the trusted boundary:
  - browser auth policy resolves `actorKind: "human"` and `performedBy.userId` where available;
  - runtime token/bridge env resolves `actorKind: "agent"` with agent/runtime/session/tool ids where available;
  - trusted server calls explicitly choose `system` or `service`;
  - request body cannot spoof actor attribution.
- Audit/log events should include `callerClass`, `actorKind`, redacted `performedBy`, and redacted `onBehalfOf`.
- Ask-user logs should make clear: agent requested human input; human answered/cancelled it.
- Macro logs should make clear: agent/runtime called Macro on behalf of a workspace/user/session where known.
- Redaction rules still apply: no tokens, full answers, file contents, host paths, or full payloads.

## Trust and capability model

WorkspaceBridge authorization is based on caller class plus explicit capability grants.


| Caller class | Can call                                       | Cannot call                                                                 |
| ------------ | ---------------------------------------------- | --------------------------------------------------------------------------- |
| `browser`    | Browser-allowlisted ops using app/session auth | Runtime-only ops; bearer-token ops                                          |
| `runtime`    | Token-granted ops from sandbox/SDK/CLI         | Browser-only UI submission ops unless explicitly granted                    |
| `server`     | Trusted in-process ops                         | Runtime/plugin host-process handlers that are not trusted app/internal code |


Capability grants are always host-owned:

- trusted app/internal plugins are granted by app composition;
- host policy approves/denies requested capabilities;
- token minting reads current grant state, not only static declarations;
- plugins never self-grant capabilities.

Capability names should be stable and product-shaped:

```txt
human-input:request
human-input:answer
macro:series.read
macro:sql.query
macro:transform.persist
```

Capabilities may include resource constraints:

- `macro:series.read` with dataset/source restrictions where applicable;
- `macro:sql.query` with read-only SQL guard, timeout, max rows, and max output bytes;
- `macro:transform.persist` with workspace/project scope;
- `human-input:answer` scoped to active session/question.

Handlers must enforce both operation capability and resource constraints.

## Operation registry

All bridge operations are registered capabilities. Operation names are versioned from day one.

Examples:

```txt
human-input.v1.request
human-input.v1.answer
human-input.v1.cancel
human-input.v1.pending
human-input.v1.transcript
macro.v1.catalog.search
macro.v1.facets.list
macro.v1.series.metadata
macro.v1.series.data
macro.v1.series.lineage
macro.v1.sql.query
macro.v1.transform.persist
```

Every operation declares:

```ts
interface WorkspaceBridgeOperationDefinition {
  op: string
  version: number
  owner: string
  callerClassesAllowed: Array<'browser' | 'runtime' | 'server'>
  requiredCapabilities: string[]
  resourceScopeSchema?: unknown
  inputSchema: unknown
  outputSchema?: unknown
  timeoutMs: number
  maxInputBytes: number
  maxOutputBytes: number
  idempotencyPolicy: 'none' | 'required' | 'request-id' | 'tool-call-id'
  auditCategory: string
}
```

Rules:

- Unknown ops return `BRIDGE_OP_NOT_FOUND`.
- Duplicate op registration is rejected unless explicitly replacing the same owner in a controlled test/dev path.
- Browser callers cannot call runtime-only ops even if authenticated.
- Runtime tokens derive workspace/session/plugin identity from token claims, not request body.
- If body-provided workspace/session conflicts with auth/token context, reject.

## Stable bridge error codes

Add canonical stable error codes, for example:

```txt
BRIDGE_OP_NOT_FOUND
BRIDGE_CAPABILITY_DENIED
BRIDGE_CALLER_NOT_ALLOWED
BRIDGE_SCHEMA_INVALID
BRIDGE_WORKSPACE_MISMATCH
BRIDGE_SESSION_MISMATCH
BRIDGE_PLUGIN_MISMATCH
BRIDGE_REPLAY_REJECTED
BRIDGE_IDEMPOTENCY_REQUIRED
BRIDGE_TIMEOUT
BRIDGE_OUTPUT_TOO_LARGE
BRIDGE_INPUT_TOO_LARGE
BRIDGE_TOKEN_INVALID
BRIDGE_TOKEN_EXPIRED
BRIDGE_HANDLER_FAILED
BRIDGE_RATE_LIMITED
BRIDGE_UNREACHABLE
```

All errors returned to browser/agent/runtime must omit secrets, bearer tokens, stack traces, host filesystem paths, file contents, full user answers, and full request payloads by default.

## Security invariants

1. Runtime bridge tokens are assumed compromised for their TTL.
2. Capabilities are default-deny and resource-scoped.
3. Browser callers never receive or use runtime bearer tokens.
4. Only trusted app/internal code registers in-process bridge handlers.
5. All mutation ops are idempotent/replay-protected.
6. Large bridge outputs use the unified file-asset/upload/raw-file mechanism and remain path-validated; no generic workspace-files bridge API is added in v1.
7. UI side effects only happen through `emitUiEffect`.
8. Bridge route is not an arbitrary API proxy.
9. Logs/audit/errors never include bearer tokens, file contents, user answers, or full payloads by default.
10. Path validation remains adapter-owned.

## Authority and token model

Runtime bridge tokens are scoped, short-lived grants.

### Runtime token threat model

Runtime bridge tokens are bearer tokens intentionally exposed to code running in the agent runtime/sandbox. Treat them as compromised for the duration of their TTL.

Therefore:

- tokens must be least-privilege and default-deny;
- token TTL must be short, preferably per tool/run execution;
- token must be scoped to workspaceId, sessionId, runtimeId, pluginId where known;
- token must not grant more authority than the active agent/tool invocation needs;
- token exfiltration can only be mitigated by short TTL, narrow capabilities, audit, rate limits, and optionally one-shot/non-refreshable tokens;
- never inject a long-lived refresh token into the workspace/sandbox.

### Runtime token minting policy

- Preferred: mint per command/tool execution with only the capabilities required by that execution.
- Acceptable fallback: short-lived per-session runtime token only for trusted app/internal SDKs.
- Token grants are versioned and revocable; changing grants affects future tokens and may invalidate active runtime tokens if revocation support exists.
- Tokens should be bound to the configured bridge origin/deployment where possible so leaked tokens cannot be replayed against another environment sharing configuration.

Token claims:

```txt
workspaceId
sessionId?
pluginId?
runtimeId?
agentSessionId?
toolCallId?
actorKind = "agent" for runtime tokens where applicable
capabilities[]
bridgeOrigin? / deploymentId?
iat
exp
jti
aud = "workspace-bridge"
```

Validation checks:

- signature valid;
- not expired;
- audience matches;
- optional bridgeOrigin/deploymentId matches configured host origin;
- workspace/session/plugin match the resolved request context;
- operation capability is present;
- caller class is allowed;
- input schema is valid;
- output schema and size are valid;
- audit log redacts token.

### BridgeAuthPolicy

Workspace package must not grow a core-auth dependency. Browser auth is injected.

Define a `BridgeAuthPolicy` / auth adapter seam that can resolve:

- caller class;
- principal/user id;
- workspace id;
- session id, when relevant;
- membership/role authorization;
- CSRF/origin validation for browser mutations;
- local CLI no-auth policy for local trusted development;
- core/full-app auth wrapper for production apps;
- effectiveCapabilities for browser/server callers;
- resourceGrants/resourceScopes for path-, dataset-, operation-, or question-scoped authorization;
- actor attribution for observability: actorKind, performedBy, and onBehalfOf.

Browser caller class is never inferred merely from absence of a bearer token. It must come from the host auth adapter. If `BridgeAuthPolicy` cannot resolve workspace/principal/session or effective capabilities for a browser call, the route fails closed. Anonymous fallback is allowed only for an explicitly configured local CLI policy.

Local CLI/no-auth mode is intentionally lightweight and trusted-local/dev oriented. It does not require a separate local dev auth token in v1. Browser bridge mutations in local mode should still use same-origin/origin checks where applicable, but if the user binds the CLI server to `0.0.0.0`, network exposure is the user's responsibility. Full-app/core deployments must use real auth through `BridgeAuthPolicy`.

## Idempotency and replay policy

Replay/idempotency protection is required in MVP for mutation ops.

Token `jti` prevents blind token replay but is not enough for semantic retries. Every mutating op that can be retried by browser, agent, SDK, or sandbox code must declare an operation-level idempotency policy.

Required policies:


| Operation                    | Policy                                                |
| ---------------------------- | ----------------------------------------------------- |
| `human-input.v1.request`     | idempotent by `requestId` / `toolCallId`              |
| `human-input.v1.answer`      | one-shot idempotency key; conflicting replay rejected |
| `human-input.v1.cancel`      | one-shot idempotency key; conflicting replay rejected |
| `macro.v1.transform.persist` | required idempotency key                              |


Replay/idempotency storage must support atomic check-and-set.

For mutation ops, key scope must include:

- workspaceId;
- sessionId if present;
- pluginId/runtimeId if present;
- op;
- idempotencyKey/requestId/toolCallId;
- normalized input hash.

Behavior:

- same key + same hash returns prior pending/final result when safe;
- same key + different hash rejects with `BRIDGE_REPLAY_REJECTED`;
- missing required key returns `BRIDGE_IDEMPOTENCY_REQUIRED`;
- answer/cancel state transitions must be atomic so double-submit cannot resolve the same waiter twice;
- idempotency records must never store bearer tokens;
- workspace package may provide bounded file/in-memory storage; core/cloud may inject persistent storage later;
- file-backed defaults must use lock/transaction semantics, not naive read/modify/write;
- multi-worker/serverless/core deployments must inject DB/Redis-style atomic storage;
- if no atomic store is available for required mutation ops, those ops must be disabled with a stable diagnostic;
- records have TTL/garbage collection so workspace-local state cannot grow forever.

## Transport shape

A protected backend transport is required for callers outside the host process, especially SDKs/CLIs running in the workspace sandbox and browser plugin UIs that should not require custom plugin server routes. For bridge-capable plugin features, this transport replaces plugin-owned API routes rather than preserving them as the canonical path.

Important distinction: this transport is **not** required for in-process bridge callers such as the ask-user Pi extension when it has an explicit bridge context. In-process callers can use `bridge.call(...)` directly. The HTTP route exists for out-of-process callers unless a different transport is introduced.

### HTTP endpoint

```http
POST /api/v1/workspace-bridge/call
Content-Type: application/json
Authorization: Bearer <bridge-token>   # runtime mode only
```

Request:

```json
{
  "op": "macro.v1.series.data",
  "input": { "seriesId": "GDPC1" },
  "idempotencyKey": "optional-for-mutations"
}
```

Response:

```json
{
  "ok": true,
  "output": {}
}
```

Error response:

```json
{
  "ok": false,
  "error": {
    "code": "BRIDGE_CAPABILITY_DENIED",
    "message": "capability denied",
    "details": {}
  }
}
```

Transport hardening:

- Accept `POST` only.
- Require `Content-Type: application/json`.
- Reject simple form-compatible content types for mutations.
- Enforce `maxInputBytes` before parsing large bodies where possible.
- Set `Cache-Control: no-store`.
- Runtime bearer calls do not use cookies.
- Browser calls do not use runtime bearer tokens.
- Browser mutation calls require normal app/session auth plus CSRF/origin checks.
- CORS is same-origin/default-deny unless an embedding mode explicitly opens it.
- Do not set permissive `Access-Control-Allow-Origin: *`.
- Do not allow browser credentials cross-origin.
- Rate limit by workspace, principal/session, plugin/runtime id, caller class, and op.
- Error responses include stable codes but never raw tokens, secrets, stack traces, full payloads, or host filesystem paths.

### Browser bridge mode requirements

- Accept only authenticated same-origin browser requests unless local CLI no-auth policy explicitly says otherwise.
- Require `Content-Type: application/json`.
- Validate `Origin` and/or `Sec-Fetch-Site`.
- Require CSRF token for mutation ops if the app uses cookie auth.
- Enforce workspace membership/role before dispatch.
- Browser callers can only invoke ops whose metadata includes `browser`.
- Browser caller cannot spoof `callerClass`, workspaceId, or sessionId in body.

### Bridge URL derivation

Runtime bridge URL must be environment-aware:

- CLI/local direct mode may use the externally reachable CLI server URL.
- Local/bwrap mode must use a URL reachable from inside the sandbox namespace.
- Vercel sandbox mode must use a public/tunnel/proxy URL, never host-local `localhost`.
- Full-app/core deployments derive the URL from trusted server config, not from untrusted request headers unless explicitly allowlisted.
- Remote runtime bridge URLs must be HTTPS unless explicitly in local/dev mode.
- Runtime tokens must not be sent to plain HTTP endpoints outside localhost/dev.
- If no safe reachable bridge URL is available, runtime SDK bridge capability must be disabled with a stable diagnostic rather than injecting a broken URL.

### Runtime env for subprocess SDKs/CLIs

Inject at execution time:

```bash
BORING_WORKSPACE_BRIDGE_URL="https://host/api/v1/workspace-bridge/call"
BORING_WORKSPACE_BRIDGE_TOKEN="..."
BORING_WORKSPACE_ID="..."
BORING_AGENT_SESSION_ID="..."
```

Rules:

- Inject per command/tool/runtime execution.
- Prefer not to inject bridge env for commands that do not need bridge capabilities.
- Do not persist into `.boring-agent/`, generated plugin files, workspace templates, logs, or diagnostics.
- Direct/local/vercel modes must all use the paired workspace+sandbox runtime mapping.
- Remote sandbox gets an externally reachable HTTPS bridge URL, not server-local `localhost`.
- Env-injected tokens are inherited by child processes unless scrubbed. SDKs/tools should avoid passing bridge env to child processes unless needed.

### Pi extension context seam

Ask-user's Pi extension needs a clean bridge path without hidden globals.

V1 decision:

- Ask-user's `human-input.v1.request` blocking wait is supported through an explicit in-process Pi extension bridge context seam.
- If the Pi extension is loaded in a mode where that context is unavailable, the `ask_user` tool must be disabled or return a stable diagnostic rather than falling back to an unbounded blocking HTTP request.
- Env/HTTP bridge client is for subprocess SDKs/CLIs and bounded runtime calls, not for long-running ask-user waits in v1.
- External subprocess blocking human input can be added later via explicit `operationId` + poll/long-poll protocol.

Provide a helper such as:

```ts
createWorkspaceBridgeClient(ctx)
```

It must be explicit, typed, testable, and compatible with hot reload. It must not rely on hidden module globals.

## Workspace pending-question coordinator

Move only the generic ask-user coordination backend into workspace-owned infrastructure. Do not turn this into a broad human-input platform in v1. Workspace owns pending question state, waiting, answer/cancel/timeout/abandon transitions, nonce authority, bridge handlers, and UI-effect emission. The ask-user plugin still owns the `ask_user` tool, form-specific shared payload/schema details, Questions UI, labels, docs, and rendering.

Suggested files:

```txt
packages/workspace/src/server/humanInput/pendingQuestionRuntime.ts
packages/workspace/src/server/humanInput/pendingQuestionStore.ts
packages/workspace/src/server/humanInput/humanInputBridgeHandlers.ts
```

Workspace-owned shared schemas should cover only the generic bridge envelope/state needed by `human-input.v1.*`. Ask-user-specific form payload/schema details remain owned by `plugins/ask-user/src/shared`. `packages/workspace` must not import `plugins/ask-user`; it treats plugin payloads as validated envelopes/opaque payload where possible.

Existing implementation note: earlier ask-user work may already have server-side store/runtime pieces under `plugins/ask-user/src/server/` (for example `askUserStore.ts`, `askUserRuntime.ts`, `questionsBridge.ts`, or `askUserStatePublisher.ts`). Phase 8A should extract/adapt that proven logic into the workspace pending-question coordinator instead of duplicating behavior from scratch. The end state still removes the plugin-owned server surface.

### Store model

Add a `HumanInputStore` injection seam:

- workspace package provides file-backed default;
- core/cloud can inject DB-backed store later;
- no DB dependency in workspace package.

### Pending cardinality

MVP should preserve current ask-user semantics unless explicitly changed:

- one pending human-input question per session;
- question IDs still identify exact waiter;
- duplicate request IDs are idempotent.

If multiple concurrent questions are desired later, make that a separate design change.

### Human-input state machine

Human-input requests have explicit states:

```txt
created -> pending -> answered
                  -> cancelled
                  -> timed_out
                  -> abandoned
```

Rules:

- `human-input.v1.request` creates or resumes a request by `requestId`.
- One pending request per chat/session is preserved for MVP.
- `answer` and `cancel` are valid only from `pending`.
- Duplicate answer/cancel with the same idempotency key returns the prior result where safe.
- Conflicting answer/cancel replay is rejected.
- Tool abort moves pending request to `abandoned` or `cancelled` with reason `tool_aborted`.
- At server boot, pending records owned by a no-longer-live runtime/process transition to `abandoned` with reason `server_restart` so a restart cannot deadlock on stale pending state.
- UI opening is an effect emitted through `emitUiEffect`; pending state is stored in the workspace pending-question coordinator, not in frontend-only state.

### Operations

#### `human-input.v1.request`

Runtime/server caller. Blocking operation for tools.

Input includes:

```txt
requestId/toolCallId
kind = "ask-user.form"
sessionId?          # must match context if present
title
context
schema
timeoutMs
```

Behavior:

1. Validate caller capability.
2. Validate schema.
3. If duplicate request ID exists, return existing pending/final result.
4. Create pending question.
5. Emit UI effect via `emitUiEffect`.
6. Wait for answer/cancel/timeout.
7. Return final result.

Blocking strategy:

- For in-process Pi extension tools, direct in-process wait is acceptable.
- For external subprocess SDKs, do not allow unbounded HTTP waits in v1.
- If SDK/blocking human input is needed outside the host process, add an explicit `operationId` + poll/long-poll protocol as a separate phase.
- Abort propagation from tool cancellation must cancel or abandon the waiter.

#### `human-input.v1.answer`

Browser/server caller. Mutation.

Authorization must prove:

- authenticated principal can access this workspace and this specific chat/session/question;
- sessionId matches the question session;
- question is pending;
- answer token/nonce minted for that question and delivered only through pending-question UI state;
- nonce is unguessable, short-lived, scoped to workspace/session/question/action, and never returned by transcript endpoint;
- nonce is one-shot and consumed atomically with answer/cancel;
- answer nonce cannot be reused for cancel, another question, another session, or after timeout.

Browser cannot answer by `questionId` alone.

#### `human-input.v1.cancel`

Same authorization rules as answer. Cancel nonce is one-shot and consumed atomically.

#### `human-input.v1.pending`

Browser/server caller. Returns current pending question for session and includes the answer/cancel nonce only when the authenticated principal is authorized for this workspace and this specific chat/session/question.

#### `human-input.v1.transcript`

Admin/debug caller only in v1. Transcript reads are useful for debugging stuck ask-user flows, but may contain sensitive user answers. Access is allowed only through host/core auth policy for super-admin/debug users, or explicit local owner/debug mode in CLI. Runtime tokens, normal workspace members, and SDK callers do not receive transcript read by default.

Transcript events must be excluded from broad debug logs by default and redacted unless explicit debug access is authorized.

## Ask-user migration

### UI effect targeting and rehydration

Every UI effect must include or derive the target workspace id and session/user scope where relevant.

Rules:

- human-input UI effects are ephemeral hints to open/focus UI;
- human-input store is the source of truth;
- reconnect/page refresh rehydrates through `human-input.v1.pending`, not replayed frontend-only effects;
- effects must not open ask-user UI in the wrong workspace/session/browser context.

### Target package shape

```txt
plugins/ask-user/
  src/front/
  src/agent/
  src/shared/
```

Long-term no required `src/server/` surface.

### New flow

1. Pi extension registers `ask_user`.
2. Tool calls `human-input.v1.request` through explicit in-process bridge context.
3. Workspace pending-question coordinator creates pending question and emits a UI effect.
4. Ask-user front plugin renders the pending form.
5. Browser submits `human-input.v1.answer` through bridge using browser auth and one-shot nonce.
6. Waiting tool resolves with typed result.

### Ask-user migration safety and hard cutover

No compatibility window is required for v1. The refactor should hard-cut ask-user to the new bridge path instead of preserving two server coordination paths.

Do not allow:

- old `createAskUserServerPlugin()` store and new pending-question coordinator running independently in the same workspace;
- duplicate `ask_user` tool registration from both `agentTools` and Pi extension;
- browser UI submitting to old routes while agent waits on new bridge runtime.

Required cutover shape:

1. Add workspace-owned pending-question bridge path.
2. Migrate playground/full-app to ask-user front + Pi extension + workspace pending-question coordinator.
3. Stop requiring `WorkspaceServerPlugin.agentTools` for ask-user.
4. Remove the old ask-user server route/export surface in the same refactor, or replace it with a clear fail-fast diagnostic if physical file removal is deferred.
5. Tests assert old ask-user answer/cancel routes and old agentTools path are not active in the new setup.
6. Docs show only the new setup; any mention of old server setup is historical/migration warning, not a supported compatibility path.

## No plugin-owned server routes for v1 bridge-capable features

The v1 direction is stronger than "keep product routes": plugin features that can be represented as WorkspaceBridge operations should not require plugin-owned Fastify routes. Browser UI can call browser-allowed bridge ops; runtime SDKs call runtime-allowed bridge ops; server/internal code calls in-process bridge ops.

Rules for v1:

- Do not require `/api/macro/*` routes for Macro catalog/facets/series/sql/transform/refresh data operations.
- Macro frontend data adapters should prefer browser WorkspaceBridge calls for bridge-allowed Macro ops.
- Macro Python/agent runtime SDK calls use the bridge client/env.
- Existing `/api/macro/*` routes may be removed, or if temporarily present during migration, must be thin wrappers over bridge handlers and not the canonical path.
- Deck/file behavior is not bridged as Macro data RPC. Deck editing/preview should use existing workspace file/upload/raw-file mechanisms or a separate future deck plan, not Macro plugin server routes and not generic `workspace-files.v1.*` bridge ops.
- Do not add `workspace-files.v1.*` bridge operations in v1. Existing workspace file/upload/raw-file endpoints cover current file needs.
- Do not add bridge ops for raw ClickHouse proxy (`/api/macro/ch-query`).
- Large Macro outputs that need fallback storage should use the unified upload/file-asset/raw-file mechanism, not a new generic bridge file API.
- Path validation remains adapter-owned in existing file/upload/raw endpoints.

## Future work: generated/runtime plugin RPC

Generated/runtime plugin RPC is intentionally deferred from this v1 plan. The immediate goals are ask-user server-surface removal and Macro/runtime SDK bridge transport.

Keep the guardrail: generated/runtime plugins should not add custom Fastify routes or register host-process handlers. A future focused plan can define manifest-declared generated-plugin RPC, verifier rules, and sandbox execution once the WorkspaceBridge foundation is proven by ask-user and Macro SDK use cases.

## Macro/plugin SDK migration

Macro is a trusted app/internal domain feature, but the plugin should not require custom server routes. Correct v1 boundary: Macro data/domain operations are registered as WorkspaceBridge handlers by trusted app/host composition. Browser UI and runtime SDKs both call bridge; `/api/macro/*` routes are not canonical and should be removed or temporary wrappers only.

### Macro preflight/audit — current route classification

Current downstream source inspected: `/home/ubuntu/projects/boring-macro/src/plugins/macro/server/routes/macro.ts` and SDK source `/home/ubuntu/projects/boring-macro/src/plugins/macro/server/sdk/boring_macro/__init__.py`.

The important v1 conclusion: Macro data/domain APIs should move to WorkspaceBridge so the plugin no longer needs `/api/macro/*` server routes. Do **not** migrate deck/file-like endpoints to a generic `workspace-files.v1.*` bridge API; deck/file behavior should use existing workspace file/upload/raw-file mechanisms or a separate deck plan.

| Current route / SDK path | Current caller | Classification | V1 bridge decision |
| --- | --- | --- | --- |
| `GET /api/macro/catalog` | Macro front catalog adapter | Browser/product API to keep | Move browser/product data access to `macro.v1.catalog.search`; remove route or make it a temporary thin wrapper over bridge. |
| `GET /api/macro/facets` | Macro front filter UI | Browser/product API to keep | Move browser/product data access to `macro.v1.facets.list`; remove route or make it a temporary thin wrapper over bridge. |
| `GET /api/macro/catalog/search` | Agent/tools/SDK-style search and possible product search | SDK-runtime transport + product helper | Map to `macro.v1.catalog.search`; browser and runtime callers both use bridge. |
| `GET /api/macro/series/:seriesId` | Macro chart UI combined metadata+downsampled observations | Browser/product API to keep | Replace with bridge-backed browser data flow using `macro.v1.series.metadata` + `macro.v1.series.data`; remove route or temporary wrapper only. |
| `GET /api/macro/series/:seriesId/data` | Python SDK `get_series_data_json`, `bm run`, agent transform runtime | SDK-runtime transport | Map to `macro.v1.series.data`; browser/runtime callers both use bridge where they need raw observations. |
| `GET /api/macro/series/:seriesId/lineage` | Macro UI/debug lineage, possible runtime analysis | Product API + optional SDK runtime | Move to `macro.v1.series.lineage`; browser/runtime callers both use bridge if lineage UI remains. |
| `GET /api/macro/refresh/status` | Product/admin UI | Browser/product/admin API to keep | Move to `macro.v1.refresh.status` or include status in `macro.v1.refresh` response if UI still needs it; no plugin route required. |
| `POST /api/macro/refresh/:seriesId` | Product/admin/manual refresh | Admin/internal action | Map to `macro.v1.refresh` with explicit `macro:refresh` capability, or defer/remove if not needed. |
| `POST /api/macro/sql` | Agent/tool SQL inspection route | SDK-runtime transport with high-signal guardrails | Map to `macro.v1.sql.query` in v1. Browser/runtime callers use bridge. Must share read-only SQL guard (`SELECT`, `WITH`, `EXPLAIN`, `DESCRIBE`, `SHOW`, `DESC` only), reject multi-statement SQL, enforce timeout/max rows/max bytes, and require `macro:sql.query`. |
| `POST /api/macro/ch-query` | ClickHouse raw proxy | Admin/internal/high-risk | Do not map to bridge v1; remove/defer route if possible. |
| `POST /api/macro/transform/persist` | Python SDK `persist_series`, `bm run` | SDK-runtime mutation | Map to `macro.v1.transform.persist`; requires idempotency key and `macro:transform.persist`. Runtime SDK uses bridge env/client. |
| `GET /api/macro/deck` | Macro deck UI | File-like/deck product API | Do not keep as required Macro server route in v1 bridge architecture. Deck should use existing workspace file/upload/raw-file mechanisms or separate deck plan; do not map to `workspace-files.v1.*`. |
| `PUT /api/macro/deck` | Macro deck editor/agent-created deck files | File-like/deck product API | Do not keep as required Macro server route in v1 bridge architecture. Deck writing should use existing workspace file APIs or separate deck plan; do not map to `workspace-files.v1.*`. |
| `GET /api/macro/deck/list` | Macro deck UI | File-like/deck product API | Do not keep as required Macro server route in v1 bridge architecture; use existing workspace file listing or separate deck plan. |

Shared service extraction points:

- `DataService.search/catalog/catalogFacets` backs `macro.v1.catalog.search` and `macro.v1.facets.list`; Macro front adapters should call these bridge ops.
- `DataService.seriesData`, `seriesMetadata`, and `seriesLineage` back bridge series ops; Macro chart UI should call bridge instead of `/api/macro/series*`.
- `DataService.executeSql` plus the existing `execute_sql` tool read-only guard can back `macro.v1.sql.query`.
- `DataService.persistTransform` backs `macro.v1.transform.persist`; Python SDK/runtime uses bridge env/client.
- Deck route filesystem/path logic should not be required in Macro plugin server; use existing workspace file/upload/raw-file mechanisms or separate deck plan.
- Raw ClickHouse proxy (`/api/macro/ch-query`) stays out of v1 bridge.

V1 required Macro bridge target set:

```txt
macro.v1.catalog.search      # browser catalog + runtime search
macro.v1.facets.list         # browser filter UI
macro.v1.series.metadata     # browser chart metadata
macro.v1.series.data         # browser chart data + Python SDK / bm run
macro.v1.series.lineage      # browser/debug lineage if UI keeps lineage
macro.v1.sql.query           # agent/runtime SQL inspection; read-only guard
macro.v1.transform.persist   # Python SDK / bm run; idempotent mutation
```

Optional only if product still needs manual refresh:

```txt
macro.v1.refresh
macro.v1.refresh.status
```

### Bridge client SDKs

Add a small TypeScript client usable by runtime SDKs and browser/front adapters:

```txt
@hachej/boring-workspace/bridge-client
```

Provide or vendor a tiny Python client for Macro SDK:

```py
client = WorkspaceBridgeClient.from_env()
data = client.call("macro.v1.series.data", {"seriesId": "GDPC1"})
```

Client responsibilities:

- read env vars;
- send bridge call;
- include bearer token;
- pass idempotency keys for mutations;
- normalize stable bridge errors;
- avoid Macro-specific logic.

### Macro handlers

Macro host code registers app-owned bridge handlers instead of requiring plugin-owned Fastify routes. If any `/api/macro/*` route temporarily remains during migration, it must be a thin wrapper over bridge handlers and not canonical.

V1 required handlers:

```txt
macro.v1.catalog.search
macro.v1.facets.list
macro.v1.series.metadata
macro.v1.series.data
macro.v1.series.lineage
macro.v1.sql.query
macro.v1.transform.persist
```

Optional only if product still needs manual refresh:

```txt
macro.v1.refresh
macro.v1.refresh.status
```

Do **not** add bridge ops for deck routes, raw ClickHouse proxy (`/api/macro/ch-query`), or generic file operations in v1.

Capabilities:

```txt
macro:catalog.search
macro:series.read
macro:series.lineage
macro:sql.query
macro:transform.persist
macro:refresh
```

## Unified file-asset output policy for large bridge results

WorkspaceBridge RPC is for bounded JSON responses. Large bridge results must reuse the existing workspace file/upload/raw-file mechanism used by chat/UI image uploads and file previews. Do not create a separate artifact service, separate cache protocol, or generic `workspace-files.v1.*` bridge API in v1.

Existing primitives to unify with:

- browser/UI upload route: `POST /api/v1/files/upload`;
- raw file serving route: `GET /api/v1/files/raw?path=...`;
- workspace adapter binary write/read methods such as `writeBinaryFileWithStat`, `writeBinaryFile`, and `readBinaryFile`;
- frontend upload helper/result shape: uploaded files return a workspace-relative `path` plus a user-facing URL/markdown URL where relevant.

For Macro data and runtime SDK data paths:

- prefer pagination/windowing params;
- enforce max rows/max bytes;
- if still too large, write the output as a generated workspace file through the same workspace adapter/file-asset pipeline used by uploads;
- return a small JSON pointer with workspace-relative path and content type;
- callers fetch/display through existing raw-file/file mechanisms;
- normal file tree/search should hide or de-emphasize runtime/generated output directories where appropriate.

Example large-output response:

```json
{
  "type": "file-asset",
  "path": ".boring-agent/cache/macro/series-GDPC1.json",
  "contentType": "application/json",
  "rawUrl": "/api/v1/files/raw?path=.boring-agent%2Fcache%2Fmacro%2Fseries-GDPC1.json"
}
```

Rules:

- paths are workspace-relative, never host absolute paths;
- writes go through the Workspace adapter or the same server-side file-asset helper used by upload/file routes;
- reads go through existing raw-file/file mechanisms and path validation;
- no `artifact.v1.get`, `/workspace-bridge/artifacts/*`, object-store handle system, or bearer-like artifact ids in v1;
- cleanup can be simple best-effort cleanup of generated file-asset directories in v1;
- existing image/file upload tests should be extended so generated bridge outputs and UI uploads share the same path validation, raw URL generation, MIME/content-type handling, size caps, and redaction behavior.

## Audit logging and data exfiltration controls

Audit log minimum fields:

- timestamp;
- op;
- workspaceId;
- sessionId hash or redacted id where appropriate;
- pluginId/runtimeId;
- callerClass;
- actorKind;
- performedBy redacted id fields;
- onBehalfOf redacted id fields;
- principalId if browser/server;
- capability decision: allowed/denied;
- stable error code if denied/failed;
- durationMs;
- input/output byte counts.

Audit logs must not include:

- bearer token;
- full generated file-asset paths if treated as sensitive;
- full request payload by default;
- user answers unless explicit debug mode with redaction;
- file contents.

Data exfiltration controls:

- every op has maxOutputBytes and maxInputBytes;
- high-volume read ops require pagination/windowing;
- file reads require path scopes and size caps;
- file-asset fallback uses existing upload/raw-file serving checks and best-effort cleanup;
- rate limits apply per workspace/session/plugin/op/callerClass;
- denied and high-volume access attempts are audited.

WorkspaceBridge defines a `RateLimitPolicy` interface keyed by workspaceId, sessionId/principalId, pluginId/runtimeId, callerClass, and op. Actor attribution is logged beside rate-limit decisions for observability, but v1 does not add actor-kind-specific rate-limit semantics. The base workspace package provides a simple in-memory implementation suitable for CLI/local use, and hosts may also configure no-op behavior for trusted local mode. Core/cloud can inject distributed rate limiting later. Default limits should exist for human-input mutations and Macro high-volume reads where a limiter is configured.

Audit log retention/access policy:

- redaction happens at write time, not only display time;
- security-sensitive audit events should be append-only/tamper-evident where feasible;
- retention duration and readers must be configured by host/core/cloud;
- local CLI may keep short local logs or disable persistent audit logs with explicit local-only caveat.

## Test matrix

Each phase must include tests with detailed, token-redacted logs. The final security phase aggregates; it must not be the first place core behavior is tested.


| Area                          | Required tests                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| Shared contracts              | typecheck front/shared/server; no node imports in shared; no value imports from agent                  |
| Rename/invariants             | no public `postCommand` alias; AGENTS/invariant docs updated; UI effects still work                    |
| Registry                      | success, unknown op, duplicate op, schema failure, timeout, input/output size limit                    |
| Tokens                        | valid, expired, wrong audience, workspace/session/plugin mismatch, redaction                           |
| Out-of-process HTTP transport | browser auth, runtime bearer, caller allowlist, CSRF/origin, no-cache, CORS default-deny               |
| Idempotency                   | same payload replay, conflicting replay, missing key, one-shot answer/cancel, concurrent double submit |
| Runtime env                   | direct/local/vercel env visibility, no persisted tokens, HTTPS/public URL for remote                   |
| Human input                   | request, pending, answer, cancel, timeout, abort, duplicate request, nonce checks                      |
| Ask-user e2e                  | tool registration, UI opens, browser answers, waiter resolves, no old route hit                        |
| Macro frontend + SDK          | no plugin-owned data routes required; browser bridge adapters; direct/local/vercel smoke; no localhost; stable bridge errors |
| Payload/file-asset            | oversized rejection, unified upload/raw-file fallback path validation, no host paths                    |
| Security                      | cross-workspace/session/plugin denial, token redaction, invariant lint, rate limits, actor attribution logs |


## Implementation phases

### Phase 0 — ADR/security model

Document and approve:

- caller classes;
- actor attribution for observability (`actorKind`, `performedBy`, `onBehalfOf`);
- package boundary rules;
- BridgeAuthPolicy/auth adapter shape;
- token claims;
- browser vs runtime auth;
- capability naming and resource scopes;
- op registry metadata;
- idempotency/replay policy;
- Pi extension bridge context decision;
- Macro no-plugin-data-route requirement and preflight requirement;
- payload/file-asset fallback policy.

Artifact: [`docs/adr/workspace-bridge-v1-authority-model.md`](../../docs/adr/workspace-bridge-v1-authority-model.md).

Acceptance:

- ADR exists and is linked from this plan.
- Open decisions are resolved or deferred with owner + follow-up bead.
- ADR states Macro data/domain browser UI and runtime SDK calls move to bridge so plugin-owned `/api/macro/*` data routes are not required.
- ADR states `emitUiEffect` hard rename has no alias.
- No code implementation starts until this phase closes.

### Phase 1A — Hard rename UI side-effect lane only

Goal: rename the UI side-effect API with minimal semantic change before RPC churn.

Scope:

- Introduce/rename to `WorkspaceBridge.emitUiEffect` as the single UI side-effect API.
- Replace `UiBridge.postCommand`, `postUiCommand`, and old canonical language where they represent the same concept.
- Do not add RPC yet.
- Do not export compatibility aliases.
- Preserve chat-stream `data-ui-command` as display-only derivative.
- Update AGENTS.md and invariant lint/docs in the same phase.

Acceptance:

- `rg "postCommand|postUiCommand|UiBridge\.postCommand"` returns no canonical API uses; any remaining historical docs are explicitly archival.
- AGENTS/invariant text says `WorkspaceBridge.emitUiEffect` is the single UI side-effect dispatch source.
- Existing UI open-panel/focus-file/toast tests pass under the new name.
- Workspace front/server typechecks pass.
- No `emitUiEffect` implementation in `src/shared/**` uses Node-only imports.

### Phase 1B — WorkspaceBridge RPC shared contracts

Add platform-neutral request/response contracts after the UI lane rename is stable.

Scope:

- Add shared call types, operation metadata, caller classes, actor attribution context, bridge context, idempotency policy, and stable error codes.
- Keep all shared code platform-neutral.
- Define `WorkspaceBridgeOperationDefinition` enough for registry/route work.
- Pin canonical bridge error enum/import site.

Acceptance:

- Shared type tests/typecheck pass.
- Stable bridge error enum has one import source.
- No raw string bridge error codes in new bridge code.
- No value import from `@hachej/boring-agent` in workspace base front/shared code.

### Phase 1C — WorkspaceBridge test harness and redacted logging fixtures

Create reusable test harnesses before registry/token/HTTP/human-input/Macro implementation beads fan out.

Acceptance:

- Test builders can create browser/runtime/server bridge contexts, fake BridgeAuthPolicy, fake runtime token claims, fake audit sink/logger, fake rate limiter, fake clock, and fake workspace adapter where appropriate.
- Redaction helpers intentionally fail when logs/errors/snapshots contain bearer token values, Authorization headers, full answers, file contents, host absolute paths, stack traces, or full request payloads.
- Actor attribution fixtures cover human/agent/system/service and request-body spoofing assertions.
- File-asset/raw-file fixtures cover generated bridge outputs sharing upload/raw-file path validation and redaction behavior.
- A guardrail fixture fails if `workspace-files.v1.*` bridge ops are accidentally registered.

### Phase 2 — In-process bridge registry

Add server-side registry/dispatch for trusted in-process calls.

Acceptance:

- Register/call demo op.
- Unknown op rejected.
- Duplicate op rejected.
- callerClassesAllowed validated for server/runtime/browser contexts.
- Missing capability rejected.
- Input and output schemas validated.
- `maxInputBytes` and `maxOutputBytes` enforced.
- Timeout enforced.
- Handler-triggered UI effects call `emitUiEffect`, not an RPC shortcut.

### Phase 3 — Token primitives

Add server-only token mint/verify primitives.

Acceptance:

- Valid token verifies.
- Expired token rejected.
- Wrong audience/malformed token rejected.
- Workspace/session/plugin mismatch rejected.
- Missing capability rejected.
- Claims, not body, determine workspace/session/plugin identity and runtime/agent attribution where present.
- Token absent from errors/log diagnostics.

### Phase 3B — BridgeAuthPolicy adapters

Implement browser/server auth policy seams before any out-of-process transport.

Acceptance:

- Workspace package exposes an auth-policy interface without importing core auth/DB.
- CLI/local no-auth policy is explicit and local-safe.
- Core/full-app wrapper can resolve user/principal, workspace membership, session context, CSRF/origin checks, effective capabilities, resource scopes, and human actor attribution.
- Browser caller class cannot be inferred from absence of bearer token.
- Missing auth context fails closed except explicitly configured local mode.
- Tests cover browser allowed op, browser runtime-only denial, unauthenticated denial, wrong-workspace denial, and local CLI policy behavior.

### Phase 3C — Idempotency/replay primitives

Implement operation-level idempotency store and replay checks after identity/capability context is defined by tokens and BridgeAuthPolicy.

Acceptance:

- Missing idempotency key for required mutation returns `BRIDGE_IDEMPOTENCY_REQUIRED`.
- Same key + same payload returns previous result where safe.
- Same key + different payload returns `BRIDGE_REPLAY_REJECTED`.
- One-shot answer/cancel replay is handled according to explicit policy.
- Concurrent answer/cancel resolves exactly one final state.
- Token value never appears in idempotency records or diagnostics.

### Phase 4A — Bridge audit logging, redaction, and rate limits

Implement structured audit and rate limiting as transport-neutral bridge primitives before adding the out-of-process HTTP transport.

Why this comes before HTTP: audit/rate limits apply to in-process calls, browser calls, runtime bearer calls, and future iframe/postMessage transports. They are bridge behavior, not HTTP-only behavior.

Acceptance:

- Audit events include op, workspaceId, callerClass, actorKind, redacted performedBy/onBehalfOf, plugin/runtime id, capability decision, duration, byte counts, and stable error code.
- Audit events exclude bearer tokens, full request payloads, file contents, full user answers, host paths, and stack traces by default.
- Redaction happens before write/persist.
- RateLimitPolicy receives workspace, session/principal, plugin/runtime id, caller class, and op. Actor attribution is logged beside rate-limit outcomes but does not complicate v1 limiter keys.
- Base implementation is simple in-memory/local; core/cloud can inject distributed policy later.
- Rate-limit denial returns `BRIDGE_RATE_LIMITED`.
- Tests prove redaction for denied, failed, and successful calls.
- In-process calls are covered by audit/rate-limit tests; coverage is not limited to HTTP.

### Phase 4B — Out-of-process HTTP bridge transport

Add `POST /api/v1/workspace-bridge/call` for callers that cannot use the in-process bridge.

This phase is needed for sandbox/runtime SDKs, browser bridge submissions, and future external runtimes. It is not required for the in-process ask-user path.

Acceptance:

- Browser-auth handler call succeeds for browser-allowed op.
- Browser call rejected for runtime-only op.
- Runtime token call succeeds for scoped op.
- Runtime bearer mode cannot call browser-only op unless explicitly allowed.
- Expired/missing-capability tokens rejected.
- CSRF/origin mutation behavior covered where host auth exists.
- Route tests include mutation idempotency behavior.
- Response headers include no-store.
- CORS is default-deny.
- Error responses redact tokens/secrets/host paths.
- Tests prove in-process ask-user/human-input flow does not require this HTTP route.

### Phase 5 — Workspace server composition

Wire bridge into workspace app/server composition.

Acceptance:

- `createWorkspaceAgentServer()` can register a test handler and call it through HTTP.
- Bridge instance can be injected/inspected in tests without module singletons.
- Multiple workspaces/server instances do not share bridge state accidentally.
- Existing UI side-effect bridge behavior still works.
- Workspace package remains DB-free.

### Phase 6A — Agent-neutral runtime env/context contribution seam

Add generic seams in `@hachej/boring-agent` without importing workspace.

Acceptance:

- Agent exposes generic runtime env/context contribution hooks.
- Standalone agent behavior is unchanged when no contributor is supplied.
- No workspace-specific env names or imports are hardcoded in generic agent layers.
- Tests prove existing direct/local/vercel execution still works without bridge.

### Phase 6B — Workspace bridge env injection

Inject bridge env into direct/local/vercel runtime execution from workspace/core composition.

Acceptance:

- Direct exec sees bridge env when capability requires it.
- Local/bwrap exec sees bridge env when capability requires it.
- Vercel sandbox exec sees public HTTPS/reachable bridge URL or stable disabled diagnostic.
- Commands/tools that do not need bridge access do not receive token where feasible.
- Token not written to `.boring-agent/`, workspace files, provisioning output, logs, or diagnostics.
- Tests log redacted token presence, not token value.

### Phase 7 — TypeScript bridge client

Add `@hachej/boring-workspace/bridge-client`.

Acceptance:

- Reads env vars.
- Sends correct request.
- Sets bearer header.
- Supports `idempotencyKey` option.
- Maps stable errors.
- Missing env error names missing var without token value.
- Client does not import workspace server internals.
- Package exports/build include JS and d.ts.

### Phase 8A — Pending-question schemas/runtime/store

Move only the generic pending-question coordination backend into workspace-owned workspace infrastructure; keep ask-user-specific tool/UI/form payload ownership in the ask-user plugin.

Acceptance:

- Workspace owns only generic pending-question envelope/state schemas; ask-user owns form-specific shared payload/schema details; workspace does not import `plugins/ask-user`.
- Store injection seam exists.
- File-backed default works.
- One-pending-per-session behavior pinned.
- Create/pending/answer/cancel/timeout/transcript tests pass.
- Duplicate request ID before and after final answer is covered.
- No workspace DB dependency.

### Phase 8B — Pending-question bridge integration

Wire the pure pending-question runtime into WorkspaceBridge composition where needed.

Acceptance:

- Runtime/store can be tested without HTTP route.
- Bridge integration creates handlers using injected store/runtime.
- No duplicate store is created when server composition registers handlers.

### Phase 9 — Human-input bridge handlers

Register `human-input.v1.request/answer/cancel/pending/transcript`.

Acceptance:

- `request` uses in-process wait only in v1.
- Request emits UI effect and waits.
- Answer requires workspace/session + mandatory nonce, not questionId alone.
- Answer resolves exact waiter.
- Cancel/timeout/abort resolve stable result.
- Duplicate request ID idempotent.
- Runtime token and normal browser user cannot read transcript; super-admin/debug auth can.
- Tool-result mapping is pinned: `answered` returns typed result; `user_cancelled` returns stable cancellation result/error; `timed_out` returns stable timeout result/error; `tool_aborted` follows tool-side abort semantics; `server_restart`/`abandoned` returns a stable explicit code chosen in this phase.
- Test logs include requestId/toolCallId/questionId/sessionId, callerClass, actorKind, redacted performedBy/onBehalfOf, and redacted auth context.

### Phase 10 — Ask-user front migration

Change ask-user front to submit/cancel through bridge.

Acceptance:

- Submit sends `human-input.v1.answer`.
- Cancel sends `human-input.v1.cancel`.
- Browser calls use normal browser auth, not runtime bearer token.
- Missing/invalid nonce is handled clearly.
- UI still renders pending state if page refreshes while question is pending.
- No custom ask-user answer/cancel route is called in the new path.

### Phase 11 — Ask-user agent extension

Add ask-user Pi extension agent surface. If earlier work already added an ask-user Pi extension factory/server-plugin composition, this phase rewires/replaces it to use explicit in-process WorkspaceBridge context instead of old server plugin/agentTools state.

Acceptance:

- Pi extension registers `ask_user`.
- Extension uses explicit in-process bridge context when loaded in host process.
- If context unavailable, tool disabled or returns stable diagnostic; no hidden globals.
- Invalid input fails locally.
- Valid input calls `human-input.v1.request` with request/tool call id.
- Tool cancellation aborts waiter.
- New path does not require `WorkspaceServerPlugin.agentTools`.

### Phase 12 — Ask-user hard cutover and old server-surface removal

Remove or fail-fast the old ask-user server export/routes so the new bridge path is the only supported setup.

Acceptance:

- New setup works without `WorkspaceServerPlugin.agentTools`.
- Old ask-user answer/cancel routes are not active in the supported setup.
- Old `@hachej/boring-ask-user/server` export is removed from public exports or returns a clear fail-fast diagnostic if physical removal is deferred.
- Duplicate old/new store or tool setup is impossible or fails clearly.
- Tests assert no old server route receives answer/cancel in the new path.
- Docs show only the new setup; old server setup is mentioned only as unsupported/historical if needed.

### Phase 13 — Ask-user e2e

Update playground/test composition to prefer front+agent+human-input.

Acceptance:

- E2E logs: extension registration, tool call, bridge request, UI effect, pending question, browser answer, waiter resolution.
- Model/tool calls `ask_user`.
- Questions pane opens.
- Browser answer goes through bridge.
- Tool resolves.
- Test asserts `agentTools` path is not used for new path.
- Test asserts no ask-user custom route receives answer/cancel.

### Phase 14 — Trusted domain handler helper

Add small helper for trusted app/internal domain handlers.

Acceptance:

- Demo domain op registers.
- Missing metadata rejected.
- Unversioned/reserved op rejected if policy requires.
- Output byte limit enforced.
- Helper is clearly trusted-only and not documented as generated-plugin API.

### Phase 15 — Confirm no generic workspace-files bridge API in v1

Do not implement `workspace-files.v1.read/write/list` in v1. Existing workspace file/raw/upload endpoints cover file needs, and Macro deck work should use those or a separate deck plan. This phase is a guardrail/audit step before Macro handler work, not a feature implementation.

Acceptance:

- No `workspace-files.v1.*` bridge operations are registered.
- Existing workspace file/raw/upload endpoint tests remain green.
- Macro preflight confirms deck/file-like behavior does not require Macro plugin server routes in the supported bridge setup.
- Large-output fallback points to the unified upload/file-asset/raw-file mechanism, not generic bridge file ops.
- Path validation remains covered by existing adapter/file endpoint tests.

### Phase 16 — Macro preflight/audit

Verify and update the concrete route classification embedded in this plan before implementing handlers. The initial audit says required v1 bridge ops are macro.v1.catalog.search, macro.v1.facets.list, macro.v1.series.metadata, macro.v1.series.data, macro.v1.series.lineage, macro.v1.sql.query, and macro.v1.transform.persist; Macro data/domain UI and SDK use bridge; deck/file use existing workspace file mechanisms or separate deck plan; raw ClickHouse ch-query stays out of v1 bridge.

Acceptance:

- Confirm `/home/ubuntu/projects/boring-macro/src/plugins/macro/server/routes/macro.ts` still matches the embedded route table or update the table.
- Every Macro SDK call has bridge op or explicit deferred reason.
- Browser/product Macro data routes to remove or convert to bridge wrappers are listed.
- SDK-only routes to deprecate are listed.
- File-like/deck behavior explicitly stays out of Macro bridge/server routes in v1; use existing workspace file/upload/raw-file mechanisms or separate deck plan.
- Shared service extraction points identified.

### Phase 17 — Macro bridge handlers

Register required Macro bridge handlers replacing plugin-owned data routes: `macro.v1.catalog.search`, `macro.v1.facets.list`, `macro.v1.series.metadata`, `macro.v1.series.data`, `macro.v1.series.lineage`, `macro.v1.sql.query`, and `macro.v1.transform.persist`. Optional refresh ops are added only if product still needs manual refresh.

Acceptance:

- For each required mapped SDK-runtime route, route result and bridge result match on fixtures.
- Macro handlers share implementation services with any temporary route wrappers, but handlers are canonical.
- Capabilities enforced.
- `macro.v1.transform.persist` requires idempotency key.
- No deck or raw ClickHouse `/api/macro/ch-query` bridge ops added. SQL is bridged only through guarded `macro.v1.sql.query`.
- Macro browser/front data adapters use bridge ops; no plugin-owned `/api/macro/*` data routes required. Any temporary route wrapper must be tested as non-canonical and removable.

### Phase 18 — Macro payload unified file-asset support

Implement Macro pagination and unified upload/file-asset fallback as needed before declaring SDK migration complete.

Acceptance:

- Oversized bridge response rejected with `BRIDGE_OUTPUT_TOO_LARGE`.
- Large Macro results paginate/window or return a unified file-asset pointer with workspace-relative path/contentType/rawUrl.
- Generated outputs reuse the same workspace adapter/file route mechanisms as chat/UI uploads and raw previews.
- Cache/file-asset reads go through existing raw-file/file mechanisms.
- No separate artifact service/route/op and no generic workspace-files bridge API is introduced in v1.
- No unbounded streaming through generic bridge endpoint.

### Phase 19 — Macro frontend and SDK bridge migration

Update Macro frontend data adapters and SDK transport to prefer WorkspaceBridge instead of plugin-owned `/api/macro/*` routes or hardcoded app URLs.

Acceptance:

- Macro browser/front catalog, facets, series, and lineage data adapters call browser-allowed bridge ops.
- Python client reads env and handles stable bridge errors.
- Direct/local/vercel sandbox smoke can call `macro.v1.series.data`.
- Direct/local/vercel sandbox smoke can call guarded `macro.v1.sql.query` for read-only SQL.
- `macro.v1.transform.persist` works with idempotency key.
- Missing env gives clear setup error.
- No localhost or `/api/macro/*` route assumption in the supported bridge path.
- Standalone/non-Boring fallback, if any, is documented and clearly separate from Boring bridge mode.
- Smoke logs bridge op, workspace id, callerClass, actorKind, redacted performedBy/onBehalfOf, and redacted URL/token presence.

### Phase 20 — Security/non-regression aggregator

Final cross-cutting suite; per-phase tests should already exist.

Acceptance:

- Runs or documents commands for all per-phase tests.
- Expired/missing-capability/workspace/session/plugin denial covered.
- Token not logged/persisted.
- Browser CSRF/origin preserved.
- File ops go through adapter validation.
- Ask-user bridge e2e passes.
- Macro smoke tests pass when downstream checkout/provider available.
- Invariant lint passes after `emitUiEffect` rename.

### Phase 21 — Docs and migration guides

Update:

```txt
AGENTS.md
packages/workspace/scripts/check-plugin-invariants.mjs
packages/workspace/docs/PLUGIN_SYSTEM.md
packages/pi/references/workspace/plugins.md
plugins/ask-user/README.md
docs/runtime-plugin-v2-hot-reload-plan.md or successor architecture docs
```

Acceptance:

- Docs explain `WorkspaceBridge.call` is request/response host capability RPC.
- Docs explain `WorkspaceBridge.emitUiEffect` is UI side effect only and replaces old naming with no alias.
- Docs explain `/api/v1/workspace-bridge/call` is transport, not the abstraction.
- Docs explain most bridge calls do not involve frontend.
- Ask-user before/after setup documented.
- Macro route-to-bridge mapping documented.
- TS and Python snippets include idempotency key examples.
- Docs warn never to persist/log bridge tokens.

## Dependency graph

```txt
Phase 0 ADR
  ↓
Phase 1A emitUiEffect hard rename
  ↓
Phase 1B RPC shared contracts
  ↓
Phase 1C test harness/redacted logging fixtures
  ↓
Phase 2 registry
Phase 2 registry
  ↓
Phase 3 tokens
  ↓
Phase 3B BridgeAuthPolicy adapters
  ↓
Phase 3C idempotency/replay
  ↓
Phase 4A audit/rate limits
  ↓
Phase 4B out-of-process HTTP transport
  ↓
Phase 5 workspace composition
  ↓
Phase 6A agent-neutral env/context seam
  ↓
Phase 6B workspace bridge env injection
  ↓
Phase 7 TS bridge client

Human-input / ask-user track:
Phase 1B shared contracts
  ↓
Phase 8A pending-question schemas/runtime/store
  ↓
Phase 2 registry + Phase 3C idempotency + Phase 5 composition
  ↓
Phase 8B pending-question bridge integration
  ↓
Phase 9 human-input bridge handlers
  ↓
Phase 10 ask-user front
  ↓
Phase 11 ask-user agent extension
  ↓
Phase 12 hard cutover
  ↓
Phase 13 ask-user e2e

Macro / SDK track:
Phase 14 trusted domain helper
  ↓
Phase 15 no generic workspace-files bridge guardrail
  ↓
Phase 16 Macro preflight/audit
  ↓
Phase 17 Macro bridge handlers
  ↓
Phase 18 Macro payload unified file-asset fallback if needed
  ↓
Phase 19 Macro frontend and SDK bridge migration

Final:
Phase 20 security/non-regression aggregator depends on ask-user e2e, Macro SDK/payload work, audit/rate limits, no-generic-file-bridge guardrail, and env injection.
Phase 21 docs depends on ask-user hard cutover, Macro SDK migration, and invariant rename.
```

## Risks and mitigations

### Token leakage

Risk: runtime bridge token appears in logs, generated files, `.boring-agent/`, env inherited by child processes, or tool output.

Mitigation: inject only per execution when needed; redact in all errors/logs; add grep/file tests and negative diagnostics tests; do not inject bridge env for commands without bridge capability where feasible.

### Hard rename breaks existing UI effect callers

Risk: removing old alias causes broad compile failures.

Mitigation: make the rename a single focused phase with typecheck and invariant updates; no compatibility alias, but migration is mechanical and tested.

### Long-running human-input requests through HTTP

Risk: proxies/timeouts break blocking waits.

Mitigation: v1 blocking wait is only in-process for Pi extension tools; external SDK long-poll/poll protocol is separate.

### Duplicate ask-user stores

Risk: old server plugin and new pending-question coordinator both hold pending state.

Mitigation: hard cutover removes the old server coordination path, or fails fast if any old path is accidentally configured.

### Macro payloads exceed bridge limits

Risk: series data becomes too large for generic JSON RPC.

Mitigation: pagination/windowing first; unified upload/file-asset/raw-file fallback for large outputs.

### Agent/workspace package coupling

Risk: bridge env injection makes `@hachej/boring-agent` depend on workspace.

Mitigation: agent exposes generic env/context extension seams only; workspace/core inject bridge-specific env and clients.

### Browser bridge auth bug

Risk: workspace route accidentally accepts unauthenticated or cross-origin browser mutations.

Mitigation: injected BridgeAuthPolicy, same-origin default, CSRF/origin checks, caller allowlist, and tests for browser/runtime confusion.

## Open decisions before Phase 0 closes

1. Where should token signing secret come from in CLI/no-auth mode?
2. What exact `BridgeAuthPolicy` interface should workspace expose for core/full-app auth wrappers?
3. What exact Pi extension context seam can provide in-process WorkspaceBridge access without hidden globals?
4. What concrete default rate limits apply in CLI, full-app, and hosted/cloud modes?
5. What audit retention/read-access policy applies in CLI versus core/cloud?

## Success criteria

- `ask_user` works in a workspace with only ask-user front + Pi extension surfaces.
- Ask-user no longer needs plugin-owned server routes for the new path, and old answer/cancel server route setup is not active in the supported setup.
- Workspace-owned pending-question coordinator is DB-free with store injection seam.
- Runtime/sandbox SDK calls use scoped bridge token and no localhost assumption.
- Macro SDK can call data/persist operations via bridge in direct/local/vercel modes.
- Macro browser/product data access uses bridge; plugin-owned `/api/macro/*` data routes are not required in supported setup.
- Deck/file/raw/upload use existing workspace mechanisms or separate deck plan; large bridge outputs reuse the same file-asset/raw-file pipeline; no generic workspace-files bridge ops are added in v1.
- Bridge audit/log output distinguishes human, agent, system, and service actors for observability without trusting request-body spoofing.
- No bridge token appears in logs, workspace files, diagnostics, or tool outputs.
- `WorkspaceBridge.emitUiEffect` is the canonical UI side-effect dispatch path, with no old alias.