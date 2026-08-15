---
github: https://github.com/hachej/boring-ui/issues/1129
issue: 1129
state: ready-for-human
updated: 2026-08-15
flag: not-needed
track: owner
---

# gh-1129 MCP ingress — external clients consume a boring-ui Workspace

Plan revision **r2** — gate 1 request-changes response. Revision r1 and its visual packet remain immutable evidence. This revision answers who owns the MCP connection/session and how that lifetime relates to Agent execution.

This plan replaces the obsolete implementation target in
`docs/issues/806/plan.md`; it does not implement product source or authorize a
production exposure.

## Problem

The repository already ships a dark managed-agent MCP server, but its remaining
plan still treats hostname and a typed Workspace domain as authorization and agent
selection. Decisions 28–30 and the shipped AgentGateway make that target invalid.
The useful protocol work should be retained, while authority must be recut around
the current Workspace, fleet, and gateway model.

## Today

### Shipped ingress

Current `origin/main` (`ee2017188`) already provides:

- `packages/agent/src/server/mcp/managedAgentMcpServer.ts`: stock MCP SDK
  Streamable HTTP server with `delegate_task`, `delegate_task_start`, and
  `delegate_task_status`;
- `managedAgentDelegate.ts`: AgentGateway-capable execution, process-local
  polling, abort, bounded results, stable errors, redaction canaries, and at most
  one complete inline Markdown artifact;
- coded limits of 32 KiB brief, 96 KiB final assistant text, 256 KiB Markdown,
  384 KiB serialized result, 100 retained progress items, 100 controller
  records, and 15-minute terminal retention;
- `apps/full-app/src/server/managedAgentMcp.ts`: a dark-by-default
  `/mcp/managed-agent` route where one static bearer maps to one configured
  user/workspace and membership is checked before dispatch;
- package, full-app, and `smoke:mcp-managed-agent` tests using the unmodified
  MCP SDK client and Streamable HTTP transport.

### Current authority

Decisions 28, 29, and 30 supersede the old typed-domain target:

- a Workspace durably persists `defaultAgentTypeId`; an unknown persisted value
  must fail stably rather than silently select another fleet Agent;
- `AgentGateway` is the sole session contract and `createAgentHost()` is the
  sole construction funnel;
- `AuthorizedAgentScope` is an issuer-owned runtime capability rechecked on
  every use, never a transport DTO;
- hostname may affect landing presentation and initialize a new default
  Workspace at signup, but it has no continuing membership, routing,
  selection, or authorization authority.

The full-app MCP adapter has not caught up completely: it hardcodes
`agentTypeId: 'default'` and uses the compatibility
`runWithWorkspaceAgent` bridge. Core's current helper also silently falls back
when a persisted default names an unknown fleet member, contradicting Decision
28's stable-failure rule. This code drift is evidence to reconcile, not authority
to extend into MCP.

### Remaining safety gaps

- The MCP edge returns a bespoke `running/completed/error` delegation shape
  instead of projecting Decision 22's canonical `AgentTask` v2 lifecycle,
  messages, principal, and actor.
- `delegate_task` and `delegate_task_start` have no caller-stable idempotency
  key, so a lost response retried with a fresh JSON-RPC id can start duplicate
  model work.
- Capacity is globally bounded, but there is no finite per-credential start
  rate/concurrency admission.
- Retained progress has an item cap but no per-message or aggregate byte cap.
- `resultTool()` duplicates the full structured result into text and no test
  freezes the final serialized MCP response boundary. The SDK echoes caller
  JSON-RPC ids and `_meta.progressToken` values, and accepts batch arrays. The
  edge cannot claim a complete HTTP/SSE response ceiling until it bounds both
  identifiers, rejects batches, and caps all emitted progress bytes.
- The current smoke proves protocol plumbing through a fake dispatcher seam;
  it does not qualify persisted default-agent selection through the current
  AgentGateway authority.

### Direction boundary: where #1011 fits

This plan is **ingress from the external client's perspective**:

```text
external MCP client -> boring-ui MCP server -> Workspace AgentGateway -> Agent
```

Issue #1011 is the opposite, consumption-side direction:

```text
Workspace Agent -> per-Agent grant -> user-registered external MCP server
```

The two paths may compose during one turn: an externally connected client can
invoke a Workspace Agent, and that Agent may itself receive #1011-governed MCP
connector capabilities. They remain separate protocol edges, credentials,
authorization decisions, stores, and proof. This plan does not register an
external MCP server, resolve `mcpServerRefs`, edit per-Agent grants, or depend on
#1011 completion.

## Delta

Deliver a private, deployment-static MCP ingress binding aligned to today's
authority:

```text
static credential binding
  -> credentialId + existing principal + one existing Workspace
  -> current app / non-deleted Workspace / current membership
  -> strict Workspace defaultAgentTypeId resolution against static fleet
  -> binding-specific Core authorizeStart() / authorizeStatus() closures
  -> capability-light StartAdmission; lease only after dedupe/limits
  -> narrow task capability lease for one new task; separate status disclosure
  -> Core closes over strict Agent selection + AuthorizedAgentScope + AgentGateway
  -> existing managed MCP delegation and bounded delivery
```

The credential chooses one already-existing principal/Workspace pair. The
Workspace's persisted default chooses the Agent. Hostname chooses neither.
Tool input, MCP session id, JSON-RPC id, forwarded host, and request body grant
no authority.

Retry identity is a required caller-supplied `idempotencyKey`, scoped after
current authorization to the trusted credential/principal/Workspace/Agent
binding. Same scope + the exact bytes returned by the existing trimmed `parseBrief`
normalization returns the existing task while its record is retained; same key +
different normalized bytes conflicts. The guarantee lasts only for the
configured terminal-retention window in one process. Expiry, restart, or replica
handoff may lose the record and permit another run.

## Ownership and lifetime decision

### Terms: six different lifetimes

