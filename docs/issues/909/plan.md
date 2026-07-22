---
github: https://github.com/hachej/boring-ui/issues/909
issue: 909
state: ready-for-review
updated: 2026-07-22
track: owner
parent: 905
---

# gh-909 AgentGateway v0 — the definitive gateway plan

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

**Trust ladder (eve-verified 2026-07-22).** vercel/eve confirmed the top tier:
eve trusts author tool code because every agent is its own deployment; only
model-generated code is sandboxed (per-session microVM; credentials injected at
the sandbox network firewall, never inside). Our tiers:

1. **Spec-only customization** — instructions/selections/config: inert data,
   shared host, ~free. Most custom agents forever.
2. **Own pushed host** (= eve's model exactly): author code trusted inside the
   author's own artifact; ships first among custom-code tiers (v2).
3. **Shared host + sandbox-executed author tools** — our extension beyond eve;
   a density/economics play, reserved until marketplace demand (§9).

**Third-party consumption topology (owner-ratified).** "Own host" means the
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
  `createAgentApp.ts:272-276`) exists nowhere.
- **Four consumer surfaces today** (see §5 fate table): construction (above);
  `Agent.send/stream` facade + `AgentLiveEventBuffer`
  (`core/createAgent.ts`, callers: `workspaceAgentDispatcher.ts`,
  `mcp/managedAgentDelegate.ts`); `HarnessPiChatService` (chat HTTP routes);
  `PiSessionStore` (session CRUD, local JSONL under
  `BORING_AGENT_SESSION_ROOT`).
- **Streaming**: browser transport is NDJSON over chunked HTTP
  (`piChat.ts:184-264`) against the in-memory `PiChatReplayBuffer`
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
- **Naming collision**: `AgentHost`/`BORING_AGENT_HOST_ID` in
  `packages/core/src/server/config/loadConfig.ts:117-123` means
  deployment/trusted-proxy identity.
- **Agent package dependency direction is already clean** (no deps on
  workspace/core), so contract and factory can live there without new edges.

## 4. Agent-first principle (every lane preserves)

1. **Placement-independent identity.** `agentTypeId` is a binding name for a
   content-addressed authored definition (catalog lane digest), never a host
   slot. `AgentSummary` carries definition version/digest once the catalog
   lane lands.
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

All types live in `packages/agent/src/shared/gateway/` (DTO-only module: no
`node:*`, no `Buffer`, no Fastify/Pi/React imports — existing shared
invariants apply). Everything is structurally serializable; a lint/type test
rejects functions, class instances, `Date`, and cyclic types in any gateway
DTO.

### 6.1 Identity and scope

```ts
/** Opaque workspace scope. v0: the existing workspace id string. */
type WorkspaceScopeId = string

interface AuthorizedAgentScope {
  readonly workspaceScopeId: WorkspaceScopeId
}

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
  readonly status: 'running' | 'idle' | 'completed' | 'failed' | 'needs-input'
  readonly createdAt: number
  readonly updatedAt: number
}

interface AgentSessionPage {
  readonly sessions: readonly AgentSessionSummary[]
  readonly nextCursor?: string
}
// Total order: updatedAt DESC, agentTypeId ASC, sessionId ASC.
// (hostId joins the tuple in v2 per #905; unchanged consumer semantics.)

interface CreateAgentSessionInput extends AuthorizedAgentScope {
  readonly agentTypeId: string
  readonly requestId: string         // caller-generated idempotency key
  readonly title?: string
}
// Same requestId ⇒ same AgentSessionRef; never a second transcript.

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

### 6.4 Connection, events, commands

```ts
interface ConnectAgentSessionInput extends AuthorizedAgentScope {
  readonly ref: AgentSessionRef
  readonly cursor?: number           // resume seq; omit = from live edge
}

interface AgentSessionEvent {
  readonly ref: AgentSessionRef
  readonly seq: number               // monotonic per session
  readonly event: PiChatEvent        // existing payload union, unchanged
}
// 391 decision 1 holds: PiChatEvent stays the payload; the envelope adds
// ref + seq. No parallel event union.

