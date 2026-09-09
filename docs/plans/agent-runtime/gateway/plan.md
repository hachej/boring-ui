---
github: https://github.com/hachej/boring-ui/issues/909
issue: 909
state: ready-for-human
updated: 2026-07-23
track: owner
parent: 905
---

# gh-909 AgentGateway v0 — the definitive gateway plan

> **Kind: historical record.** This plan executed and closed. It governs
> nothing today.
> - **Sequencing** is owned by [`docs/direction/DIRECTION.md`](../../../direction/DIRECTION.md).
> - **The gateway contract** is owned by
>   [`packages/agent/docs/AGENT_GATEWAY_V0.md`](../../../../packages/agent/docs/AGENT_GATEWAY_V0.md),
>   colocated with its types. **§6 below drifted from the shipped code** (input
>   DTOs nest `scope` rather than inheriting it, among other differences) and is
>   retained only as the pre-implementation record. Do not build from §6.
> - **Architecture rulings** are owned by [`docs/DECISIONS.md`](../../../DECISIONS.md)
>   (Decision 29 records what this plan shipped).

One frozen contract (`AgentGateway`), one canonical construction path
(`createAgentHost()`), all consumers aligned onto both. This is the grunt-work
spine extracted from #905: after it lands, every remaining concern — durable
streaming, remote hosts, pushed third-party agents, catalog revival, #861 —
becomes an independent lane behind the contract. #905 remains architecture
authority; this plan executes its v0 and changes no ratified ownership.

---

## 1. What this means for the product

Today "an agent" is not a thing in this codebase — it is a side effect of how
three different apps wire packages together. After this plan, **an agent is an
addressable product entity**: authored as data, listed in a catalog, sessioned,
orchestrated, and (later) deployed — while the machinery that runs it stays
invisible.

The product ladder this unlocks, in delivery order:

| Stage | Product capability | Enabled by |
| --- | --- | --- |
| **v0 (this plan)** | The workspace becomes a real console: N agents in one deployment, listed/orchestrated/sessioned through one contract. Multi-agent workflows (delegation) become product features, not wiring. | `AgentGateway` + `createAgentHost` |
| **v0 lanes** | Restart-safe streaming (no truncated turns, offset reconnect); authored versioned agent definitions in the catalog | streaming lane, catalog lane |
| **v2** | Agents run on separate Seneca-managed hosts; the workspace console controls a fleet it doesn't run in-process — the "Vercel console for agents" | `RemoteAgentGateway` + pool (per #905) |
| **v2+** | Third parties build an agent and push it as **their own host artifact**; it appears in customers' workspace consoles like any other agent | protocol-as-product (eve-validated) |
| **later** | Marketplace density tier: many light custom agents per shared host, author code quarantined in sandboxes/iframes | reserved rung (§9) |

**Trust ladder (owner-supplied eve context, 2026-07-22; not repository proof).**
The supplied vercel/eve comparison supports the top tier:
eve trusts author tool code because every agent is its own deployment; only
model-generated code is sandboxed (per-session microVM; credentials injected at
the sandbox network firewall, never inside). Our tiers:

1. **Spec-only customization** — instructions/selections/config: inert data,
   shared host, ~free. Most custom agents forever.