| Term | Meaning here | Owner / lifetime |
| --- | --- | --- |
| **External MCP client connection** | The caller's SDK `Client` plus HTTP connection(s). Streamable HTTP may reconnect or issue concurrent requests; it is not an Agent runtime. | External caller; outside boring-ui. |
| **MCP server transport session** | The server-side SDK `McpServer` + `StreamableHTTPServerTransport` for protocol parsing and response delivery. Today's route has `sessionIdGenerator: undefined`, so it is stateless across HTTP requests and creates/closes this pair per request/response. | Full-app MCP edge; request/transport lifetime. |
| **Selected `AgentGateway`** | Decision 29's sole Agent session API, selected only after current credential/Workspace/default-Agent authorization. It is not an MCP transport and is never exposed raw to the MCP package. | Application fleet process; Core's narrow task capability closes over it for one admitted task. |
| **Workspace authorization/default** | Current app, non-deleted Workspace, membership, principal, and strict persisted `defaultAgentTypeId`. Workspace chooses the authorized Agent; it does not hold an MCP socket or protocol session. | Core/Workspace authority; rechecked for each start and status call. |
| **Background agent task** | One admitted canonical `AgentTask` plus gateway session, bounded artifact collection, concurrency slot, and retained receipt. | Process-lifetime MCP delegate controller record plus one per-task execution lease until terminal collection. |
| **Factory worker session** | The development automation session that later implements a bead. It is not a product runtime or MCP component. | Boring Factory only; no production connection, task, Workspace, or gateway ownership. |

In this plan, **worker** means only the last row when discussing Beads/factory
execution. It never means the external MCP client, app server, MCP controller,
Workspace, AgentApplication, AgentGateway, or background agent task. Product
text uses **background agent task** or **task lease**, never "worker", for the
running delegation.

### Options compared

| Option | Shape | Benefit | Failure / decision |
| --- | --- | --- | --- |
| **A — each `AgentApplication` holds an MCP connection** | One protocol client/server connection per fleet Agent. | Superficially makes routing look direct. | **Reject.** It couples an edge protocol and caller lifetime to deployment-static behavior objects, duplicates transport ownership per Agent, bypasses Workspace strict-default selection, and conflicts with Decisions 22/28/29. AgentApplications receive invocation capabilities; they do not own transport sessions. |
| **B — Workspace holds the MCP connection** | The authorized Workspace keeps the external protocol session and dispatches from it. | Makes Workspace selection visible. | **Reject.** Workspace is authorization/default/filesystem authority, not a network-session container. Connection churn would distort Workspace lifetime, risk cross-client state, and couple Core/CLI Workspace orchestration to one edge protocol. |
| **C — app edge owns protocol transport; delegate controller owns receipts; each admitted task owns a bounded execution lease** | Full-app authenticates each request and owns the stateless SDK transport. The process-lifetime MCP controller holds only bounded task/receipt state. After reauthorization, dedupe and limits, one new task acquires a narrow Core capability that closes over the selected AgentGateway/scope and exposes only task run/stop, minimal reader, and release through terminal collection. | Keeps protocol at the edge, Workspace as authority, AgentGateway as the sole hidden session contract, and task authority no broader/longer than needed. | **Choose.** This matches Decisions 22/28/29/30 and today's `createManagedAgentMcpHttpHandler`: per-request SDK transport with `sessionIdGenerator: undefined`, while one controller is created at route registration and survives request disconnects. |

No new long-lived MCP server session is introduced. If a later MCP feature
requires a stateful server session, the full-app edge still owns it and maps its
opaque session id to bounded edge state; it does not move into Workspace or an
AgentApplication and grants no selection or execution authority.

### Exact lifecycle

1. **Create / connect.** An external caller creates one SDK client/transport and
   connects to `/mcp/managed-agent`. Full-app authenticates every HTTP request.
   The server creates a request-scoped `McpServer`/transport pair; there is no
   durable server session id in this slice.
2. **Select Agent.** `authorizeStart()` rechecks app, Workspace existence,
   membership, principal, and strict persisted `defaultAgentTypeId` against the
   static fleet. Neither connection nor MCP session chooses an Agent.
3. **Admit task / commit async ownership.** The process-lifetime controller
   scopes idempotency to the trusted credential/principal/Workspace/Agent binding,
   returns retained work when possible, then enforces fixed-window rate,
   per-credential concurrency, and capacity. Only one newly reserved record calls
   `acquireTaskLease()`. The async commit point is observable inside the controller:
   the narrow lease is atomically attached and a running receipt is stored before
   response delivery is attempted. Before commit, request abort cancels admission;
   after commit, task-owned cancellation replaces the request signal. A lost
   response can recover the same receipt by idempotent retry.
4. **Run.** The task record, not the transport, retains the narrow task runner,
   minimal reader, and concurrency slot through terminal result and artifact
   collection. Core retains the raw scope/gateway and closes task methods over the
   strictly resolved Agent. `delegate_task_start` returns the stored receipt;
   `delegate_task` keeps the request open to terminal.
5. **Status / poll.** The same external SDK client may poll sequentially or in
   parallel, and a reconnecting client with the same credential may poll too.
   Every status call independently runs `authorizeStatus()` and receives only a
   disclosure key; it never reacquires the execution lease.
6. **Disconnect and cross-tool retry.** Closing/loss of HTTP/MCP closes only the
   request-scoped SDK server/transport. An async-created task survives after the
   controller commit point even if its receipt never reaches the client. Both MCP
   start tools share one task keyed by scope/key/payload: each caller gets its own
   response shape (`delegate_task_start` returns current receipt; `delegate_task`
   waits for terminal). The task's origin mode is frozen at first admission. Only
   the originating synchronous request signal may cancel a sync-created task;
   aborting a duplicate waiter never cancels shared work, and async-created tasks
   use only explicit controller/shutdown cancellation.
7. **Completion / cleanup.** `completed`, `failed`, `canceled`, and `rejected`
   all release the task lease and concurrency slot exactly once after bounded
   terminal collection. Only the non-capability receipt remains until TTL; then
   pruning removes it.
8. **Revocation.** Membership/deletion/default drift denies new starts and later
   status disclosure. Gateway revalidation remains authoritative through task
   creation/connect/send. The snapshot boundary is the accepted gateway send
   receipt, not controller admission: revocation before that receipt rejects the
   effect; after it, the already-running event stream and lease-authorized artifact
   collection may finish, but the revoked caller cannot poll. Connection closure
   is never an authorization signal.