interface AgentSessionConnection {
  readonly ref: AgentSessionRef
  readonly events: AsyncIterable<AgentSessionEvent>
  send(input: IdempotentAgentSend): Promise<void>
  interrupt(input: IdempotentAgentControl): Promise<void>
  stop(input: IdempotentAgentControl): Promise<void>
  close(): Promise<void>             // unsubscribe only, never implicit stop
}

interface IdempotentAgentSend {
  readonly requestId: string
  readonly content: string
  readonly inputAssets?: readonly AgentInputAssetRef[]
}
interface IdempotentAgentControl {
  readonly requestId: string
}
```

### 6.5 State snapshot (the Level-B recovery contract)

```ts
interface ReadAgentSessionStateInput extends AuthorizedAgentScope {
  readonly ref: AgentSessionRef
}
interface AgentSessionStateSnapshot {
  readonly ref: AgentSessionRef
  readonly seq: number               // snapshot is consistent as of this seq
  readonly summary: AgentSessionSummary
  readonly state: PiChatState        // existing state shape, unchanged
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

### 6.7 Stable errors

Every rejection is an `AgentGatewayError { code, message, details? }` with a
stable code:

| Code | Meaning |
| --- | --- |
| `AGENT_TYPE_UNKNOWN` | `agentTypeId` not in this gateway's catalog |
| `AGENT_SESSION_NOT_FOUND` | ref unknown **or** scope mismatch (fail closed; indistinguishable by design) |
| `AGENT_SCOPE_DENIED` | caller's scope failed authorization |
| `AGENT_SESSION_REPLAY_GAP` | requested cursor evicted; recover via `readSessionState` then reconnect at snapshot `seq` |
| `AGENT_SESSION_CURSOR_AHEAD` | cursor beyond live edge (client bug / stale ref) |
| `AGENT_REQUEST_CONFLICT` | same `requestId` re-used with different payload digest |
| `AGENT_SESSION_TERMINAL` | send/control on a completed/failed session |
| `AGENT_GATEWAY_CLOSED` | gateway/host shutting down; retry after reconnect |

### 6.8 Conformance levels

- **Level B (v0 embedded)** — bounded replay: `connectSession(cursor)` replays
  only within the live buffer; gaps yield `AGENT_SESSION_REPLAY_GAP`;
  `readSessionState` + reconnect-at-`seq` is the documented recovery loop.
- **Level D (after streaming lane)** — durable offsets: any historical cursor
  catches up then tails; process restart preserves seq continuity;
  `REPLAY_GAP` only after explicit retention truncation.

The conformance suite (`agent-host/testing/gatewayConformance.ts`) is
parameterized over a gateway factory and asserts: idempotent create/send/
control (same id ⇒ same outcome; conflicting digest ⇒ `AGENT_REQUEST_CONFLICT`),
scope fail-closed on every method, close-is-unsubscribe (session keeps
running), monotonic `seq` with no duplicates at Level D and documented-gap at
Level B, pagination total order, snapshot-seq consistency
(`readSessionState().seq` ≥ any event already yielded). Level D cases ship
skipped with the streaming lane named as owner.

### 6.9 `AgentHostAgentSpec` (agent vs host split)

Litmus test per field: *could it safely appear in a file a third party pushes
to the cloud?* Yes → spec; no → host option.

```ts
interface AgentHostAgentSpec {
  readonly agentTypeId: string
  readonly definition: {             // portable core; catalog lane makes it
    readonly instructions: string    // content-addressed AuthoredAgentSource
    readonly label: string
    readonly version?: string
  }
  /** SELECTION by name from the host's loaded pool + config DATA. Never code,
      paths, or secrets. */
  readonly plugins?: readonly { readonly name: string; readonly config?: JsonValue }[]
  /** POLICY by name. Never keys. */
  readonly model?: { readonly preferred?: string; readonly maxTokensPerTurn?: number }
}
```

Host options (mechanism + custody — never in the spec): plugin **loading**
(dirs/managers), model **credentials/providers**, `sessionRoot` (host
namespaces per `agentTypeId` internally), `runtimeModeAdapter`/`runtimeHost`,
`auth`.

### 6.10 `createAgentHost()`

```ts
interface CreateAgentHostOptions {
  readonly agents: readonly AgentHostAgentSpec[]
  readonly runtimeModeAdapter: RuntimeModeAdapter   // now agent-package-owned
  readonly runtimeHost?: RuntimeHostOperations      // default in-package
  readonly sessionRoot?: string                     // BORING_AGENT_SESSION_ROOT default
  readonly plugins?: AgentHostPluginInput           // loading side (dirs/manager)
  readonly auth?: AgentHostAuthOptions
  readonly modelConfig?: AgentHostModelOptions
  readonly dispatcherHooks?: WorkspaceAgentDispatcherResolver
}

interface AgentHostHandle {
  readonly hostId: string            // stable logical id (v2 routing seed)
  describe(): Promise<AgentHostDescription>
  drain(): Promise<void>
  close(): Promise<void>
}

function createAgentHost(options: CreateAgentHostOptions): {
  host: AgentHostHandle
  gateway: AgentGateway              // the embedded implementation
  registerRoutes(app: FastifyInstance): void   // HTTP projection mount
}
```

Session namespacing: sessions store `agentTypeId` + `workspaceScopeId`
metadata and are laid out per agent type under `sessionRoot` so a later 1:1
re-hosting of one agent carves out cleanly.

### 6.11 HTTP projection (wire compatibility)

`registerRoutes` mounts the browser projection. Existing wire stays
byte-compatible; multi-agent addressing is added:

| Route (target) | Gateway call | Compat |
| --- | --- | --- |
| `GET  /api/v1/agents` | `listAgents` | new |
| `GET  /api/v1/agents/:agentTypeId/sessions` | `listSessions` | new addressing; legacy unprefixed session list aliases to the default agent during migration |
| `POST /api/v1/agents/:agentTypeId/sessions` | `createSession` | idempotency via `requestId` body field |
| `GET  …/sessions/:sessionId/stream?cursor=` | `connectSession` | same NDJSON framing + 409 replay-gap/cursor-ahead semantics as today |
| `GET  …/sessions/:sessionId/state` | `readSessionState` | same payload as today's state route |
| `POST …/sessions/:sessionId/send` \| `interrupt` \| `stop` | connection commands | same bodies + `requestId` |
| `PATCH/DELETE …/sessions/:sessionId` | `renameSession`/`deleteSession` | same |

Legacy route aliases are registered by the compat wrappers and removed only at
contraction (H2c discipline).

---

## 7. Consumer alignment

Each consumer ends as an explicit composition root: one `createAgentHost()`
call, gateway injected, zero agent-internal or provider imports.

| Consumer | Today (verified) | Target composition | Lane |
| --- | --- | --- | --- |
| **workspace app server** (`createWorkspaceAgentServer.ts`) | imports `createAgentApp`, `provisionWorkspaceRuntime`, `VERCEL_SANDBOX_WORKSPACE_ROOT`; builds mode adapter locally | receives `{ gateway, registerRoutes }` from the caller or calls the factory; session/chat routes delegate to gateway; **zero sandbox-provider imports** | MIG-WS |
| **core server** (`createCoreWorkspaceAgentServer.ts`) | hand-assembles `registerAgentRoutes` + plugins + auth + adapters | calls `createAgentHost({ agents, plugins: corePluginManager, auth: coreAuth, modelConfig: vaultKeys, sessionRoot: '/data/pi-sessions', … })`; keeps core-owned auth/DB/tenancy wrapped around it | MIG-CORE (heaviest; starts with assembly diff-audit) |
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

### Step G1 — contract + conformance (sequential, first)

1. Create `packages/agent/src/shared/gateway/{types,errors,events}.ts` with
   §6.1–6.8 exactly; export via `@hachej/boring-agent/shared`.
2. Add DTO-discipline guard: type-level test rejecting
   functions/classes/`Date`/Node types in gateway DTOs + shared-invariant
   lint (no `node:*`, no `Buffer`).
3. Create `packages/agent/src/server/agent-host/testing/gatewayConformance.ts`
   — suite of §6.8, parameterized over `() => Promise<AgentGateway>`; Level D
   cases skipped with owner annotation.
4. Proof: typecheck + conformance suite compiles against a throwaway in-memory
   fake. No runtime behavior changed anywhere.

### Step AH0 — factory + embedded gateway (sequential, second)

1. **Assembly diff-audit** (feeds options): table of everything
   `createAgentApp`, `registerAgentRoutes`, and core's hand-assembly each
   construct (harness, bridge, tools, auth, routes, provisioning, session
   wiring). Every row maps to a `CreateAgentHostOptions` field or an explicit
   "stays app-side" disposition. Core's rows are mandatory — it is the
   production path.
2. Implement internal `buildAgentComposition()` in
   `packages/agent/src/server/agent-host/` — the single construction sequence
   (harness → bridge → chat service → session store → tools), extracted from
   the two constructors.
3. Implement `createAgentHost()` per §6.10 over it; multi-agent: one
   composition per `AgentHostAgentSpec`, per-agent session namespace, catalog
   from specs.
4. Rewire `createAgentApp` and `registerAgentRoutes` as **delegating compat
   wrappers** over the factory (signatures unchanged; their existing test
   suites must pass unmodified — that is the non-regression proof).
5. Implement `EmbeddedAgentGateway` over the composition (chat service +
   session store); pass conformance Level B.
6. Implement `registerRoutes` HTTP projection per §6.11; legacy aliases via
   the wrappers; existing front E2E flows pass unchanged.
7. Relocate `createSandboxRuntimeModeAdapter` + `sandboxRuntimeHostOperations`
   from workspace → agent package; leave workspace re-export shims.
8. Resolve naming collision: new service types own `AgentHost*`; core's
   config concept renamed (recommend `BORING_DEPLOYMENT_HOST_ID` with env
   alias for the old name).
9. Proof: full agent-package suites + conformance Level B + a new two-agent
   fixture (two `AgentHostAgentSpec`s, sessions created/listed/streamed on
   both through one gateway).

### Step MIG-* — consumer lanes (parallel after AH0)

Each lane: swap construction to the factory / consumption to the gateway,
delete the direct imports its row in §7 names, keep its existing suites green,
add the alignment lint for its package. MIG-CORE additionally starts by
re-validating the AH0 diff-audit against its assembly and extending factory
options if a gap surfaces (option additions are additive; no consumer-visible
change).

### Follow-up lanes (separate issues, unblocked by this plan)

1. **Streaming** (first): wire `SqliteEventStreamStore` into
   `buildAgentComposition`, unconditional durable append, offset reconnect,
   collapse `AgentLiveEventBuffer`; flip conformance to Level D.
2. **Catalog revival**: `AgentHostAgentSpec.definition` backed by
   `materializeAgentDirectory`/digests; `AgentSummary.definition` populated.
3. **#861**: remove Bash/Sandbox→Agent back-edges (required before v2 package
   qualification, not before v0).
4. **v2 remote** (#905): tracer (one host, service auth, send+events) → then
   grants/pool/placement hardening; `RemoteAgentGateway` implements §6.6
   unchanged.

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
- [ ] `createAgentHost()` is the only construction implementation;
      `createAgentApp`/`registerAgentRoutes` delegate (their suites pass
      unmodified).
- [ ] Two agent types served by one process through one gateway with
      independent session namespaces (fixture).
- [ ] All §7 consumers aligned; alignment lints active per package.
- [ ] agent-playground has no `@hachej/boring-workspace` import.
- [ ] Browser wire unchanged except `agentTypeId` addressing; legacy aliases
      in place.
- [ ] Naming collision resolved and recorded.
- [ ] No gateway DTO contains `hostId`, provider values, paths, or live
      objects (lint).
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