2. **Own pushed host** (= eve's model exactly): author code trusted inside the
   author's own artifact; ships first among custom-code tiers (v2).
3. **Shared host + sandbox-executed author tools** — our extension beyond eve;
   a density/economics play, reserved until marketplace demand (§9).

**Third-party consumption topology (owner-ratified) — FUTURE WAVE, NOT SHIPPED.**
The tiers below are target architecture owned by **#905** (DIRECTION Wave 4),
not part of v0. `AgentHostProtocol` appears in no source file today; hosts
currently split only into embedded (in-process) with remote/external deferred.
Recorded here for provenance; #905 is where it is planned.
 "Own host" means the
agent's own *compute plane*, never the user's console:

```txt
user browser ──► Seneca control plane (Core auth + Workspace console)
                    │  holds ONE AgentGateway (pool)
                    ├─ AgentHostProtocol ─► managed shared Host   (first-party agents)
                    ├─ AgentHostProtocol ─► dedicated Host        (customer tier)
                    └─ AgentHostProtocol ─► pushed Host           (third-party author)
```

An agent's host is a headless protocol server: harness, tools, sessions. It
never serves product UI, never sees the user's browser, never joins the
console's trust domain. The workspace remains the single place users list,
control, and orchestrate agents — whichever host answers behind the gateway.

---

## 2. Owner decisions ratified in this plan (2026-07-22)

1. v0 = embedded multi-agent in one process; distinct remote Host = v2.
2. Interface first: freeze the contract, facade today's internals, migrate
   consumers; internals cleanup runs behind it asynchronously.
3. The three divergent construction paths are standardized behind
   `createAgentHost()` in this issue.
4. Durable streaming is the first follow-up lane (activate the dormant
   `SqliteEventStreamStore`); tracer precedes hardening in v2.
5. Third-party agents = pushed host artifacts consumed via the central
   workspace; first-party agents get the revived definition machinery as
   catalog format.
6. Agent-first principle: placement-independent agent identity; isolation
   cardinality is deployment policy; hosts invisible in product surfaces.
7. Agent spec = identity + policy data; host = mechanism + custody. Plugin
   *capability/config* is agent-level; plugin *code* is host-loaded.
8. Naming: types `AgentHost`/`AgentGateway`; members `host`/`gateway`/
   `registerRoutes`; no reuse of `Agent` or `registerAgentRoutes` names.

## 3. Verified current state (code verification 2026-07-22)

- **No consumer-facing interface exists; consumers construct.** Three paths:
  `packages/workspace/src/app/server/createWorkspaceAgentServer.ts` (~1027
  lines; imports `createAgentApp`, `provisionWorkspaceRuntime`, picks sandbox
  providers, builds mode adapter via `./sandboxRuntimeHost`);
  `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts` (~1139
  lines; the production path; hand-assembles `registerAgentRoutes` + plugins +
  auth + adapters, never calls `createAgentApp`);
  `packages/cli/src/server/modeApps.ts` (~1041 lines; imports both packages,
  takes Workspace's `createSandboxRuntimeModeAdapter` to feed Agent
  provisioning).
- **Two duplicated constructors inside the agent package**:
  `createAgentApp.ts` (~478 lines) and `registerAgentRoutes.ts` (~1474 lines)
  independently build harness + bridge + tools; neither calls the other.
- **Reverse dependency**: `apps/agent-playground/src/server/index.ts` imports
  runtime adapters from `@hachej/boring-workspace/app/server`.
- **Promised seam is dead**: `createWorkspaceAgentApp()` (named in
  `packages/agent/src/server/createAgentApp.ts:272-276`) exists nowhere.
- **Four consumer surfaces today** (see §5 fate table): construction (above);
  `Agent.send/stream` facade + `AgentLiveEventBuffer`
  (`core/createAgent.ts`, callers: `workspaceAgentDispatcher.ts`,
  `mcp/managedAgentDelegate.ts`); `HarnessPiChatService` (chat HTTP routes);
  `PiSessionStore` (session CRUD, local JSONL under
  `BORING_AGENT_SESSION_ROOT`).
- **Streaming**: browser transport is NDJSON over chunked HTTP
  (`packages/agent/src/server/http/routes/piChat.ts:184-264`) against the
  in-memory `PiChatReplayBuffer`
  (~1000-event ring). After restart/eviction the client receives 409
  `replay_gap`/`cursor_ahead` and rehydrates full state from Pi JSONL. The
  transactional idempotent `SqliteEventStreamStore`
  (`server/events/eventStreamStore.ts` + `sqlStorage.ts`) is fully built and
  tested with **zero** production wiring (`eventStore` option never passed).
- **Authored-definition machinery is dead code**: `materializeAgentDirectory`,
  `resolveAgentDeployment`, digest/deployment binding — zero callers outside
  their own tests. Schema (`agent-definition.ts`) rejects behavior-selecting
  fields by design ("cannot select behavior; configure trusted host plugins
  instead").
- **Plugins are local-filesystem code loading**: `BoringPluginAssetManager`
  (`packages/workspace/src/server/agentPlugins/manager.ts`) scans caller
  dirs, realpath/mtime signatures, absolute `frontPath`/`serverPath`;
  CLI `pluginFrontRuntime.ts` (~2230 lines) serves plugin fronts off local
  disk with plugin-local `node_modules`.
- **Naming pressure, not a proven env rename**: Core only checks presence of
  legacy `BORING_AGENT_HOST_ID` as a trusted-proxy safety sentinel
  (`packages/core/src/server/config/loadConfig.ts:106-125`); #909 must inventory
  actual consumers before changing it.
- **Agent package dependency direction is already clean** (no deps on
  workspace/core), so contract and factory can live there without new edges.

### Source-citation audit

Every explicit source range and approximate line count in the pre-review plan
was checked against this worktree. Numerically stale citations: **none**.
Substantively stale/ambiguous citations and corrections:

| Prior claim | Finding | Corrected evidence/disposition |
| --- | --- | --- |
| `piChat.ts:184-264` | ambiguous path; range proves NDJSON transport but not buffer capacity/replay behavior alone | `packages/agent/src/server/http/routes/piChat.ts:184-264` plus `packages/agent/src/server/pi-chat/piChatReplayBuffer.ts:29-90` |
| target `/stream`, generic `/send`, legacy PATCH rename | wrong relative to production wire | replaced by exhaustive §6.11 from `packages/agent/src/server/http/routes/piChat.ts:32-75,110-426`; actual paths are `/events`, `/prompt`, `/followup`, `/queue/clear`; no legacy PATCH |
| `loadConfig.ts:117-123` defines an Agent Host identity | semantic overclaim | `packages/core/src/server/config/loadConfig.ts:106-125` only proves a legacy env-presence/trusted-proxy sentinel; AH0 inventories before any rename |

Verified exact counts/ranges retained: workspace constructor 1027 lines; Core
1139; CLI `modeApps.ts` 1041; `createAgentApp.ts` 478;
`registerAgentRoutes.ts` 1474; CLI `pluginFrontRuntime.ts` 2229; dead promised
seam at `packages/agent/src/server/createAgentApp.ts:272-276`. Additional
grounding: request-scope key
`packages/agent/src/server/registerAgentRoutes.ts:516-558`; Core production
composition `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts:840-1135`;
status/payload/receipt schemas
`packages/agent/src/shared/chat/piChatSchemas.ts:118,223-275` and
`packages/agent/src/shared/chat/piChatCommand.ts:20-38`; session rows
`packages/agent/src/shared/session.ts:19-25`.

## 4. Agent-first principle (every lane preserves)

1. **Placement-independent identity.** In v0, `agentTypeId` is a trusted
   deployment binding name, never a Host slot. The catalog follow-up binds it
   to a content-addressed authored definition and then populates
   `AgentSummary.definition`.
2. **Isolation cardinality is deployment policy.** N:1 shared and 1:1
   dedicated run the same spec through the same gateway. v0 must not preclude
   1:1: per-agent session namespaces, no cross-agent state in specs, no
   host-scoped identity in DTOs. Explicit limit: v0 shared-host isolation is
   logical only (one process, one key custody) — never presented as security
   isolation. Drivers, per agent: **N:1** for v0 embedding, density, and
   shared-environment collaboration (cross-host delegation needs a qualified
   shared placement per #905); **1:1** for trust (pushed/dedicated), blast
   radius, and independent rollout/versioning. The workspace always holds
   exactly one gateway; in v2 the pool behind it maps `agentTypeId` → host,
   so several hosts may serve one workspace without the workspace routing.
   Inside a shared v0 Host, this does **not** mean one global runtime per Agent
   type: bindings are lazy and keyed by `(agentTypeId, workspaceScopeId,
   runtimeScopeKey)`. The runtime scope key includes every value that can vary
   roots, Pi config, session namespace, tools/policy, or prompt contribution;
   it includes `authSubjectId` whenever any of those are actor-dependent. This
   preserves the existing request-scoped key at
   `packages/agent/src/server/registerAgentRoutes.ts:516-558` and prevents one
   Workspace/actor from reusing another's tools, files, or transcript binding.
   That Agent-binding cardinality does not duplicate the Workspace Environment:
   a separate `(workspaceScopeId, environment.placementIdentity)` lease supplies
   one canonical provider to every compatible Agent as specified in §6.10.
3. **Product surfaces never show hosts.** Hosts appear only in operator
   diagnostics.

## 5. Surface consolidation (4 → 2)

| Today | Consumers | Fate |
| --- | --- | --- |
| `createAgentApp` + `registerAgentRoutes` | workspace, core, CLI, playgrounds | → **`createAgentHost()`** (build); old exports become delegating compat wrappers |
| `Agent.send/stream` + `AgentLiveEventBuffer` | dispatcher, managed delegate | → **`AgentGateway`** (talk); facade + duplicate buffer deleted after MIG-DEL |
| `HarnessPiChatService` | chat HTTP routes | internal engine behind the gateway (streaming lane may gut it freely) |
| `PiSessionStore` | session CRUD | internal storage behind the gateway |

End state: **build (`createAgentHost`) + talk (`AgentGateway`)**; engine and
storage are internals.

---

## 6. Exact specs (v0)

> **Superseded as a build target.** Written before implementation; the shipped
> types diverge. Build against
> [`packages/agent/docs/AGENT_GATEWAY_V0.md`](../../../../packages/agent/docs/AGENT_GATEWAY_V0.md)
> and `packages/agent/src/shared/gateway/`. Retained for provenance.

Public Gateway types live in `packages/agent/src/shared/gateway/` (no `node:*`,
`Buffer`, Fastify, Pi SDK, or React imports). Server-only Host construction and
HTTP projection types live in `packages/agent/src/server/agent-host/`.
Transport DTOs are structurally
serializable; a lint/type test rejects functions, class instances, `Date`, and
cycles. `AuthorizedAgentScope` is the one deliberate non-DTO: an app-issued,
host-neutral branded capability required by #905. It is never reconstructed
from browser JSON and a later remote Gateway converts it to a Host grant only
after routing.

### 6.1 Identity and scope

```ts
/** App-minted opaque ID for the complete current authorization partition.
    v0 canonical mapping is (workspaceId, storageScope), never workspaceId alone. */
type WorkspaceScopeId = string
type AuthSubjectId = string
type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue }
type JsonSafe<T> = T extends JsonPrimitive
  ? T
  : T extends readonly (infer U)[]
    ? readonly JsonSafe<U>[]
    : T extends object
      ? { readonly [K in keyof T]: unknown extends T[K] ? JsonValue : JsonSafe<T[K]> }
      : JsonValue

/** Verified identity facts returned only by the app-owned verifier. */
interface VerifiedAgentScopeClaim {
  readonly workspaceScopeId: WorkspaceScopeId
  readonly authSubjectId: AuthSubjectId
}

declare const authorizedAgentScope: unique symbol
interface AuthorizedAgentScope {
  readonly workspaceScopeId: WorkspaceScopeId
  readonly authSubjectId: AuthSubjectId
  readonly [authorizedAgentScope]: true
}

interface AgentScopeVerifier {
  verify(scope: AuthorizedAgentScope): Promise<VerifiedAgentScopeClaim>
}
// Core/app owns a non-exported issuer that derives both fields from authenticated
// membership and mints a frozen runtime capability. The Host receives only its
// verifier. Every verification performs a current membership/expiry/revocation
// lookup as well as object identity/provenance checking (for example an
// issuer-owned WeakSet), not merely a TypeScript symbol property. Plain casts,
// spread copies, JSON round-trips, and capabilities from another issuer fail.
// CLI mints one fixed trusted-local subject. Connect binds the verified scope;
// every send/control/queue-clear re-verifies it so membership revocation takes
// effect without allowing an already-open connection to retain stale authority.
// Sessions remain authorized by stored Workspace/storage scope; authSubjectId is
// trusted attribution and a runtime-key input only, not per-user session ownership.

interface AgentSessionRef {
  readonly agentTypeId: string
  readonly sessionId: string        // native Pi session id — no wrapper ids
  // hostId: reserved v2 field; MUST NOT be added by any v0 lane
}
```

### 6.2 Catalog

```ts
interface AgentSummary {
  readonly agentTypeId: string
  readonly label: string
  readonly description?: string
  /** Populated by the catalog lane; optional in v0. */
  readonly definition?: { readonly version: string; readonly digest: string }
}
```

### 6.3 Sessions

```ts
interface AuthorizedAgentSessionQuery extends AuthorizedAgentScope {
  readonly agentTypeId?: string      // omit = all agents
  readonly cursor?: string           // opaque
  readonly limit?: number            // server-clamped
}

interface AgentSessionSummary {
  readonly ref: AgentSessionRef
  readonly title: string
  readonly status: 'idle' | 'running' | 'aborting' | 'error'
  readonly createdAt: number
  readonly updatedAt: number
}

interface AgentSessionPage {
  readonly sessions: readonly AgentSessionSummary[]
  readonly nextCursor?: string
}
// Total order: updatedAt DESC, agentTypeId ASC, sessionId ASC.
// (hostId joins the tuple in v2 per #905; unchanged consumer semantics.)
// v0 cursor semantics (owner descope 2026-07-23): the opaque cursor is a
// keyset token over that exact tuple, integrity-bound to the verified
// workspaceScopeId plus normalized agentTypeId/filter/limit policy.
// Continuation re-verifies the binding; tampered, cross-scope, or
// cross-filter reuse fails `AGENT_SESSION_CURSOR_INVALID` without leaking
// rows. Keyset traversal is documented best-effort under mutation: a row
// updated after page 1 may move relative to the traversal and a deleted row
// disappears — the same guarantee class as today's offset list. The durable
// immutable snapshot-registry projection (mutation-stable pages, cursor TTL,
// `AGENT_SESSION_CURSOR_EXPIRED`) is REQUIRED for the v2 pool merge cursor
// (#905) and MAY be adopted early by the streaming lane; it is not a v0 gate.

interface CreateAgentSessionInput extends AuthorizedAgentScope {
  readonly agentTypeId: string
  readonly requestId: string         // caller-generated idempotency key
  readonly title?: string
}
// For as long as its ledger record is retained, the same requestId yields the
// same AgentSessionRef and never a second transcript. Production Level B uses
// the durable transactional request ledger, so completed create receipts
// survive Host restart. Request-ledger durability is independent of Level D's
// durable event offsets; a bounded eviction policy is a separate retention
// contract and is not implied by the B/D replay level.

interface RenameAgentSessionInput extends AuthorizedAgentScope {
  readonly ref: AgentSessionRef
  readonly requestId: string
  readonly title: string
}
interface DeleteAgentSessionInput extends AuthorizedAgentScope {
  readonly ref: AgentSessionRef
  readonly requestId: string
}
```

`AgentSessionSummary.status` is a Host-maintained, no-boot activity index.
`running` covers the live turn; it is not the browser's optimistic state. The
full `PiChatSnapshot.status` in §6.5 remains the existing serializable wire
`idle | hydrating | submitted | streaming | aborting | error` union unchanged.
`hydrating`/`submitted` remain valid Pi snapshot wire states but are coarsened
out of durable list activity. AH0 adds the event-driven index because today's
`SessionSummary` (`packages/agent/src/shared/session.ts:19-25`) has no status.
v0 (owner descope 2026-07-23): the activity index is derived in-process — a
session is `running`/`aborting` iff its live channel currently owns a turn, so
a restarted Host trivially reports no phantom writers (no live channels exist)
and list status reboots from transcript-tail evidence with no
crash-transition machinery. The durable checkpointed activity index with
startup reconciliation (unreconciled `running`/`aborting` → `error` before
serving) becomes REQUIRED when the streaming lane makes status survive
restarts (Level D); its recovery metadata stays in the internal
activity/checkpoint record, never in `AgentSessionSummary`.

Rename is new to the addressed Gateway, not a legacy route. AH0 introduces a
focused `RenamableSessionRepository` capability rather than widening the base
session store. Its idempotent `rename(ctx, sessionId, title)` resolves the
wrapper and any linked native Pi JSONL, appends the rename through the
existing session-store append path to every resolved transcript under the one
session writer lock, then updates the metadata/list index; the newest durable
`session_info` across targets is title authority under a deterministic total
order — entry timestamp, ties broken native-over-wrapper, then byte offset —
so Boring and native Pi views converge even when an old wrapper title
conflicts with a newer linked-native title. Convergence is guaranteed no
later than the next explicit rename; loads perform no repair writes. v0 (owner descope 2026-07-23): a title is display
metadata, not data integrity — a crash mid-rename may leave one view stale
until the next rename/load converges on newest-wins; no cross-process rename
journal, lock-file protocol, or per-boundary death-injection matrix is
required, and concurrent standalone-Pi appends are tolerated exactly as they
are for every other `session_info` append today. No legacy PATCH alias is
added.

### 6.4 Connection, events, commands

```ts
interface ConnectAgentSessionInput extends AuthorizedAgentScope {
  readonly ref: AgentSessionRef
  readonly cursor?: number           // resume seq; omit = from live edge
}

interface AgentSessionEvent {
  readonly ref: AgentSessionRef
  readonly seq: number               // monotonic per session
  readonly event: JsonSafe<PiChatEvent>
}
// 391 decision 1 holds: PiChatEvent stays the payload; the envelope adds
// ref + seq. JsonSafe maps unknown leaves to JsonValue without a parallel event
// union. v0 (owner descope 2026-07-23): enforcement is the type plus the
// existing JSON serialization boundary (a cycle already throws at NDJSON
// framing); the recursive runtime validator for depth/size limits and
// workspace-relative (never host-root) attachment/file paths is REQUIRED at
// the v2 remote wire ingress/egress, where untrusted transport begins.
// Invariant: envelope seq === event.seq. That single value is the replay cursor,
// snapshot watermark, durable-offset mapping, and legacy unwrapped event seq.

interface AgentSessionConnection {
  readonly ref: AgentSessionRef
  readonly events: AsyncIterable<AgentSessionEvent>
  send(input: IdempotentAgentSend): Promise<AgentSendReceipt>
  interrupt(input: IdempotentAgentControl): Promise<CommandReceipt>
  stop(input: IdempotentAgentControl): Promise<StopReceipt>
  clearQueue(input: IdempotentQueueClear): Promise<QueueClearReceipt>
  close(): Promise<void>             // unsubscribe only, never implicit stop
}

interface AgentPromptCommand {
  readonly kind: 'prompt'
  readonly requestId: string
  readonly clientNonce: string
  readonly content: string
  readonly displayContent?: string
  readonly model?: ChatModelSelection
  readonly thinkingLevel?: ThinkingLevel
  readonly attachments?: readonly ChatAttachmentPayload[]
}
interface AgentFollowUpCommand {
  readonly kind: 'followup'
  readonly requestId: string
  readonly clientNonce: string
  readonly content: string
  readonly displayContent?: string
  readonly clientSeq: number
}
type IdempotentAgentSend = AgentPromptCommand | AgentFollowUpCommand
interface IdempotentAgentControl {
  readonly requestId: string
}
interface IdempotentQueueClear extends IdempotentAgentControl {
  readonly clientNonce?: string
  readonly clientSeq?: number
}
interface CommandReceipt { readonly accepted: true; readonly cursor: number }
interface AgentSendReceipt extends CommandReceipt {
  readonly disposition: 'prompt' | 'followup'
  readonly clientNonce: string // echoes the original clientNonce
  readonly duplicate?: boolean
  readonly clientSeq?: number
}
interface QueueClearReceipt extends CommandReceipt { readonly cleared: number }
interface StopReceipt extends CommandReceipt {
  readonly stopped: boolean
  readonly clearedQueue: readonly QueuedUserMessage[]
}
```

`connectSession` binds its verified scope and ref immutably; command payloads
cannot substitute either. `send` is discriminated so callers explicitly choose
an initial prompt or a one-at-a-time queued follow-up. Prompt-only fields cannot
silently enter a follow-up. `interrupt` aborts the active turn but preserves the
queue, so the next follow-up may immediately run; `stop` aborts and clears the
queue; `clearQueue` clears all or the selected nonce/sequence without changing
the active turn. These are the current semantics evidenced by
`packages/agent/src/shared/chat/piChatSchemas.ts:118,223-275`,
`packages/agent/src/server/http/routes/piChat.ts:266-334`, and
`packages/agent/src/front/chat/pi/remotePiSession.ts:215-263`.
When both queue selectors are present, canonical addressed calls require both
to identify the same item; mismatch conflicts. The legacy alias preserves
current nonce precedence
(`packages/agent/src/server/harness/pi-coding-agent/piFollowUpQueueCompat.ts:205-211`).

| Host activity | prompt | follow-up | interrupt | stop | clear queue |
| --- | --- | --- | --- | --- | --- |
| `idle` | allowed | allowed/queued | accepted no-op | accepted/clear | allowed |
| `running` | invalid | allowed | abort then promote next queued item | abort + clear | allowed |
| `aborting` | invalid | allowed/queued | accepted/no duplicate effect | accepted/clear | allowed |
| `error` | allowed (new turn) | allowed/queued | accepted no-op | accepted/clear | allowed |

Legacy prompt maps `requestId = clientNonce`. Legacy follow-up preserves the
original nonce and sequence and maps `requestId` to the reversible tuple
`(clientNonce, clientSeq)`; responses always project the original nonce/seq,
never the composite key.

### 6.5 State snapshot (the Level-B recovery contract)

```ts
interface ReadAgentSessionStateInput extends AuthorizedAgentScope {
  readonly ref: AgentSessionRef
}
interface AgentSessionStateSnapshot {
  readonly ref: AgentSessionRef
  readonly seq: number               // snapshot is consistent as of this seq
  readonly summary: AgentSessionSummary
  readonly state: PiChatSnapshot     // current serializable server-wire shape
}
```

### 6.6 The gateway

```ts
interface AgentGateway {
  listAgents(input: AuthorizedAgentScope): Promise<readonly AgentSummary[]>
  listSessions(input: AuthorizedAgentSessionQuery): Promise<AgentSessionPage>
  createSession(input: CreateAgentSessionInput): Promise<AgentSessionRef>
  connectSession(input: ConnectAgentSessionInput): Promise<AgentSessionConnection>
  readSessionState(input: ReadAgentSessionStateInput): Promise<AgentSessionStateSnapshot>
  renameSession(input: RenameAgentSessionInput): Promise<AgentSessionSummary>
  deleteSession(input: DeleteAgentSessionInput): Promise<void>
  close(): Promise<void>
}
```

No `files`, `pluginAssets`, or egress surfaces in v0 — they cross the gateway
only in v2 (#905). Workspace keeps its current in-process file routes.

> **OWNER ATTENTION — decisive v0/v2 correction.** The v0 semantic core above
> is frozen, but the complete v2 interface cannot be literally identical: #905
> adds stable Host routing to refs plus `describe`, files, plugin assets, and
> egress. v2 must be a versioned additive extension that implements this v0
> core unchanged. H0/A0 must amend #905's “identical contract” wording before
> remote dispatch. v0 deliberately does not leak `hostId`; the future pool owns
> that routing extension. The amendment also defines v2 terminal/needs-input
> status as an additive `AgentSessionSummaryV2` projection over v0 activity
> (`idle/running/aborting/error`) and preserves snapshot-token pagination. No §2
> ownership decision changes.

### 6.7 Stable errors

Every rejection is an `AgentGatewayError { code, message, details? }` with a
stable code:

| Code | Meaning |
| --- | --- |
| `AGENT_TYPE_UNKNOWN` | `agentTypeId` not in this gateway's catalog |
| `AGENT_SESSION_NOT_FOUND` | ref unknown **or** scope mismatch (fail closed; indistinguishable by design) |
| `AGENT_SCOPE_DENIED` | caller's workspace/subject scope failed authorization |
| `AGENT_ENTITLEMENT_REQUIRED` | access requires a subscription or entitlement the caller does not have |
| `AGENT_ACCESS_FORBIDDEN` | the authoritative access policy denied this caller and Agent |
| `AGENT_ACCESS_POLICY_UNAVAILABLE` | the authoritative access policy could not make a decision; retry according to details |
| `AGENT_SESSION_REPLAY_GAP` | requested cursor evicted; recover via `readSessionState` then reconnect at snapshot `seq` |
| `AGENT_SESSION_CURSOR_AHEAD` | cursor beyond live edge (client bug / stale ref) |
| `AGENT_SESSION_CURSOR_EXPIRED` | reserved for snapshot-registry pagination (v2 pool cursor; optional early streaming-lane adoption) — v0 keyset cursors fail as `AGENT_SESSION_CURSOR_INVALID` |
| `AGENT_SESSION_CURSOR_INVALID` | malformed/tampered list cursor or scope/filter binding mismatch — structural invalidity only; a valid server-issued keyset cursor remains valid under mutation and may yield an empty page; indistinguishable by design |
| `AGENT_REQUEST_CONFLICT` | same `requestId` re-used with different payload digest, or an invalid ledger transition was attempted |
| `AGENT_REQUEST_IN_PROGRESS` | same-key/same-digest request already has another active owner; retry after that request reaches a replayable terminal state |
| `AGENT_REQUEST_OUTCOME_UNKNOWN` | the live Host durably recorded an ambiguous post-effect result (including graceful-drain timeout); never replay silently |
| `AGENT_RUNTIME_RESTART_REQUIRED` | the pinned Agent runtime changed incompatibly and requires a process/session restart before reuse |
| `AGENT_COMMAND_INVALID_STATE` | command/payload is not valid for the authoritative Pi chat status |
| `AGENT_SHARED_ENVIRONMENT_UNAVAILABLE` | Agents requiring one canonical Workspace environment resolve incompatible placement identities/providers |
| `AGENT_GATEWAY_CLOSED` | gateway/host shutting down; retry after reconnect |

### 6.8 Conformance levels

- **Level B (v0 embedded)** — bounded replay: `connectSession(cursor)` replays
  only within the live buffer; gaps yield `AGENT_SESSION_REPLAY_GAP`;
  `readSessionState` + reconnect-at-`seq` is the documented recovery loop.
- **Level D (after streaming lane)** — durable offsets: any historical cursor
  catches up then tails; process restart preserves seq continuity;
  `REPLAY_GAP` only after explicit retention truncation.

The conformance suite (`agent-host/testing/gatewayConformance.ts`) is
parameterized over a gateway factory and asserts: app-issued scope required on
every operation, including each command on an open connection; membership
revocation and forged/cross-scope values fail closed; create/rename/delete/
send/control/queue-clear idempotency (same `(scope, operation, target,
requestId)` + digest ⇒
same typed receipt, conflicting digest ⇒ `AGENT_REQUEST_CONFLICT`); command
receipts survive Host restart with the production durable ledger at Level B and
Level D; close-is-unsubscribe; current status/queue transitions; monotonic `seq`
with no duplicates at Level D and documented-gap at Level B;
pagination conformance parameterized separately from replay level — Level B
asserts keyset total order, scope/filter cursor binding, and the documented
mutation semantics (a moved/updated row may shift relative to the traversal,
deleted rows disappear, a valid cursor may yield an empty page), while the
immutable-snapshot mutation-stability and expired-snapshot cases are Level
D/v2-skipped; and snapshot-seq consistency. The durable request
ledger target is `agentTypeId` for create and the full Agent/session ref for
session effects. It persists `pending-admission` plus the canonical digest,
calls an admission adapter that is itself idempotent on the full ledger key,
and durably records either its acceptance receipt or stable typed rejection
before any mutation. An explicit retryable admission result or retryable prompt
state guard marks the pending record `retryable: true`; it is not retained as a
denial. A same-key/same-digest `prepare` must atomically consume that marker and
return `ownership: 'reclaimed'` to exactly one caller. Concurrent losers return
`ownership: 'existing'` and remain in progress, while a different digest
conflicts. `acceptAdmission` is forbidden while the marker remains set. After
reclaim clears it, the gateway must advance only a `created` or `reclaimed`
result and return `AGENT_REQUEST_IN_PROGRESS` for `existing`; the ledger's
state transition prevents multiple callers from accepting, but does not encode
caller identity in a separate ownership token. Unmarked pending records are
never implicitly released after reopen. Only after an accepted receipt is
durable does the Host advance to `in-flight`, then store the completed typed receipt before
acknowledgement. A crash after external admission succeeds but before local
receipt persistence must never cause a second non-idempotent admission call.
The shipped Host has no startup reconciler: after abrupt restart, an unmarked
`pending-admission`, `admission-accepted`, or `in-flight` record remains in that
state and a same-key retry returns `AGENT_REQUEST_IN_PROGRESS`. It becomes
`AGENT_REQUEST_OUTCOME_UNKNOWN` only when the live Host explicitly records that
terminal state after an ambiguous action failure or a bounded graceful-drain
timeout. Completed create records outlive session deletion for their configured
terminal-payload retention window. After that window, the built-in SQLite
ledger atomically replaces terminal payloads with permanent key/digest
tombstones, so delete + retry still cannot create a second transcript.
Level-B conformance covers concurrent retry, cross-scope, cross-Agent and
cross-session same IDs, acknowledgement loss, explicit retryable-admission
reclaim across reopen, terminal replay across reopen, and preservation (without
reclaim or implicit terminalization) of unresolved records across reopen. The
automatic crash-reconciliation matrix and Level D stream cases remain skipped
for the streaming lane.

`AgentRequestLedger` has durable `prepare(key,digest)`,
`markAdmissionRetryable(key)`, `acceptAdmission(key,admissionReceipt)`,
`beginEffect(key)`, `reject(key,stableError)`, `complete(key,receipt)`,
`markOutcomeUnknown(key,error)`, and `read(key)` operations
over `pending-admission | admission-accepted | in-flight | rejected | completed
| outcome-unknown` records. Same-digest retries return the same terminal
rejection. Only a `pending-admission` record explicitly marked `retryable` is
safe to reclaim after restart. Unmarked pending, accepted, and in-flight records
remain nonterminal/in-progress until an owner with evidence transitions them;
reopening the ledger does not itself convert in-flight work to outcome-unknown.
Production Host composition
requires a transactional durable ledger: omission of `requestLedger` constructs
the built-in SQLite ledger at `requestLedgerPath`, or at a Host-owned path
derived from `sessionRoot`. An injected ledger must also report
`durable-transactional`. The in-memory implementation remains available only
through an explicit `inMemoryRequestLedgerMode: 'test' | 'development'` opt-in;
it is never an implicit production fallback. The durable ledger provides
restart receipt/service-error replay and persistence of completed records/create
tombstones. When `requestRetentionMs` is configured, the built-in SQLite ledger
lazily prunes terminal payloads during `prepare`; omitted retention preserves
them indefinitely. Configured values below 24 hours are raised to 24 hours.
Cleanup runs in the same `BEGIN IMMEDIATE` transaction as the next ownership
claim: only `rejected | completed | outcome-unknown` rows with `updated_at`
strictly less than `now - retention` move to the tombstone table, then the
payload row is deleted. Pending-admission, admission-accepted, and in-flight
rows are never eligible regardless of age. A retained tombstone keeps the full
request key and digest: the same digest returns stable
`AGENT_REQUEST_OUTCOME_UNKNOWN`, while a changed digest remains
`AGENT_REQUEST_CONFLICT`; it can never become `created` or `reclaimed`.
Retention adds no operation to the current `AgentRequestLedger` interface.
Injected implementations of that current interface keep owning their storage
policy; `requestRetentionMs` configures only the Agent-owned built-in SQLite
ledger. (The separately approved retry-reclaim contract already requires
`markAdmissionRetryable`; retention does not change that requirement.)
The SQLite implementation does not perform startup state reconciliation.
Level-B conformance covers admission rejection before mutation, concurrent
retry, retryable adapter failure, conflict, retention boundaries/tombstones,
and the exact durable reopen behavior above. Level D adds durable stream
offsets plus a separately implemented/proven crash reconciler; it does not
defer request-ledger durability or retention.

The server-only ledger/admission contract is exact (none of these records is a
transport DTO):

```ts
type AgentGatewayEffect =
  | 'session.create'
  | 'session.rename'
  | 'session.archive'
  | 'session.delete'
  | 'session.prompt'
  | 'session.followup'
  | 'session.interrupt'
  | 'session.stop'
  | 'session.queue.clear'
  | 'agent.reload'
  | 'session.command.execute'

type AgentRequestTarget =
  | { readonly kind: 'agent'; readonly agentTypeId: string }
  | { readonly kind: 'session'; readonly ref: AgentSessionRef }

interface AgentRequestKey {
  readonly workspaceScopeId: WorkspaceScopeId
  readonly authSubjectId: AuthSubjectId
  readonly operation: AgentGatewayEffect
  readonly target: AgentRequestTarget
  readonly requestId: string
}

interface AgentGatewayErrorDTO {
  readonly code:
    | 'AGENT_TYPE_UNKNOWN'
    | 'AGENT_SESSION_NOT_FOUND'
    | 'AGENT_SCOPE_DENIED'
    | 'AGENT_ENTITLEMENT_REQUIRED'
    | 'AGENT_ACCESS_FORBIDDEN'
    | 'AGENT_ACCESS_POLICY_UNAVAILABLE'
    | 'AGENT_SESSION_REPLAY_GAP'
    | 'AGENT_SESSION_CURSOR_AHEAD'
    | 'AGENT_SESSION_CURSOR_EXPIRED'
    | 'AGENT_SESSION_CURSOR_INVALID'
    | 'AGENT_REQUEST_CONFLICT'
    | 'AGENT_REQUEST_IN_PROGRESS'
    | 'AGENT_REQUEST_OUTCOME_UNKNOWN'
    | 'AGENT_RUNTIME_RESTART_REQUIRED'
    | 'AGENT_COMMAND_INVALID_STATE'
    | 'AGENT_SHARED_ENVIRONMENT_UNAVAILABLE'
    | 'AGENT_GATEWAY_CLOSED'
  readonly message: string
  readonly details?: JsonValue
}

interface AgentStableServiceErrorDTO {
  readonly statusCode: number
  readonly error: {
    readonly code: string
    readonly message: string
    readonly retryable?: boolean
  }
}

type AgentRequestFailure =
  | { readonly kind: 'gateway'; readonly error: AgentGatewayErrorDTO }
  | { readonly kind: 'service'; readonly error: AgentStableServiceErrorDTO }

interface AgentRequestLedgerRecordBase {
  readonly key: AgentRequestKey
  readonly digest: string
  readonly updatedAt: number
}
type AgentRequestLedgerRecord =
  | (AgentRequestLedgerRecordBase & {
      readonly state: 'pending-admission'
      /** Explicit safe release before admission acceptance or effect dispatch. */
      readonly retryable?: true
    })
  | (AgentRequestLedgerRecordBase & {
      readonly state: 'admission-accepted'
      readonly admissionReceipt: string
    })
  | (AgentRequestLedgerRecordBase & { readonly state: 'in-flight' })
  | (AgentRequestLedgerRecordBase & {
      readonly state: 'rejected'
      readonly failure: AgentRequestFailure
    })
  | (AgentRequestLedgerRecordBase & {
      readonly state: 'completed'
      readonly receipt: JsonValue
    })
  | (AgentRequestLedgerRecordBase & {
      readonly state: 'outcome-unknown'
      readonly error: AgentGatewayErrorDTO
    })

interface AgentRequestLedgerPrepareResult {
  readonly ownership: 'created' | 'reclaimed' | 'existing'
  readonly record: AgentRequestLedgerRecord
}

interface AgentRequestLedger {
  readonly durability: 'durable-transactional' | 'in-memory'
  prepare(key: AgentRequestKey, digest: string): Promise<AgentRequestLedgerPrepareResult>
  markAdmissionRetryable(key: AgentRequestKey): Promise<void>
  acceptAdmission(key: AgentRequestKey, admissionReceipt: string): Promise<void>
  beginEffect(key: AgentRequestKey): Promise<void>
  reject(key: AgentRequestKey, failure: AgentRequestFailure): Promise<void>
  complete(key: AgentRequestKey, receipt: JsonValue): Promise<void>
  markOutcomeUnknown(key: AgentRequestKey, error: AgentGatewayErrorDTO): Promise<void>
  read(key: AgentRequestKey): Promise<AgentRequestLedgerRecord | undefined>
  close?(): void | Promise<void>
}
```

Runtime validation enforces `session.create`/`agent.reload` → Agent target and
every other effect → full session target. The canonical digest covers the
complete effect payload but not `requestId`; conflicting digests under one key return
`AGENT_REQUEST_CONFLICT`. Valid transactional transitions are exact:

| Operation | Valid predecessor → result |
| --- | --- |
| `prepare` | missing → `pending-admission` + `created`; retryable same key/digest → atomically clear marker + `reclaimed` for one caller; every other same key/digest → current record + `existing`; different digest → conflict |
| `markAdmissionRetryable` | unmarked `pending-admission` → `pending-admission, retryable: true`; every other predecessor → conflict |
| `acceptAdmission` | unmarked `pending-admission` → `admission-accepted`; retryable pending or any concurrent second transition → conflict; callers must invoke only after their `created`/`reclaimed` prepare result |
| strong `reject` | `pending-admission | admission-accepted | in-flight` → `rejected(kind=gateway)` |
| `beginEffect` | `admission-accepted` → `in-flight` |
| stable service reject | `in-flight` → `rejected(kind=service)` |
| `complete` | `in-flight` → `completed` |
| `markOutcomeUnknown` | `in-flight` → `outcome-unknown` |

Terminal states return their recorded result on a same-digest retry; every
other predecessor is rejected. A retryable strong admission or prompt guard
marks `pending-admission` explicitly retryable before returning its error. That
marker is the only authority for a later atomic reclaim; it preserves the key
and digest, grants exactly one new owner, and is cleared by the reclaim.

### 6.9 `AgentHostAgentSpec` (agent vs host split)

Two-layer litmus: authored source may contain only safe identity/instructions.
The trusted deployment fleet spec may additionally bind allowlisted capability
names and validated config. Executable code, package/path selection, credentials,
and provider mechanics are always Host options.

```ts
interface ConfiguredAgentHostAgentSpec {
  readonly agentTypeId: string
  readonly definition: {             // portable core; catalog lane makes it
    readonly instructions: string    // content-addressed AuthoredAgentSource
    readonly label: string
    readonly version?: string
  }
  /** HOST-POLICY binding by name from an allowlisted loaded pool + validated
      config data. Never accepted from AuthoredAgentSource/pushed tenant input;
      never code, paths, secrets, or arbitrary package selection. */
  readonly plugins?: readonly { readonly name: string; readonly config?: JsonValue }[]
  /** POLICY by name. Never keys. */
  readonly model?: { readonly preferred?: string; readonly maxTokensPerTurn?: number }
}
interface LegacyDefaultAgentHostSpec {
  readonly agentTypeId: 'default'
  readonly legacyDefault: true
}
type AgentHostAgentSpec = ConfiguredAgentHostAgentSpec | LegacyDefaultAgentHostSpec
```

`AgentHostAgentSpec` is a trusted composition-root input, not the pushed
authored definition schema. `definition` carries authored identity/instructions;
the `plugins` binding is compiled by app/Host policy from an allowlist. This is
how §2 decision 7 coexists with active Decision 28: capability/config is scoped
to an Agent, while authored JSON still cannot activate executable behavior.
Compat wrappers synthesize only `LegacyDefaultAgentHostSpec`. Its sentinel means
the current harness base prompt plus existing append/dynamic hooks, with no
definition instructions inserted/replaced. Golden system-prompt snapshots prove
legacy output unchanged. All non-legacy specs require `definition`.

Host options (mechanism + custody — never in the spec): plugin **loading**
(dirs/managers), model **credentials/providers**, `sessionRoot` (host
namespaces per `agentTypeId` internally), `requestLedgerPath` or an injected
transactional ledger, explicit test/development-only in-memory ledger mode,
`runtimeModeAdapter`/`runtimeHost`, `auth`.

### 6.10 `createAgentHost()`

```ts
interface CreateAgentHostOptions {
  readonly agents: readonly AgentHostAgentSpec[]
  /** App-owned trust compiler; Agent package never imports Core/Workspace. */
  readonly fleetCompiler: AgentFleetCompiler
  /** Stable v2 routing seed. Omit only when the Host may durably create/read
      `sessionRoot/.agent-host-id` before returning. */
  readonly hostId?: string
  readonly scopeVerifier: AgentScopeVerifier
  readonly runtimeModeAdapter: RuntimeModeAdapter
  readonly runtimeHost?: AgentRuntimeHostOperations
  readonly sessionRoot?: string
  readonly resolveRuntimeScope: (input: {
    agentTypeId: string
    scope: AuthorizedAgentScope
  }) => Promise<ResolvedAgentRuntimeScope>
  readonly telemetry?: TelemetrySink
  readonly metering?: AgentMeteringSink
  /** Optional adapter override; production overrides must be transactional. */
  readonly requestLedger?: AgentRequestLedger
  /** Durable effect-ledger path, independent of transcript/session storage.
      When omitted, production derives a Host-owned path from sessionRoot. */
  readonly requestLedgerPath?: string
  /** Explicit opt-in for tests/development; never a production fallback. */
  readonly inMemoryRequestLedgerMode?: 'test' | 'development'
  /** Built-in SQLite terminal-payload retention; omitted means indefinite.
      Values below 24 hours are raised to the 24-hour safety minimum. */
  readonly requestRetentionMs?: number
  /** Omission selects the built-in idempotent accept-all adapter for
      trusted-local composition; it never skips ledger admission. */
  readonly effectAdmission?: AgentEffectAdmission
  readonly shutdownGraceMs?: number
  readonly harnessFactory?: AgentHarnessFactory
}

interface AgentEffectAdmission {
  /** MUST be idempotent and reconcilable on key across process crashes. */
  admit(input: {
    key: AgentRequestKey
    digest: string
    scope: VerifiedAgentScopeClaim
    operation: AgentGatewayEffect
    target: AgentRequestTarget
  }): Promise<
    | { readonly type: 'accepted'; readonly admissionReceipt: string }
    | { readonly type: 'rejected'; readonly error: AgentGatewayErrorDTO }
    | { readonly type: 'retryable'; readonly error: AgentGatewayErrorDTO }
  >
}

interface AgentFleetCompiler {
  compile(input: {
    agents: readonly AgentHostAgentSpec[]
  }): Promise<readonly CompiledAgentHostAgentSpec[]>
}
// CompiledAgentHostAgentSpec is server-only, immutable, and contains only
// allowlisted resolved policy/capability handles plus the portable definition.
// It is never accepted from authored JSON or exposed as a transport DTO.

interface ResolvedEnvironmentScope {
  readonly placementIdentity: string
  readonly workspaceRoot: string
  readonly templatePath?: string
  /** Covers every provider-mutating input, including plugin provisioners. */
  readonly provisioningFingerprint: string
  readonly provisionRuntime?: AgentRuntimeProvisioner
}

interface ResolvedAgentRuntimeScope {
  readonly identity: string // canonical complete runtime-scope cache key.
  // MUST cover the full resolved plugin composition (PL1): artifact
  // descriptors/digests, validated config, contribution grants and
  // placement/isolation modes, tool-contract digests, provisioning
  // generation — plus every other binding-varying input. The same artifact
  // under different grants is a different identity. (Environment
  // provisioningFingerprint stays restricted to environment-mutating inputs;
  // see below.)
  /** Shared placement/provisioning contract, independent of Agent overlays. */
  readonly environment: ResolvedEnvironmentScope
  readonly sessionNamespace: string
  readonly pi?: PiHarnessOptions
  readonly extraTools?: readonly AgentTool[]
  readonly getFilesystemBindings?: (input: {
    scope: VerifiedAgentScopeClaim
    sessionId?: string
    requestId: string
  }) => Promise<readonly RuntimeFilesystemBinding[] | undefined>
  readonly systemPromptAppend?: string
  readonly loadSystemPromptAppend?: () => Promise<string | undefined>
}

interface AgentHostHttpProjectionOptions {
  /** Derives membership and the allowed storage partition from trusted app
      state; it MUST NOT sign an arbitrary browser-provided scope header. */
  readonly authorizeRequest: (request: FastifyRequest) => Promise<AuthorizedAgentScope>
  readonly defaultAgentTypeId: string
  readonly legacyPiChatAliases?: boolean
}

interface AgentHostHandle {
  readonly hostId: string            // stable logical id (v2 routing seed)
  describe(): Promise<AgentHostDescription>
  drain(): Promise<void>
  close(): Promise<void>
}

async function createAgentHost(options: CreateAgentHostOptions): Promise<{
  host: AgentHostHandle
  gateway: AgentGateway              // the embedded implementation
  registerRoutes(options: AgentHostHttpProjectionOptions): FastifyPluginAsync
}>
```

Before resolving, `createAgentHost` clones a non-empty fleet, rejects
duplicate/unsafe `agentTypeId`s, invokes the app-owned `fleetCompiler` to
resolve every plugin/config/model name through the app's loaded allowlists, and
freezes the resulting server-only compiled specs. Unknown or untrusted values
fail startup, before a gateway or route plugin can serve. The Host does not
import Core/Workspace discovery or defer compilation to a scoped first request.
It revalidates compiler output one-to-one: identical count and exact
`agentTypeId` set, no duplicates/injection/renames, and every compiled object
recursively frozen.
Configured prompt precedence is exact: harness base → authored
`definition.instructions` → Host static append → dynamic contribution; the
legacy sentinel omits the authored step byte-for-byte. Golden tests prove two
configured specs with different instructions execute different prompts and the
legacy wrapper remains unchanged.

`registerRoutes(options)` validates `defaultAgentTypeId` against the frozen
compiled fleet synchronously while constructing the Fastify plugin; an unknown
default throws before `app.register` can mount or serve any alias.

`createAgentHost` is async so fleet compilation, durable host-ID resolution,
and mandatory adapter initialization complete before it returns. `hostId` is
either an explicit stable deployment ID or a durably generated value at
`sessionRoot/.agent-host-id`; restart returns the same value. When both are
omitted, compat composition must first resolve the same durable default session
root used by its transcript layout and pass it; deployed Core rejects creation
if that root is not on its configured durable volume. The Host never falls back
to cwd, container home, or memory for identity. Mounting is
awaited through Fastify, and `drain`/`close` are idempotent. Runtime
bindings are created on demand per §4's cardinality and retired through the
existing bounded lifecycle. Sessions store `agentTypeId`, workspace scope, and
storage-scope metadata and are laid out per agent type/scope under `sessionRoot`
so later 1:1 re-hosting carves out cleanly. `authSubjectId` affects a binding key
only when tools/prompt/files/policy vary by actor; it is not stored as session
ownership.

The `LegacyDefaultAgentHostSpec` wrapper is the path exception: it preserves all
three current branches byte-for-byte—explicit `sessionDir`,
`sessionRoot/<sessionNamespace>`, and (when the namespace is absent)
`defaultSessionDir(storageCwd ?? cwd, sessionRoot)`. The third branch is the CLI
production path at `packages/cli/src/server/modeApps.ts:765-772` and is tested
both with and without `BORING_AGENT_SESSION_ROOT`. No branch gains a new
`default`/Agent segment, so existing JSONL transcripts remain visible in place.
Configured multi-Agent specs use the new per-Agent layout. A pre-AH0 transcript
fixture must list/read/stream after wrapper cutover and rollback; no implicit
move, copy, or dual writer is allowed.

One native session has exactly one execution/writer lease keyed by its full ref,
independent of caller/runtime-binding caches. Creation persists the selected
`runtimeScopeIdentity`. Later Workspace-authorized actors may read through the
same session authority, but a mutation must resolve/reuse that pinned identity;
if actor-sensitive policy cannot authorize safe reuse it fails closed through
the current access-policy errors; incompatible published/runtime identity drift
fails with `AGENT_RUNTIME_RESTART_REQUIRED` instead of opening a second harness
or changing tools/prompt mid-session. Concurrent same-session commands across two
subjects prove one model loop/writer and deterministic admission.

Environment ownership is separate from Agent runtime bindings. One canonical
`EnvironmentLease`, keyed by `(workspaceScopeId,
environment.placementIdentity)`, owns the sole `RuntimeModeAdapter.create()`
result and provider bytes for compatible Agents. It also serializes and
idempotently reconciles exactly one provisioning manifest per
`provisioningFingerprint` and generation, then publishes one immutable
provisioning snapshot (PATH/env/files) to all Agent bindings. Agent overlays may
add tools/prompts but may not mutate provider bytes. A conflicting placement or
provisioning fingerprint fails `AGENT_SHARED_ENVIRONMENT_UNAVAILABLE`; it cannot
silently fork or reprovision an in-use environment. Reload creates a new
generation and retires the old one only after its final lease. Concurrent A/B
boot and reload fixtures prove one provider, one provisioning generation, Agent
A writes readable by Agent B and the workbench, identical PATH/env, and no early
teardown in direct/local and Vercel-qualified shared modes.

Core authorization maps the browser's presented workspace/storage selector to
trusted membership, deployment/revision bindings, and the canonical allowed
storage partition before minting the capability; absent input selects the
app-defined default. A foreign or stale storage-scope header is rejected rather
than signed. CLI uses one fixed trusted-local mapping. Host authorization and
session lookup therefore consume only the verified complete
`workspaceScopeId`; hostile foreign-storage HTTP tests cover both legacy and
addressed routes.

Compatibility has two named admission levels. New factory consumers (including
MIG-CORE's production path) supply the strong `AgentEffectAdmission` above.
Existing `registerAgentRoutes` callers retain their current optional
`({ workspaceId, requestId }) => Promise<void>` callback unchanged
(`packages/agent/src/core/piChatSessionService.ts:73-75`): the compat wrapper
records a built-in `legacy-at-most-once` acceptance, places that legacy callback
*after* ledger `beginEffect` and immediately before the mutation, invokes it at
most once, and maps an ambiguity observed by the live Host to
`AGENT_REQUEST_OUTCOME_UNKNOWN` rather than retrying. Abrupt process death leaves
`in-flight` preserved/in-progress until Level-D reconciliation exists. An observed action failure
is replayable only when `stableServiceActionFailure` can project it to the
server-only `{ kind: 'service', error: AgentStableServiceErrorDTO }` record:
the error must have a canonical shared `ErrorCode`, an integer 4xx/5xx status
(or the canonical payment status), and optional boolean `retryable`. The same
stable service shape is replayed on a same-ID retry; unprojectable failures
become outcome-unknown. In production Level B, the durable ledger replays a
persisted service failure across Host restart; only the explicit test/development
in-memory mode clears records with the process. Service failures never enter the
public Gateway error union. This compatibility mapping is not advertised as the
strong reconcilable admission level.

Lifecycle ownership is single and explicit: the mounted plugin calls
`host.drain()` from `preClose`, which rejects new work, proactively closes or
cancels unbounded event subscriptions, waits for finite effects only until
`shutdownGraceMs`, then uses the production durable ledger to reject still
pre-effect records with `AGENT_GATEWAY_CLOSED` and mark tracked `in-flight`
effects `AGENT_REQUEST_OUTCOME_UNKNOWN`; explicit test/development in-memory
mode retains those terminalizations only for that process. Abrupt process death
cannot run this drain path and receives no startup terminalization in Level B.
Resource generations are fenced: late callbacks cannot write
receipts, mutate a recycled lease, or acknowledge success. An adapter that
ignores cancellation is safely detached before `preClose` returns. `onClose`
calls `host.close()` to dispose bindings, Environment leases, then the mode
adapter.
`gateway.close()` only closes that client facade/subscriptions and makes later
calls return `AGENT_GATEWAY_CLOSED`; it never closes the shared Host. Calling any
close/drain path repeatedly is safe, and active-stream shutdown is tested.

The funnel has a strict ownership split:

| Current assembly concern | Target disposition |
| --- | --- |
| harness, bridge, Pi chat service, session store, default tools, live binding lifecycle | one Agent-owned `buildAgentComposition` used only by `createAgentHost` |
| workspace/root/template/Pi/session namespace/actor-sensitive tools, request/run-aware filesystem binding provider, prompt contribution, provisioning | normalized by app composition into `resolveRuntimeScope`; its `identity` covers every binding-varying input while filesystem authorization still runs per operation |
| per-effect admission/identity recording | idempotent `effectAdmission.admit` runs after scope/ref and ledger prepare but before every create/rename/delete/send/control/queue effect; accepted/rejected/retryable dispositions follow §6.8; old callbacks use the named at-most-once compatibility mapping |
| Core auth/membership, DB stores, plugin discovery/trust, Core bridge/UI/plugin routes, frontend fallback | stays Core/app-side; Core derives branded scope and normalized callbacks, then awaits `app.register(host.registerRoutes(...))` |
| standalone Fastify creation, logger/body limit, auth token, legacy defaults/health | wrapper-only behavior around the Host; not Host mechanism |
| Workspace plugin asset/reload/backend management | stays Workspace/app-side; only its Agent runtime contributions enter the normalized scope |

AH0's first committed artifact is an exhaustive option/route audit covering
every field in `CreateAgentAppOptions`
(`packages/agent/src/server/createAgentApp.ts:51-138`),
`RegisterAgentRoutesOptions`
(`packages/agent/src/server/registerAgentRoutes.ts:309-445`), and Core's
production mount
(`packages/core/src/app/server/createCoreWorkspaceAgentServer.ts:840-1135`). Each row must
say `host`, `normalized resolver`, `compat wrapper`, or `app-side`, with an
existing regression test. No implementation starts until the table has zero
unclassified rows.

### 6.11 HTTP projection (wire compatibility)

`registerRoutes` adds addressed `/api/v1/agents/:agentTypeId/...` routes using
the Gateway DTOs. Compat wrappers separately preserve the complete existing
wire for their frozen default Agent:

| Existing route | Exact preserved contract | Gateway adapter |
| --- | --- | --- |
| `GET /api/v1/agent/pi-chat/sessions?limit&offset&activeSessionId` | array of `{id,title,createdAt,updatedAt,turnCount}` with ISO timestamps | page/list adapter; no cursor exposed |
| `POST /api/v1/agent/pi-chat/sessions` | strict `{title?}`; `201` SessionSummary | create using a server-generated idempotency ID; project native summary |
| `DELETE /api/v1/agent/pi-chat/sessions/:sessionId` | empty body; `204` | idempotent delete |
| `GET .../:sessionId/state` | exact `PiChatSnapshot` | `readSessionState().state` |
| `GET .../:sessionId/attachments/:messageId/:index` | raw image bytes/headers | remains current in-process attachment route in v0 |
| `GET .../:sessionId/events?cursor=` | raw `PiChatEvent \| heartbeat` NDJSON; `409 CURSOR_OUT_OF_RANGE` with `details.reason/latestSeq/minReplaySeq` | unwrap Gateway event envelope; preserve heartbeat/framing |
| `POST .../:sessionId/prompt` | current strict PromptPayload, `202` PromptReceipt | `send(kind=prompt)`; `clientNonce` is request ID |
| `POST .../:sessionId/followup` | current strict FollowUpPayload, `202` FollowUpReceipt | `send(kind=followup)`; nonce/sequence preserved |
| `POST .../:sessionId/queue/clear` | `{clientNonce?,clientSeq?}`, `202` QueueClearReceipt | `clearQueue` |
| `POST .../:sessionId/interrupt` | strict empty body, `202` CommandReceipt | adapter generates command request ID |
| `POST .../:sessionId/stop` | strict empty body, `202` StopReceipt | adapter generates command request ID |

There is no legacy PATCH/rename route and no legacy `/stream` or `/send` route.
Addressed routes may add rename and canonical request IDs; they are not claimed
byte-compatible with the legacy aliases. Golden inject tests snapshot every
legacy method/path/query/body/status/header/error/frame against today's
`packages/agent/src/server/http/routes/piChat.ts:32-75,110-426` and current
shared schemas. Existing front E2E flows must also pass unchanged. Aliases are
removed only at an owner-approved contraction gate.

---

## 7. Consumer alignment

Each consumer ends as an explicit composition root: one `createAgentHost()`
call, gateway injected, zero agent-internal or provider imports.

| Consumer | Today (verified) | Target composition | Lane |
| --- | --- | --- | --- |
| **workspace app server** (`createWorkspaceAgentServer.ts`) | imports `createAgentApp`, `provisionWorkspaceRuntime`, `VERCEL_SANDBOX_WORKSPACE_ROOT`; builds mode adapter locally | receives `{ gateway, registerRoutes }` from the caller or calls the factory; session/chat routes delegate to gateway; **zero sandbox-provider imports** | MIG-WS |
| **core server** (`createCoreWorkspaceAgentServer.ts`) | resolves auth/membership, plugins, Core bridge, runtime provider, request-aware Pi/tools/provisioning, then mounts `registerAgentRoutes` | keeps auth/DB/plugin/bridge/UI routes app-side; constructs Host with normalized runtime-scope resolver + scope verifier, then awaits its Fastify plugin. Existing remote-worker adapter remains an Environment mode, not a Remote Gateway | MIG-CORE (heaviest; assembly audit is blocking) |
| **CLI** (`modeApps.ts`) | dynamic-imports both packages; borrows Workspace's mode adapter | calls the factory with agent-package mode adapter; no Workspace reach-through | MIG-CLI |
| **agent-playground** | imports Workspace runtime adapters (backward edge) | factory only; boots from agent-package exports | MIG-PG |
| **workspace-playground** | via workspace factory | inherits MIG-WS; proves the one-process reference composition | MIG-WS proof |
| **delegation** (`workspaceAgentDispatcher`, `managedAgentDelegate`) | `Agent.send/stream` facade + second buffer | consume the gateway (`createSession`/`connectSession`/send); facade + `AgentLiveEventBuffer` become delegating wrappers, deleted at contraction | MIG-DEL |
| **front (browser)** | NDJSON routes + `PiChatEvent` reducer | unchanged wire; transport threads `agentTypeId` addressing | inside MIG-WS |

Alignment invariants (lint/scan-gated at each lane's merge):

- Workspace target paths: zero value imports from
  `@hachej/boring-bash`/`@hachej/boring-sandbox`/agent server internals.
- Only composition roots call `createAgentHost`.
- No consumer holds `HarnessPiChatService`/`PiSessionStore` references in
  target paths.

---

## 8. Implementation steps

### H0/A0 — dispatch gate (required, not an implementation slice)

The complete Bead graph may exist for review, but its epic remains blocked and
no child may move to `in_progress` until the owner approves this plan and the
atomic authority amendment required by #905. The amendment must reconcile
Decision 28 and #905's v2-contract wording identified in §6.6. Approval is
recorded on the epic; graph creation is not approval.

### Step G1 — contract + conformance (sequential, first)

1. Create `packages/agent/src/shared/gateway/{types,errors,events}.ts` with
   §6.1–6.8 exactly; export via `@hachej/boring-agent/shared`.
2. Add DTO-discipline guard for transport DTOs plus an explicit test that the
   branded `AuthorizedAgentScope` cannot be structurally forged/serialized;
   shared-invariant lint remains no `node:*`/`Buffer`. DTO-shape discipline
   only: the recursive runtime event-leaf validator (functions/symbols/bigint/
   cycles/prototype objects/depth/size overflow/absolute-path rejection) is
   deferred to the v2 remote-wire bead per the §6.4 owner descope and is not a
   G1 deliverable.
3. Create `packages/agent/src/server/agent-host/testing/gatewayConformance.ts`
   — suite of §6.8, parameterized over `() => Promise<AgentGateway>`; Level D
   cases skipped with owner annotation.
4. Proof: typecheck + conformance suite compiles against a throwaway in-memory
   fake. No runtime behavior changed anywhere.

### Step AH0 — factory + embedded gateway (sequential, second)

1. **Assembly diff-audit** (hard stop before code): table of every option,
   hook, route, lifecycle, and ordering constraint that
   `createAgentApp`, `registerAgentRoutes`, and core's hand-assembly each
   construct (harness, bridge, tools, auth, routes, provisioning, session
   wiring). Every row maps to Host, normalized resolver, compat wrapper, or an
   explicit app-side disposition and names its regression test. Core route
   ordering at
   `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts:840-1135`
   is mandatory.
2. Implement internal `buildAgentComposition()` in
   `packages/agent/src/server/agent-host/` — the single construction sequence
   (harness → bridge → chat service → session store → tools), extracted from
   the two constructors.
3. Implement `createAgentHost()` per §6.10 over it; multi-agent: lazy runtime
   bindings per `(agentTypeId, workspaceScopeId, runtimeScopeKey)`, per-agent/
   scope session namespace, actor-sensitive keying where required, catalog from
   trusted specs. The canonical plugin ID preflight (§10) runs **app-side in
   the plugin resolver, before descriptors/contributions are collected or
   registered**; the fleet compiler consumes only validated canonical IDs
   (plugin discovery stays app-owned per §6.10). Prove two Workspaces × two Agent types without root/tool/
   transcript/prompt bleed; additionally use two auth subjects in one Workspace
   with actor-varying tools/files/prompt to prove when bindings split or safely
   reuse, plus concurrent access to one shared session proving its pinned
   runtime identity and single writer. Prove same workspace/different storage
   scopes remain isolated, hostile storage selectors fail before minting, and
   binding retirement/reload. Prove compatible Agents share one canonical
   Environment lease/provider and incompatible placement fails closed.
4. Rewire `createAgentApp` and `registerAgentRoutes` as **delegating compat
   wrappers** over the factory (signatures unchanged; their existing test
   suites must pass unmodified — that is the non-regression proof).
5. Implement `EmbeddedAgentGateway` over the composition (chat service +
   session store); add the native/idempotent rename seam and no-boot activity
   index from §6.3; pass conformance Level B and restart fault injection.
6. Implement async Fastify `registerRoutes` projection per §6.11; legacy aliases
   via wrappers; golden route contracts and existing front E2E pass unchanged.
7. Relocate `createSandboxRuntimeModeAdapter` + `sandboxRuntimeHostOperations`
   from workspace → agent package; leave workspace re-export shims.
8. Resolve naming without an unjustified env rename: new service types own
   `AgentHost*`; inventory `BORING_AGENT_HOST_ID` consumers and retain its
   trusted-proxy compatibility sentinel unless a separately approved migration
   proves a real collision.
9. Proof: full Agent suites + Level B + request-ledger ack-loss/conflict/
   concurrent-retry and durable-reopen tests (terminal replay plus unresolved
   state preservation without implicit reconciliation) + pre-AH0 legacy
   transcript read/list/stream fixture + golden HTTP contracts + two
   Workspaces × two Agents through one gateway, with independent scope
   roots/session namespaces and no actor bleed + fleet/prompt compilation
   goldens + bounded shutdown tests with an endless stream and stuck effect.

### Step MIG-* — consumer lanes (parallel after AH0)

Each lane: swap construction to the factory / consumption to the gateway,
delete the direct imports its row in §7 names, keep its existing suites green,
add the alignment lint for its package. MIG-CORE additionally starts by
re-validating the AH0 diff-audit against its assembly and extending factory
options if a gap surfaces (option additions are additive; no consumer-visible
change).
MIG-CORE adds a strong `effectAdmission: AgentEffectAdmission` composition
option while retaining inherited legacy `admitEffect` source compatibility;
the new production path uses the strong option and the compat wrapper alone
maps the old callback.

### Follow-up lanes (separate issues, unblocked by this plan)

1. **Streaming** (first): wire `SqliteEventStreamStore` into
   `buildAgentComposition`, unconditional durable append, offset reconnect,
   collapse `AgentLiveEventBuffer`; flip conformance to Level D. The production
   request ledger is already durable at Level B (including restart replay of
   terminal receipts and safe configured terminal-payload retention); Level D
   adds the still-unshipped request-ledger recovery set: startup reconciliation
   backed by external admission/effect evidence and the full crash-boundary
   matrix. It must not
   infer `outcome-unknown` merely from finding `in-flight`. The durable
   checkpointed activity index also gains startup reconciliation. The
   snapshot-registry pagination MAY land here or wait for the v2 pool cursor.
   Upgrade changes event replay/recovery capability without emptying or
   reinterpreting existing request-ledger rows; a pre-upgrade unresolved row
   remains in progress until the new reconciler proves a safe terminal state.
2. **Catalog revival**: `AgentHostAgentSpec.definition` backed by
   `materializeAgentDirectory`/digests; `AgentSummary.definition` populated.
3. **#861**: remove Bash/Sandbox→Agent back-edges (required before v2 package
   qualification, not before v0).
4. **v2 remote** (#905): tracer (one host, service auth, send+events) → then
   grants/pool/placement hardening; `RemoteAgentGateway` preserves §6.6's v0
   semantic methods through the owner-approved versioned v2 extension in §6.6.

## 9. Reserved future rung (not built here)

The hosted/marketplace tier runs author code on **shared** hosts by never
executing it in the host process: tools = schema in spec + artifact executed
in the Environment sandbox (exec primitive or MCP-server-in-sandbox); panes =
sandboxed separate-origin iframes (AR1 viewer pattern); plugin backends =
sandboxed processes behind one operator-owned proxy route; credentials
brokered at the sandbox boundary (eve's network-firewall injection is the
reference mechanism). Ships only when marketplace density demands it; the
own-host tier ships first. **#909 lanes must not grow in-process plugin powers
intended for external authors.**

## 10. Acceptance

- [ ] §6 types exported from shared with the DTO-discipline guard green.
- [ ] Conformance Level B green against `EmbeddedAgentGateway`; Level D
      specified, skipped, owner-annotated.
- [ ] Session pagination is a scope/filter-bound keyset traversal in the total
      order; tampered or cross-scope/filter cursor replay fails
      `AGENT_SESSION_CURSOR_INVALID` without leaking rows; best-effort
      mutation semantics are documented (immutable snapshot traversal is a
      Level D/v2 requirement).
- [ ] `createAgentHost()` is the only construction implementation;
      `createAgentApp`/`registerAgentRoutes` delegate (their suites pass
      unmodified).
- [ ] Two agent types served by one process through one gateway with
      two Workspace scopes, two storage scopes under one Workspace, plus two
      auth subjects inside one Workspace,
      independent runtime keys/session namespaces, and no root/tool/transcript/
      prompt/actor bleed (fixture).
- [ ] All §7 consumers aligned; alignment lints active per package.
- [ ] agent-playground has no `@hachej/boring-workspace` import.
- [ ] Every §6.11 legacy route has a golden contract test and existing browser
      wire remains unchanged; addressed routes are additive.
- [ ] A pre-AH0 legacy transcript tree remains listable/readable/streamable at
      all three unchanged branches—explicit `sessionDir`, namespaced root, and
      CLI `defaultSessionDir` with/without `BORING_AGENT_SESSION_ROOT`; rollback
      reads the same bytes.
- [ ] Addressed rename appends native `session_info` to every resolved
      wrapper/linked-native transcript through the existing append path and
      converges deterministically (timestamp, native-over-wrapper, offset
      tie-break) no later than the next explicit rename; same-requestId retry
      returns the recorded receipt within the active retention window.
- [ ] Canonical plugin ID validated across `package.json#boring.id`
      (fallback: package name), `definePlugin({id})`, and
      `defineServerPlugin({id})` at preflight, before any contribution
      registers — validated **app-side in the plugin resolver** (discovery
      stays app-owned); the fleet compiler consumes only validated IDs;
      `AgentHostAgentSpec.plugins[].name` denotes that canonical ID.
- [ ] An in-process projected-tool conformance test proves `onUpdate` and
      `AbortSignal` survive schema projection (plugin-contribution-model F7
      obligation).
- [ ] `ResolvedAgentRuntimeScope.identity` provably covers the full resolved
      plugin composition (artifact digests, validated config, grants,
      placement/isolation, tool-contract digests, provisioning generation):
      changing any one of them changes the identity in a fixture, while
      `provisioningFingerprint` changes only for environment-mutating inputs
      (grant-only change ⇒ same Environment lease).
- [ ] Naming inventory recorded; no environment variable renamed without a
      separately approved compatibility migration.
- [ ] No transport DTO contains `hostId`, provider/root/absolute-path values or
      live objects. Existing workspace-relative chat attachment/file-change
      paths are recursively JSON/size/depth validated; authorization scope
      remains an unforgeable app capability.
- [ ] Request receipts pass concurrent retry, cross-scope same-ID,
      cross-Agent/session same-ID, acknowledgement-loss, retryable-admission,
      conflict, and durable reopen tests at Level B; effect admission rejects
      before mutation for every Gateway effect. Level-B reopen proves terminal
      replay and preserves unresolved rows as in-progress without implicit
      conversion. Automatic startup reconciliation and the complete abrupt-crash
      boundary matrix are Level D requirements (streaming lane).
- [ ] Host fleet startup rejects duplicate/unsafe Agent IDs and unknown
      plugin/config bindings; a declared model policy with no app compiler
      fails closed (`AGENT_FLEET_MODEL_POLICY_UNCOMPILED`); prompt precedence
      and stable `hostId` have restart goldens.
      (Owner descope 2026-07-26: model-ID *identity* validation is deferred to
      the authored-catalog lane. No fleet-time model registry exists in v0 —
      `ModelRegistry` is harness- and credential-scoped, so "is model X valid"
      is not answerable at Host startup without freezing an answer that is
      wrong by design. Fleet startup therefore validates plugin and config
      bindings by identity and fails closed on an unenforceable model policy.
      Follow-up acceptance is folded into the catalog bead.)
- [ ] Compatible Agents share one canonical Environment provider and observe
      each other's Workspace writes in direct/local and qualified shared modes.
      Concurrent A/B boot and reload invoke one provisioner per fingerprint/
      generation, publish the identical immutable PATH/env snapshot, reject a
      conflicting fingerprint without mutation, and retire the old generation
      only after its final lease.
- [ ] The derived activity index reports no phantom writers after restart (no
      live channel ⇒ never `running`); durable-index crash-transition
      reconciliation is a Level D requirement (streaming lane).
- [ ] Shutdown returns within its configured grace period with an endless event
      subscriber and stuck effect, then disposes each owned resource once.
- [ ] All existing agent/workspace/core/CLI suites green.

## 11. Out of scope

Remote protocol/grants/pool/placement (v2, #905); durable-stream activation
(lane 1); `files`/`pluginAssets`/egress gateway surfaces (v2); definition
schema changes; plugin-system changes; workbench changes; deletion of compat
wrappers/legacy routes (contraction approval); #861.

## 12. Risks

1. **MIG-CORE gaps** — core's hand-assembly may need options AH0 didn't
   model. Mitigation: core's rows are mandatory in the AH0 diff-audit;
   factory options grow additively.
2. **Contract frozen before streaming** — mitigated by Level B/D conformance
   split; contract designed for D, honest at B.
3. **Compat wrappers forking** — wrappers must delegate, never reimplement;
   enforced by making `buildAgentComposition` the only construction sequence.
4. **Wire drift during addressing change** — legacy aliases + existing front
   E2E as the regression oracle.
5. **RETIRED (2026-07-23):** the owner descope deltas were subsequently
   verified through a dedicated 3-round fresh adversarial review (DS-R1–R3
   below) reaching READY; the 12 findings it surfaced (Level-B honesty for
   HTTP callers, pagination conformance split, dangling validator
   requirements, saga restart terminality, PL1 identity coverage, preflight
   placement) are fixed in place.

## 13. Adversarial review findings and status

> **Note (updated 2026-09-07):** the dispositions below are historical review
> records, not the current runtime contract. O-R23/DS-R1 originally deferred the
> durable request ledger to Level D; the subsequently shipped AH0 production
> composition requires SQLite (or another transactional durable ledger) at
> Level B. The normative current behavior is §6.8/§8/§10 above: terminal replay
> survives reopen, unresolved rows are preserved without startup reconciliation,
> and Level D still owns evidence-backed crash reconciliation and its matrix.
> Other references below to rename journals, snapshot pagination, or activity
> checkpoints continue to describe their Level D/v2 form.

Concrete consolidated findings (duplicate reviewer reports share one row):

| Severity | Failure scenario | Disposition |
| --- | --- | --- |
| P0 | crashed draft deleted §7-§12, left ellipses/nonexistent appendices, then beads omitted production migration/proof | restored coherent baseline; full executable sections retained |
| P0 | one global composition per Agent spec captures the first Workspace/actor root, tools, or transcript namespace | §4/§6.10 lazy `(agentTypeId, workspaceScopeId, runtimeScopeKey)` cardinality + multi-actor proof |
| P1 | plain scope strings/type casts forge another Workspace authorization | runtime issuer provenance/WeakSet-style verifier; forged/spread/JSON/cross-issuer conformance |
| P1 | auth subject becomes session owner and breaks Workspace-shared links/legacy rows | subject is attribution/runtime-key input only; stored Workspace/storage scope remains authorization |
| P1 | request ledger aliases Agents/sessions or replays an unknown model effect after crash | target-inclusive durable admitted→completed state machine and stable unknown-outcome error |
| P1 | generic `send` loses prompt attachments/model or queues incorrectly | discriminated prompt/follow-up commands, exact nonce/sequence mapping, state/action matrix, typed receipts |
| P1 | copied client `PiChatState` fails DTO serialization or list status boots every transcript | recovery carries `PiChatSnapshot`; Host maintains a no-boot activity index distinct from UI optimistic states |
| P1 | raw Pi events carry cyclic/unbounded values or Host paths into v2 | `JsonSafe<PiChatEvent>` plus recursive size/depth/path validation; v2 remains a versioned wire extension |
| P1 | static filesystem bindings reuse one actor capability for another run | request/run-aware binding provider retained in normalized scope and exercised with two same-Workspace actors |
| P1 | factory bypasses Core effect admission, plugin/auth/bridge ordering, or async Fastify startup | explicit app/Host ownership table, idempotent `effectAdmission`, async plugin, and blocking exhaustive assembly audit |
| P1 | legacy front calls `/events`/`prompt`/`followup` but invented `/stream`/`send` adapters 404 or drift schemas | exhaustive §6.11 mapping + golden wire snapshots; addressed routes additive |
| P1 | trusted authored JSON selects a privileged native plugin | only host-policy allowlisted compiled bindings; legacy sentinel cannot invent instructions |
| P1 | v2 claims identical v0 DTOs yet needs Host routing/files/egress | owner-attention versioned-additive correction and H0/A0 amendment gate |
| P1 | admission succeeds externally, Host dies before ledger advance, and retry charges/runs policy twice | full-key idempotent admission adapter + durable acceptance receipt and retryable/stable dispositions |
| P1 | Core signs a browser-supplied foreign storage selector and exposes another partition | trusted Core/CLI selector mapping before capability minting + hostile-header proof |
| P1 | wrapper and linked native JSONLs disagree, so rename changes only one UI and reverts after restart | focused rename capability, newest durable native authority, all-target journal/reconciliation |
| P1 | an endless event stream keeps Fastify `preClose` blocked forever | subscription cancellation + bounded grace + forced abort and deterministic shutdown proof |
| P1 | two same-Workspace Agents get copied providers and observe different files | canonical Environment lease independent of Agent binding; cross-Agent/workbench visibility proof |
| P1 | an invalid/duplicate fleet or unknown plugin begins serving before lazy failure | async clone/freeze/allowlist compilation is a startup gate; configured prompt precedence has goldens |
| P1 | a page-2 row is renamed/deleted after page 1 and vanishes from the active traversal | durable immutable snapshot projection + opaque snapshot/offset cursor and mutation-between-pages proof |
| P1 | Host promises fleet trust validation but has no app-owned registry/compiler input | explicit `AgentFleetCompiler` compiles app-loaded allowlists before the Host can serve |
| P1 | two Agent bindings concurrently provision one shared provider and diverge PATH/files | Environment-owned fingerprinted provisioning generation, serialized reconciliation, immutable shared snapshot |
| P1 | a leaked snapshot cursor from Workspace A is replayed under Workspace B and returns A tombstones | authenticated cursor binds complete verified scope + normalized query with cross-scope/filter denial proof |
| P1 | Host restarts with durable `running` and permanently reports a phantom writer | writer-owned atomic checkpoints + pre-serve reconciliation of every non-quiescent activity state |
| P1 | compat wrapper retries today's non-idempotent admission callback after an ambiguous crash | named at-most-once legacy level inside in-flight boundary; MIG-CORE uses strong reconcilable adapter; rename included |
| P1 | G1/AH0 implement “exact” admission types that were never declared and choose incompatible keys/effects | complete server-only effect/target/key/error/ledger declarations + transactional predecessor rules |
| P1 | legacy custom admission code cannot inhabit the closed Gateway error union, so retry loses wire fidelity or typechecks via a cast | server-only legacy failure envelope + exact alias reprojection/restart golden; public Gateway union remains closed |
| P2 | eve comparison appears as repository-verified evidence | marked owner-supplied context, not code proof |
| P2 | env sentinel is renamed as if it were a proven Host identity collision | corrected citation/meaning; inventory before any separately approved rename |
| P2 | Host/Gateway/Fastify close paths double-dispose or leak active leases | explicit preClose/drain/onClose/close ownership and idempotent lifecycle proof |
| P2 | invalid list cursors map differently across implementations | stable `AGENT_SESSION_CURSOR_INVALID`; expiry remains separately recoverable |
| P2 | public session summary appears to promise unspecified recovery metadata | metadata explicitly stays in internal activity/checkpoint records |

### Review status

| Round | Reviewer | Verdict | Material disposition |
| --- | --- | --- | --- |
| D0 | prior partial reviewer | **TOOL FAIL / INVALID** | Quota crash left a 292-line truncated draft and unsupported READY claims; draft was audited, correct status/receipt/queue intent retained, invented deletions/placeholders discarded. |
| AR-R1 | independent contract/wire reviewer | **NOT READY** (7 P1, 3 P2) | Found forgeable scope, invalid idempotency/send/lifecycle/status and false wire mapping; fixed in §6. |
| AR-R2 | independent factory/Core reviewer | **NOT READY** (2 P0, 7 P1, 1 P2) | Restored missing plan; corrected cardinality, complete funnel ownership, Core production path, async Fastify lifecycle, and legacy default. |
| AR-R3 | independent citation/boundary reviewer | **NOT READY** (7 P1, 3 P2) | Corrected source claims, H0/A0 gate, v0/v2 mismatch, plugin trust, cardinality and wire realism. |
| CR-R4 | fresh contract/wire reviewer | **NOT READY** (6 P1) | Replaced front state with snapshot DTO, added runtime scope provenance, target/in-flight ledger, Workspace-only session authority, JSON-safe events, and exact command matrix/mapping. |
| CR-R5 | fresh factory/Core reviewer | **NOT READY** (6 P1, 2 P2) | Restored request-aware filesystem policy/effect admission, target keying, legacy prompt sentinel, same-Workspace multi-actor proof, split server/shared types, and lifecycle ownership. |
| CR-R6 | fresh citation/boundary reviewer | **NOT READY** (3 P1, 3 P2) | Preserved idle follow-up, legacy transcript path, native rename seam; clarified snapshot/content-addressing/spec trust. |
| CR-R7 | fresh contract/wire reviewer | **NOT READY** (4 P1, 2 P2) | Added complete storage-scope mapping, session-pinned writer lease, event seq equality, mandatory durable ledger default and validation rejection proof. |
| CR-R8 | fresh contract/wire reviewer | **NOT READY** (1 P1, 3 P2) | Added terminal admission rejection, selector precedence, retention-scoped create guarantee, and verifier terminology. |
| CR-R9 | fresh factory/Core reviewer | **NOT READY** (5 P1, 3 P2) | Made admission crash-safe/idempotent, trusted storage mapping explicit, reconciled wrapper/native rename, bounded drain, preserved all legacy path branches; added stable Host ID, command re-verification, and focused rename capability. |
| CR-R10 | fresh citation/boundary reviewer | **NOT READY** (3 P1, 2 P2) | Added stable pagination/v2 status amendment, canonical shared Environment lease, frozen pre-serve fleet compilation and configured prompt precedence; clarified verified claims and Host ID. |
| CR-R11 | fresh factory/Core reviewer | **NOT READY** (2 P1, 3 P2) | Added app-owned fleet compiler input and Environment-owned provisioning generations; made Host identity root explicit, fenced forced shutdown, and made linked transcript rename cross-process deterministic. |
| CR-R12 | fresh citation/boundary reviewer | **NOT READY** (1 P1, 3 P2) | Replaced unsafe timestamp watermark with retained immutable snapshot projections; moved default-Agent validation to route-plugin construction and required live membership/revocation checks. All citations remained valid. |
| CR-R13 | fresh factory/Core reviewer | **NOT READY** (1 P1, 3 P2) | Defined exact at-most-once legacy admission mapping while MIG-CORE adopts strong adapter; added rename admission, compiler-output invariants, exact Environment and legacy-path proof. |
| CR-R14 | fresh citation/boundary reviewer | **NOT READY** (2 P1, 1 P2) | Scope/filter-bound authenticated snapshots, crash reconciliation for activity index, and explicit durable accept-all omission behavior. Citations remained valid. |
| CR-R15 | fresh factory/Core reviewer | **READY** (0 P0, 0 P1, 1 P2) | Strong/legacy admission, fleet, Environment, paths, rename, activity and lifecycle are executable; additive Core option named in final polish. |
| CR-R16 | fresh citation/boundary reviewer | **READY** (0 P0, 0 P1, 2 P2) | Contract/wire/boundary/citations all ready; final polish named invalid-list-cursor code and internal recovery metadata. |
| CR-R17 | fresh factory/Core reviewer | **NOT READY** (1 P1) | Found undefined exact admission/ledger types; added the full effect union, target/key/error DTO, record union and ledger operations, including rename/delete conformance. |
| CR-R18 | fresh citation/boundary reviewer | **READY** (0 P0, 0 P1) | P2 polish introduced no regressions and every citation remained valid; streak reset by CR-R17's material finding. |
| CR-R19 | fresh factory/Core reviewer | **NOT READY** (1 P1) | Found legacy custom admission errors outside the closed Gateway union; added server-only legacy failure persistence and exact alias replay. |
| CR-R20 | fresh citation/boundary reviewer | **NOT READY** (1 P1, 1 P2) | Confirmed the same compatibility failure and missing predecessor rules; added exact transactional transition table and supporting current-test citation. |
| CR-R21 | fresh factory/Core reviewer | **READY** (0 P0, 0 P1) | Exact admission types, legacy error replay, transition graph, production funnel, fleet, Environment and lifecycle are executable. |
| CR-R22 | fresh citation/boundary reviewer | **READY** (0 P0, 0 P1, 1 P2) | Exact contract and all citations validated. Non-blocking note: addressed reads of a legacy-only terminal record must use a closed Gateway error and never leak its custom code. |
| O-R23 | owner descope pass (2026-07-23) | **ADJUSTED — READY for H0** | Retained every code-grounded correction (wire, cardinality, legacy paths, send semantics, v2 wording, scope capability, Environment lease, fleet compilation, admission levels). Moved four remote-grade durability sets to their owning lanes with interfaces unchanged: durable request ledger + crash/restart matrix and durable activity index → Level D/streaming lane; snapshot-registry pagination → v2 pool cursor (optional early streaming adoption); recursive runtime event validation → v2 remote wire; cross-process rename journaling dropped in favor of newest-wins through the existing append path. Deltas are marked "owner descope 2026-07-23" in §6/§8/§10; not re-reviewed (risk 5), gated by H0. |
| DS-R1 | fresh sol xhigh — descope verification + plugin-model coherence | **NOT READY** (9 P1, 1 P2) | Level-B honesty: HTTP callers survive restart, so create-retention/legacy-replay/drain promises are level-scoped with documented degradation; pagination conformance split B/D; keyset cursors valid under mutation (empty page, not CURSOR_INVALID); dangling G1/§10 validator requirements removed; Level-D upgrade boundary defined; automation saga restart ambiguity made terminal (no auto-redispatch); rename gains deterministic total order + convergence-at-next-rename; PL1 full digest → runtime identity while provisioningFingerprint stays environment-only; companion v0 obligations anchored into §8/§10 and beads; §13 preamble marks pre-descope dispositions. |
| DS-R2 | same reviewer, fresh re-read | **NOT READY** (3 P1) | Validator scope added to v2 bead acceptance; full PL1 identity coverage moved into plan §6.10/§10 with a change-detection fixture; canonical-ID preflight relocated app-side (plugin resolver, before collection; fleet compiler consumes validated IDs). |
| DS-R3 | same reviewer, fresh re-read | **READY for H0** | "No P0/P1 findings in plan §6.10, §8 AH0.3, §10, or bead .11; the three prior gaps are coherently closed with testable acceptance coverage." |