9. **Shutdown.** Route close stops admission, aborts task-owned signals, and waits
   at most required `shutdownGraceMs` (100..300,000). Cooperative tasks clean up
   normally. At deadline, unresolved records are fenced from publishing status or
   performing later task/reader calls, marked canceled, and their lease/slot are
   logically released exactly once; late settlement is ignored. Only then may the
   application close its gateway, whose own lifecycle policy remains authoritative.
10. **Process restart.** Request transports, controller records, running tasks,
   and task leases are process-local. Restart closes/loses them; startup creates
   a new edge/controller and fleet gateway. There is no resume/recovery claim;
   old delegation ids return not found and retry may duplicate work.

### One client, multiple tasks and concurrency

One authenticated external client may submit sequential tasks and concurrent
`delegate_task_start` calls over one SDK client/transport; reconnecting does not
create a new authority bucket. Admission keys by trusted `credentialId`, not by
TCP connection, SDK client instance, MCP session id, JSON-RPC id, or bearer text.
Every genuinely new admitted start consumes both the credential's fixed-window
start budget and one `maxConcurrentPerCredential` slot. Retained idempotent
retries consume neither. Concurrent same-key calls across either start tool
single-flight onto one task; the first admission freezes its origin/cancellation
mode, while duplicate call abort cancels only that waiter. Completion or any
terminal failure releases exactly one slot. Therefore opening more
connections or client instances cannot bypass per-credential concurrency; a
credential may run at most the configured 1..100 tasks concurrently, additionally
bounded by global controller capacity.

## Solution

### 1. Reconcile the task contract and harden the existing package edge

Keep the `ManagedAgentMcpDelegateController` process-lifetime at route registration,
while every SDK `McpServer`/transport remains request-scoped and stateless. Extend,
do not replace, `ManagedAgentMcpDelegateController` and its MCP server:

- make canonical `AgentTask` schema v2 the authoritative task projection in
  structured responses: principal and actor come from trusted binding data; the
  consumer brief and Agent output are canonical messages; task identity/state
  follows `submitted -> working -> completed|failed|canceled|rejected`;
- retain inline Markdown only as an edge delivery presentation alongside the
  task, not as a second lifecycle or a generic canonical artifact locator;
- require a non-empty ASCII `[A-Za-z0-9._:-]+` key of at most 128 UTF-8 bytes
  for both start tools;
- before handing parsed bodies to the MCP SDK, reject batch arrays (exactly one
  JSON-RPC request or notification object per HTTP transport call), then validate
  every response-bearing JSON-RPC request id: allow only a safe integer or an ASCII
  `[A-Za-z0-9._:-]+` string of at most 128 UTF-8 bytes; reject null, unsafe or
  non-integer numbers, oversized/other strings, arrays, and objects before tool/
  controller work. Notifications with no id remain allowed. Apply the same rule
  to `params._meta.progressToken` when present; null/invalid tokens reject before
  SDK dispatch;
- let the host first supply a capability-light `StartAdmission`: redacted
  identity, request-authorized `agentTypeId`, and one-shot
  `acquireTaskLease()`, but no gateway/artifact reader;
- after dedupe, conflict, rate, concurrency, and capacity checks, reserve one new
  single-flight record, call `acquireTaskLease()` exactly once, and atomically
  transfer the lease to that record; retained retries and every admission
  rejection acquire no lease; if acquisition rejects, Core guarantees
  failure-atomic release of every partial lease/binding/reference so no active
  task binding or capability survives; cached environment generations remain
  under the existing manager and retire only by its canonical retire policy, while the package removes the reservation and decrements concurrency
  exactly once; if later package setup fails after fulfillment, the package also
  calls `release()` exactly once;
- retain the transferred task lease through asynchronous terminal
  result/artifact collection; each canonical terminal state — `completed`,
  `failed`, `canceled`, or `rejected` — releases the lease and decrements the
  concurrency slot exactly once;
- authorize each status lookup separately with a disclosure scope that carries
  trusted record identity but no gateway or artifact capability;
- scope dedupe to credential/principal/Workspace/Agent/key plus the exact bytes
  of the existing trimmed `parseBrief` result;
- authorize first, then look up the scoped key, then apply new-work limits, then
  create a task/session;
- single-flight concurrent same-key starts; return the retained task for same
  payload and a stable conflict for different payload;
- require fixed-window options `maxStartsPerWindow` (1..10,000),
  `startWindowMs` (1,000..86,400,000), and
  `maxConcurrentPerCredential` (1..100); the fixed window begins at the first
  admitted new start and resets when `now >= windowStart + startWindowMs`;
  retries of retained keys bypass both limits; new starts increment the window
  and concurrency, and terminal tasks release concurrency; rate errors include
  bounded `retryAfterMs` to that reset;
- cap each fully serialized progress notification — message, bounded token, JSON,
  and SSE framing — at 4 KiB, and all emitted plus retained serialized progress
  for one delegation at 64 KiB in addition to the 100-item cap. At exhaustion,
  emit/retain one bounded coalesced marker and no further progress notifications;
- keep `structuredContent` authoritative and return only a bounded compact text
  summary instead of duplicating the result;
- freeze `MAX_MCP_STATUS_RESPONSE_BYTES = 2112 * 1024` bytes from an explicit
  worst-case complete-JSON budget: `192 KiB` for the 32 KiB brief at 6x JSON
  escaping; `576 KiB` for canonical 96 KiB final text at 6x; `576 KiB` for the
  retained compatibility `finalAssistantText` projection at 6x (derived from
  the canonical task, not a second lifecycle); `512 KiB` for validated 256 KiB
  Markdown at 2x escaping; `128 KiB` for all bounded task/delivery metadata;
  `64 KiB` for all emitted plus retained progress measured after complete JSON/
  SSE serialization, including the bounded progress token; and `64
  KiB` for the bounded JSON-RPC id, MCP/JSON-RPC envelope, and compact summary. Add a 4 KiB artifact-title
  cap within metadata. Measure after `structuredContent`, compact `content`, and
  protocol envelope are assembled, with exact/over and worst-escape tests;
- preserve the existing oversize-result assertion without weakening or deletion:
  its 384 KiB title now rejects against the stricter 4 KiB title cap;
- never evict an unexpired idempotency record to admit new work: prune only at
  terminal retention expiry and reject new work when record capacity is full.

The same-process one-session claim is explicitly bounded by the retained record.
A retry after terminal TTL, process restart, or replica handoff may run again. No
new database, durable task service, second MCP server, or second model loop is
introduced.

### 2. Bind full-app through Core's current authority

Expose a binding-specific boot-time capability rather than a general scope
issuer. Full-app supplies Core one server-owned static
`{credentialId, principalId, workspaceId}` binding at composition time and
receives two non-parameterized closures, neither accepting caller-selected
identity: `authorizeStart()` and `authorizeStatus()`.

`authorizeStart()` rechecks the bound principal/Workspace/app/membership and
strict Workspace default, then returns a capability-light admission:

```ts
type ManagedMcpStartAdmission = {
  credentialId: string
  agentTypeId: string
  // One shot. Rejection leaves no active lease/binding/reference.
  // Cached environment generations keep canonical retire semantics.
  acquireTaskLease(): Promise<ManagedMcpTaskLease>
}

type ManagedMcpTaskLease = {
  // Core closes over AuthorizedAgentScope, strict agentTypeId, and AgentGateway.
  // No raw gateway/scope/close/list/arbitrary-agent operation crosses this seam.
  task: {
    run(input: ManagedMcpBoundTaskInput): AsyncIterable<AgentEvent>
    stop(reason: 'caller-abort' | 'shutdown'): Promise<void>
  }
  artifactReader: Pick<Workspace, 'stat' | 'readBinaryFile'>
  release(): Promise<void>
}
```

Authorization therefore occurs before scoped dedupe without allocating an
execution/artifact lease. The package performs retained-key lookup, payload
conflict, fixed-window, concurrency, and capacity checks first. A retained retry
returns its existing task and never calls `acquireTaskLease()`. A rejected start
also never calls it. Only after reserving one new single-flight record may the
package invoke the one-shot closure and atomically attach the returned lease to
that record. If acquisition rejects, Core first releases every partial lease/binding/reference before rejecting so
no active task binding or capability survives; cached environment generations
remain governed by the existing manager/retire policy; the package then removes
the reservation and decrements concurrency exactly once. If package setup fails
after a fulfilled lease, the package additionally calls `release()` exactly once.
Focused Core tests inject failure after each fallible acquisition step and assert
no active lease, task binding, or reference survives. They do not require eager
destruction of a cached environment generation; canonical retire owns that. The record retains the lease through work that
continues after `delegate_task_start` returns and inline artifact collection,
then releases it and the concurrency slot exactly once for every canonical
terminal state: completed, failed, canceled, or rejected.

This is not a controller-admission snapshot that bypasses gateway checks.
Decision 29 revalidation remains authoritative through create/connect/send. The
snapshot begins only after the gateway accepts the send effect; from there the
already-running event stream and lease-authorized artifact read may finish.

`authorizeStatus()` independently rechecks the same bound identity and strict
default, then returns only a trusted disclosure key for receipt lookup. It has
no AgentGateway, scope-minting parameter, or artifact reader. If membership is
removed, new starts and later status disclosure fail; a task whose send effect
was already accepted may finish under its lease, but its polling result is not disclosed until the
caller is authorized again (and only while retained).

Both closures accept no identity arguments. Core owns scope issuance and the
authorized Workspace reader; the app edge never receives a general function
that can mint arbitrary scope. The shared Core default resolver and web tests
are reconciled so web and MCP cannot silently fall back from an unknown
persisted Agent.

The route remains absent unless credential identity/binding and all four finite
lifecycle/admission options are complete. Full-app uses explicit server-only names
`BORING_MANAGED_AGENT_MCP_CREDENTIAL_ID`,
`BORING_MANAGED_AGENT_MCP_MAX_STARTS_PER_WINDOW`,
`BORING_MANAGED_AGENT_MCP_START_WINDOW_MS`, and
`BORING_MANAGED_AGENT_MCP_MAX_CONCURRENT`, and
`BORING_MANAGED_AGENT_MCP_SHUTDOWN_GRACE_MS`; enabled startup rejects missing,
non-integer, zero, negative, or out-of-range values. Shutdown grace is
100..300,000 ms. It remains a protocol binding at the edge under
Decision 22 and creates no second behavior resolver, filesystem authority, or
runtime owner.

### 3. Qualify the reference route with a stock client

Upgrade the deterministic full-app smoke to exercise the final binding through
an unmodified SDK client and prove:

- invalid bearer rejects before Workspace/gateway work;
- canonical `AgentTask` v2 is validated across submitted/working/terminal
  projection while edge-specific Markdown delivery remains bounded;
- strict persisted default Agent selection is used and an unknown persisted
  value fails without fallback or effect;
- a same-key retry within retained TTL creates one gateway session, while the
  post-TTL/restart duplicate limitation is explicit;
- removed membership or a deleted Workspace denies new starts and status
  disclosure without revealing target existence; a polling task whose gateway
  send was already accepted may finish and collect its artifact under its narrow
  task lease, but the revoked
  caller cannot poll it; terminal cleanup always releases the lease;
- polling returns bounded progress and a bounded final result without secret,
  token, host root, session root, or artifact path;
- restart loss is documented honestly; and
- disabling MCP leaves ordinary web/Workspace authority intact.

This is reference/local qualification. A named production application owns its
credential provisioning, deployment, exact package release, post-deploy smoke,
and rollback approval.

## Decisions

1. **Retain the existing managed MCP server.** It already has stock-client,
   polling, bounded artifact, abort, and redaction proof; a new server creates a
   second protocol owner.
2. **Use Workspace default, not typed domain, to select the Agent.** Decision 28
   explicitly makes `defaultAgentTypeId` durable Workspace state and reduces
   any `workspaceTypeId` to inert compatibility metadata.
3. **Use canonical AgentTask v2 for task semantics and AgentGateway for session effects.**
   MCP is an edge projection of Decision 22's shared task contract; bespoke
   delivery metadata may not become a second lifecycle. Decision 29 makes the
   gateway the sole session contract and construction funnel.
4. **Use AgentGateway, not the compatibility dispatcher, for new ingress.**
   Decision 29 makes the gateway the sole session contract and construction
   funnel.
5. **Use one private pre-provisioned binding first.** The tracer needs no login,
   chooser, token-management UI, OAuth product, or implicit Workspace creation.
6. **Separate task admission from status disclosure.** Every new start gets one
   reauthorized capability-light admission; only a new reserved task acquires
   one lease retained through terminal cleanup; every status lookup
   reauthorizes independently and receives no execution/artifact capability.
   Gateway per-use checks remain authoritative through accepted send; only then
   may the running stream and authorized artifact collection finish under the
   bounded task lease without inventing mid-turn revocation hooks.
7. **Keep retry state process-local and retention-bounded.** Same-process
   duplicate model work within retained TTL is the
   immediate defect. Restart-safe exactly-once work belongs to a durable-task
   plan, not this edge hardening.
8. **Hostname selects pixels, never authority.** Decision 30 is literal; no
   audience-by-domain, typed host resolver, or forwarded-host authorization is
   added.
9. **Keep #1011 orthogonal.** User-registered MCP servers and per-Agent grants
   are capabilities consumed by an Agent after ingress authorization, not part
   of authenticating the external caller.
10. **Keep connection, receipt, and execution ownership separate.** Choose option
    C: full-app owns request-scoped MCP transport, the delegate controller owns
    bounded process-local receipts, and each new task owns one terminally bounded
    narrow execution lease while Core retains raw gateway/scope. AgentApplication
    and Workspace own neither the connection nor the task lease.
11. **Connection loss is not revocation.** Async start survives disconnect;
    first admission freezes cancellation ownership; duplicate waiter abort cannot
    cancel shared work; bounded process shutdown aborts/fences in-flight work and
    completes exactly-once logical cleanup before gateway close.

## Flag / Abstraction

- **Needed?:** No new flag framework. Retain the existing
  `BORING_MANAGED_AGENT_MCP_ENABLED=1` plus complete-config startup gate.
- **Path:** Existing managed MCP package edge -> narrow Core-issued task
  capability (raw gateway/scope remain in Core) -> full-app adapter.
- **Rollback:** Stop admission, run bounded controller shutdown, disable managed
  MCP/remove the static binding, and restart. No Workspace data, persisted default, session schema, or web route is rolled
  back.

## Test Seams

- **Highest public seam:** unmodified `@modelcontextprotocol/sdk` `Client` +
  `StreamableHTTPClientTransport` calling the mounted full-app route.
- **Existing prior art:** package MCP controller/stock-client tests; full-app
  route tests; `smoke:mcp-managed-agent`; AgentGateway conformance and Core
  scope-authority tests.
- **Avoid testing:** MCP SDK internals, hostname parsing as authority, private
  map implementation, a second model loop, OAuth, production secrets, #1011
  connector execution, or cross-replica durability.

## Acceptance

- A stock external MCP client may use one connection for sequential or concurrent
  tasks; opening/reconnecting clients cannot bypass credential-scoped rate,
  concurrency, or global capacity. It authenticates with one pre-provisioned credential
  and invokes the strictly validated persisted default Agent in one existing
  Workspace; an unknown persisted Agent fails with no fallback or effect.
- Current app, non-deleted Workspace, membership, strict fleet/default, and
  branded Core scope are checked before a new receipt/session/model effect; each
  status disclosure separately rechecks authority without execution capability.
- MCP structured responses use canonical `AgentTask` v2 for task identity,
  principal/actor, messages, and lifecycle; inline Markdown is only a bounded
  edge delivery projection.
- MCP uses the same AgentGateway, construction funnel, strict fleet/default,
  Workspace, and execution-environment lifecycle as web; the app receives a
  non-parameterized start/status closures. Start authorization allocates no
  lease; only a new post-dedupe/post-limit record acquires the one-shot lease,
  whose narrow bound task runner + minimum artifact reader + reserved concurrency
  are released/rolled back on setup failure and exactly once on
  completed/failed/canceled/rejected. Raw scope and full AgentGateway stay inside
  Core; arbitrary Agent/list/session/close operations are not exposed.
  Core makes acquisition failure-atomic for active leases/bindings/references
  before rejecting (without changing environment cache retirement); package tests
  prove concurrency rollback for that rejection. Status receives
  disclosure identity only, never a general scope issuer, gateway, reader, or
  second resolver/composer. Gateway rechecks remain authoritative through the
  accepted send receipt; only already-accepted work may finish after revocation.
- Hostname, body, tool args, MCP session ids, JSON-RPC ids, and forwarding
  headers cannot select principal, Workspace, Agent, runtime, root, or model.
  Response-bearing JSON-RPC ids are safe integers or at most 128-byte safe ASCII
  strings; invalid ids reject before SDK tool/controller dispatch.
- Same authorized scope + idempotency key + exact trimmed-brief bytes creates
  one shared task across either start tool while retained. Each call keeps its
  response shape; first admission freezes origin cancellation policy; aborting a
  duplicate waiter never cancels shared work. Changed payload
  conflicts; different trusted scopes do not collide; dedupe precedes new-work
  limits; expiry/restart may duplicate and is documented.
- Fixed-window admission uses required bounded `maxStartsPerWindow`,
  `startWindowMs`, and `maxConcurrentPerCredential`; exact boundary/reset,
  concurrency release, retry bypass, and bounded `retryAfterMs` are tested.
- Per-credential start/concurrency and all input/progress/result/final-response
  bounds are finite and exact-boundary tested; the complete status response cap
  is `2112 * 1024` bytes by the `192 + 576 + 576 + 512 + 128 + 64 + 64 KiB`
  worst-case JSON formula; its progress term includes every emitted/retained
  notification plus bounded token/framing, and its envelope includes the bounded
  JSON-RPC id; existing caps and secret
  redaction do not weaken.
- Maximum valid completion remains retrievable by polling through a stock
  client without duplicating the full result in text content. Revocation denies
  new starts/status and any not-yet-accepted gateway effect, while a task with an
  accepted send receipt may finish and read its artifact under the bounded lease; setup failure rolls back its concurrency slot, and
  completed/failed/canceled/rejected each release lease + concurrency exactly once.
- Route stays dark by default and fails startup on incomplete/unbounded config.
- Full-app owns request-scoped stateless MCP transports; Workspace and
  AgentApplication own none. Async work survives transport loss after atomic
  controller commit even if receipt delivery is lost; synchronous-origin request
  abort cancels only its task, duplicate waiter abort does not. Application
  shutdown uses required bounded grace + late-settlement fencing, releases each
  task once, then permits the application-owned gateway to close.
- Documentation states restart loss, private credential scope, local/reference
  proof, and the #1011 opposite-direction boundary without claiming public or
  production readiness.

## Proof

- Exact command: `pnpm --filter @hachej/boring-agent test -- src/server/mcp/__tests__/managedAgentDelegate.test.ts`
- Exact command: `pnpm --filter @hachej/boring-agent typecheck`
- Exact command: `pnpm --filter @hachej/boring-core test -- src/app/server/__tests__/createCoreWorkspaceAgentServer*.test.ts src/server/__tests__/defaultAgentType.test.ts`
- Exact command: `pnpm --filter @hachej/boring-core typecheck`
- Exact command: `pnpm --filter full-app test -- src/server/__tests__/managedAgentMcp.test.ts src/server/__tests__/production-safety.test.ts`
- Exact command: `pnpm --filter full-app typecheck`
- Exact command: `pnpm --filter full-app smoke:mcp-managed-agent`
- Exact command: `pnpm lint:invariants`
- Focused lifecycle proof: one SDK client submits sequential and concurrent starts;
  two client instances sharing one credential cannot exceed its concurrency cap;
  async start survives client disconnect/reconnect; synchronous request abort
  cancels; shutdown aborts tasks, releases each lease/slot once, and only then
  closes the gateway; cross-tool same-key races preserve one task and caller-local
  cancellation; grace-expiry fences a never-settling task; restart loses receipts
  and does not claim recovery.
- Screenshot/demo: not required for this server/protocol slice; stock-client
  assertions and captured command output are stronger evidence.
- Manual steps: set the existing bearer/user/Workspace binding values plus the
  credential id and four finite lifecycle/admission values in a
  local full-app instance, connect a stock client to `/mcp/managed-agent`, call
  start/status with a stable idempotency key, then disable the route and verify
  ordinary web access remains healthy.
- Waiver if proof is not possible: production application deployment and
  restart/revocation evidence are not claimed by this repository plan; the app
  owner must create a separate deployment bead before exposing a real tenant.

## Slices

### Slice: Bounded retry-safe MCP ingress admission

**Bead:** `wt-391-forward-rjkl.3`
**Priority:** P1
**Delivers:** Explicit edge/controller/task lifetime: request-scoped stateless
MCP server transports, one process-lifetime controller, atomic async commit and
lost-receipt retry recovery, cross-tool shared-task/caller-local cancellation,
bounded shutdown grace + fencing, plus canonical
AgentTask v2 edge projection, capability-light start
authorization before dedupe, exactly one lease acquired only for a new reserved
record and released on setup failure or terminal cleanup, plus separate
status-disclosure authorization, caller-stable retention-bounded idempotency, exact
fixed-window/concurrency admission, progress byte caps, compact text projection,
and exact `2112 * 1024`-byte complete-response proof with worst-case escaping
and exact/over/type JSON-RPC id/progress-token validation, batch rejection, and
progress aggregate/coalescing before SDK dispatch.
**Blocked by:** planning bead `wt-391-forward-rjkl.1`; the orchestrator closes
that dependency only after gate-1 approval.
**File scope:** `packages/agent/src/server/mcp/managedAgentDelegate.ts`,
`managedAgentMcpServer.ts`, focused delegate test, and MCP exports only if
required.
**Proof:** focused agent MCP test, agent typecheck, invariants; exact/over,
state transitions/schema validation, zero lease acquisition on retry/conflict/
rate/concurrency/capacity rejection, reservation/acquisition failure cleanup,
task-lease lifecycle/release and status-scope separation, per-request Agent
selection, package rollback when an injected acquisition closure rejects, fulfilled-lease setup
release/rollback, completed/failed/canceled/rejected cleanup,
concurrency/retry/conflict, cross-scope, fixed-window reset, retention/expiry,
dedupe-before-limit, safe-integer/128-byte id/token success, invalid id/token and
batch pre-dispatch rejection, 64 KiB complete progress aggregate/coalescing, and
stock-client assertions.
**Review budget:** Inside — one package controller/server seam and one focused
test file; fits one worker session.

### Slice: Bind MCP ingress to current Workspace AgentGateway authority

**Bead:** `wt-391-forward-rjkl.4`
**Priority:** P1
**Delivers:** Application-owned gateway shutdown ordering after bounded
controller close, raw gateway/scope retained inside Core behind a narrow bound task
run/stop capability, and no MCP transport ownership in Workspace/AgentApplication,
plus non-parameterized Core `authorizeStart()` capability-light
admission with a one-shot lease closure and `authorizeStatus()` disclosure
closure; only the acquired lease returns bound task run/stop methods, a minimal
artifact reader, and release while raw scope/gateway stay inside Core; status
returns no execution/artifact capability; shared
unknown-default fallback drift is fixed for web and MCP; full-app reauthorizes
on start/status with no hostname authority.
**Blocked by:** `wt-391-forward-rjkl.3`.
**File scope:** Core app-server construction and strict default resolver plus
directly focused tests; full-app `managedAgentMcp.ts`, `main.ts`, `dev.ts`, managed MCP and production
safety tests. No package MCP implementation files.
**Proof:** focused Core/full-app tests, both package typechecks, invariants;
negative authorization/default/spoof tests prove no effect before authority;
pre/post-accepted-send revocation freezes the exact snapshot boundary; misuse
proof shows the package cannot list Agents/sessions, select another Agent, or
close the gateway; fault injection after each acquisition allocation proves Core rejection leaves no
active lease/task binding/reference (cached generations follow existing retire).
**Review budget:** Inside — one Core composition callback and one app edge
adapter; fits one worker session.

### Slice: Stock-client full-app ingress qualification

**Bead:** `wt-391-forward-rjkl.5`
**Priority:** P2
**Delivers:** Deterministic external SDK-client qualification and operator docs
for sequential/concurrent and cross-tool calls, reconnect, atomic async commit +
lost-receipt recovery, synchronous-origin versus duplicate-waiter cancellation,
pre/post-send revocation, bounded shutdown including never-settling work, process
restart loss, and cleanup, plus
for canonical AgentTask + strict current authority, including retained-window
retry, start/status authority-lifetime separation, terminal lease release,
revocation, bounds,
redaction, rollback, restart limitation, and direction terminology.
**Blocked by:** `wt-391-forward-rjkl.4`.
**File scope:** `apps/full-app/scripts/managed-agent-mcp-smoke.ts`, full-app
script wiring only if needed, and `apps/full-app/README.md`. No package/Core or
route implementation files.
**Proof:** `pnpm --filter full-app smoke:mcp-managed-agent`, focused full-app
test, full-app typecheck, invariants, with pasted assertion counts.
**Review budget:** Inside — one deterministic smoke and its operator contract;
fits one worker session.

The graph is intentionally linear because the final app binding consumes the
package admission contract, and qualification must run against that exact
combined contract. File scopes do not overlap across writer beads.

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Scope capability is exposed too broadly from Core | Medium | High | Boot-time narrow callback only; branded scope remains issuer-owned; focused misuse tests and fresh security review. |
| Retry key leaks or becomes caller authority | Low | High | Scope with redacted `credentialId` after authorization; bearer/JSON-RPC/MCP session ids prohibited from identity. |
| Task lease outlives revocation while status is denied | Medium | High | Snapshot begins only at accepted gateway send receipt; pre-acceptance rechecks remain authoritative; status has no reader/gateway; test both sides of boundary. |
| Connection, Workspace, AgentApplication, and task lifetimes are conflated | Medium | High | Option C is normative; request transport at app edge, receipt at controller, execution authority in one task lease; lifecycle/disconnect/restart tests. |
| Multiple client connections bypass concurrency | Medium | High | Key rate/concurrency by trusted credentialId after authorization, never connection/session/JSON-RPC identity; prove parallel multi-client admission. |
| Full gateway capability crosses into MCP package | Low | High | Core returns only bound task run/stop + reader + release; compile/runtime misuse proof excludes list/arbitrary-Agent/session/close. |
| Lost async receipt or cross-tool abort changes task ownership | Medium | High | Atomic controller commit before response attempt; idempotent receipt recovery; first-admission origin policy; duplicate waiter abort is local. |
| Abort-insensitive task hangs shutdown | Medium | High | Required 100..300,000 ms grace, late-settlement fencing, exactly-once logical release, never-settling test before gateway close. |
| Final response cap rejects a maximum valid artifact | Medium | Medium | Derive envelope from retained component budgets and prove exact maximum through a stock client. |
| Private reference route is mistaken for public/production auth | Medium | High | Dark default, static binding, explicit docs/non-goals, and separate app-owned deployment gate. |
| #1011 direction is conflated with ingress | Medium | Medium | Separate flow diagrams, credentials, file scopes, acceptance, and no dependency on connector registration/grants. |

## Out of Scope

- Typed Workspace domains, `workspaceTypeId` authorization, hostname audience,
  product routing, or hostname-selected Agent behavior.
- Public OAuth/self-service credentials, token UI/database, dynamic credential
  registration, login, Workspace chooser, or implicit Workspace creation.
- Durable tasks, restart/cross-replica exactly-once admission, replay across
  process loss, external A2A, or multi-turn `input-required` projection.
- User-registered external MCP servers, `mcpServerRefs`, per-Agent grant UX,
  connector credential custody, write-tool approval, or any #1011
  implementation.
- New MCP server package, per-Agent endpoint, caller-selected Agent, second
  AgentGateway/model loop/runtime owner, or AgentHost deployment/controller
  machinery.
- New artifact types, cross-Workspace projection, raw environment/filesystem
  exposure, production deployment, package publication, or Seneca-specific
  domain/product wiring.

## Open Questions

- **None for gate 1.** The owner's connection-ownership question exposes a
  technical lifetime boundary, not unresolved product intent. Decisions 22/28/29/30
  and current stateless Streamable HTTP implementation support option C. A
  production application must separately answer credential custody, release,
  deployment values, monitoring, and rollback before enabling the route for a
  real tenant.

## References

- GitHub #1129 — external clients consume a boring-ui Workspace.
- `docs/DECISIONS.md` Decisions 22, 28, 29, and 30.
- `docs/issues/806/plan.md` — historical typed-domain plan; protocol research
  retained, authority target superseded.
- GitHub #1011 and `docs/issues/1011/plan.md` if present — opposite
  Workspace-Agent-to-external-server direction.
- `packages/agent/docs/AGENT_GATEWAY_V0.md` — current gateway contract.
- Current ingress code/tests listed in Today and the three slice file scopes.

## Adversarial Review

- **Reviewer:** `openai-codex:gpt-5.6-sol` (fresh-context `reviewer`).
- **Mandate:** refute plan/graph against Decisions 22/28/29/30, current ingress
  code, #1011 direction, authority safety, executable slices, dependencies, and
  proof; read-only, never rewrite.
- **Target:** commit `3f7f740a6010ffb046b28576b5b1b92898c06945`.
- **Verdict:** revise.
- **Disposition:** fixed the gate dependency, strict unknown-default failure,
  package request-time Agent resolver, operation-scoped artifact reader,
  non-parameterized Core binding closure, retention-bounded idempotency,
  Decision 22 AgentTask projection, exact fixed-window contract, and whitespace.
  Second-pass verification targeted the resulting commit.
- **Pass 2 target:** commit `7638775f51c4f8bff1ac328be7b8a0b7a2abe40e`.
- **Pass 2 verdict:** revise.
- **Pass 2 findings/disposition:** made `.3` self-contained with the exact key
  grammar/byte limit, fixed-window reset, and `retryAfterMs`; corrected the HTML
  to state no unexpired-record eviction/capacity rejection and the exact package
  files; added the strict default resolver test to canonical/HTML proof.
- **Pass 3 target:** commit `0c56c8c938c48965f6ffc8376834a0669c40eff8`.
- **Pass 3 verdict:** revise.
- **Pass 3 findings/disposition:** resolved asynchronous authority lifetime with
  task-scoped `admitStart()` leases retained through terminal artifact/result
  collection plus separately reauthorized capability-free status disclosure;
  added `.1` Acceptance Criteria for lint; reordered/capped the gate HTML.
- **Pass 4 target:** commit `0ccb556ef713462ac27ddf348e24d5e38f432d74`.
- **Pass 4 verdict:** revise.
- **Pass 4 findings/disposition:** lease acquisition occurred too early and the HTML still implied
  status-to-gateway capability/section drift. Start authorization is now
  capability-light; a one-shot lease is acquired only after dedupe/limits and a
  new record reservation, with all non-admission/setup release paths explicit.
  Today/Delta and direction evidence are integrated into the mandated sections.
- **Pass 5 target:** commit `8e683c0c5b6b3cb704b687031049117d002cc1eb`.
- **Pass 5 verdict:** revise.
- **Pass 5 findings/disposition:** missing concurrency rollback on setup failure, omitted rejected
  cleanup, an unfrozen final wire cap, and a non-Bead gate node in the graph.
  Those are fixed with exactly-once slot/lease cleanup for every path, a
  `2112 * 1024` byte worst-case serialized cap, and the exact live
  `.1 -> .3 -> .4 -> .5` Bead graph.
- **Pass 6 target:** commit `cb9f3a6622eba4ff93ecc86ecdef4e1a96ddbf3f`.
- **Pass 6 verdict:** revise.
- **Pass 6 findings/disposition:** acquisition rejection could hide a partial
  resource before a lease handle existed. `acquireTaskLease()` is now explicitly
  failure-atomic for active lease/binding/reference cleanup inside Core, with
  fault-injection proof after each allocation; cached generations keep canonical
  retire semantics;
  package concurrency rollback remains required, and fulfilled-lease setup
  failure calls `release()`.
- **Pass 7 target:** commit `9547efa041e937f50201de33799e132c8dfc8614`.
- **Pass 7 verdict:** revise.
- **Pass 7 findings/disposition:** narrowed failure atomicity to no active
  lease/binding/reference (cached environment generations retain existing retire
  semantics) and replaced the impossible 480 KiB cap with the exact 2112 KiB
  worst-case JSON budget. The existing oversize-result assertion remains and
  now rejects its title via a stricter 4 KiB cap.
- **Pass 8 target:** commit `1bfeba1bf591e49b1c3f66154896b31dad907ae1`.
- **Pass 8 verdict:** revise.
- **Pass 8 findings/disposition:** bounded every echoed response-bearing JSON-RPC
  id before MCP SDK dispatch (safe integer or <=128-byte safe ASCII string) so
  the 64 KiB envelope term is exhaustive; removed stale eager-disposal wording
  from the active contract and `.3`.
- **Pass 9 target:** commit `55f232f44585cd122cc4ef453970c1542561448f`.
- **Pass 9 verdict:** revise.
- **Pass 9 findings/disposition:** reject all JSON-RPC batch arrays before SDK
  dispatch; bound progress tokens like request ids; make the 64 KiB progress term
  cover every emitted and retained notification including token/JSON/SSE framing,
  with one coalesced terminal marker and no emissions after exhaustion. A clean
  final pass is required.
- **Pass 10 target:** commit `1065f3400716fdf56b33046584475374cd637cad`.
- **Pass 10 verdict:** clean.
- **Pass 10 result:** no blockers; scoped lint and both graph checks clean.
  Residual risk is implementation-only proof and the one-session estimate for
  dense slice `.3`.
- **R2 ownership/lifetime pass 1 target:** commit
  `b7cfe9faafb5f9331f5fb499f4bf9d69e20e17f8`.
- **R2 pass 1 reviewer/mandate:** fresh-context
  `openai-codex:gpt-5.6-sol`; read-only adversarial refutation of revised
  canonical plan, new r2 HTML, current SDK/server, Decisions 22/28/29/30,
  AgentGateway contract, and live `.1/.3/.4/.5` graph. Explicitly challenged
  options A/B/C, six lifetime terms, lifecycle/concurrency, proof, rollback, and
  child contracts.
- **R2 pass 1 verdict:** revise.
- **R2 pass 1 findings/disposition:** (1) raw scope/full gateway made the lease
  too broad — Core now retains both and exposes only Agent-bound run/stop,
  minimal reader, and release; (2) admission snapshot conflicted with gateway
  rechecks — snapshot now starts only at accepted send; (3) async disconnect had
  no observable commit — lease attachment + stored receipt atomically commit
  before response attempt and idempotent retry recovers lost delivery; (4)
  cross-tool retry/cancel was undefined — one shared task, caller-specific
  response, first-origin cancellation, duplicate waiter abort local; (5) `.3`
  claimed Core proof — package rejection rollback remains `.3`, Core failure
  atomicity remains `.4`; (6) shutdown could hang — required 100..300,000 ms
  grace, late-settlement fencing, exactly-once logical release, then gateway
  close; (7) r2 review label/SHA provenance corrected. Final exact-SHA pass is
  required.
- **R2 ownership/lifetime pass 2 target:** commit
  `802f82b347c64b16ee2340cbc72078e5c8712e77`; fresh-context
  `openai-codex:gpt-5.6-sol`; same read-only adversarial mandate; verdict revise.
- **R2 pass 2 findings/disposition:** the r2 architecture diagram now gives
  `authorizeStart()` and `authorizeStatus()` distinct return arrows, so the
  start admission/one-shot narrow lease closure is not mislabeled as
  disclosure-only. The HTML no longer claims its own immutable target can
  contain an external final verdict; final exact-SHA attestation belongs on the
  bead after review. All pass-1 material fixes were otherwise verified clean.
