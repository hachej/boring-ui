---
github: https://github.com/hachej/boring-ui/issues/909
issue: 909
state: draft
updated: 2026-07-22
track: owner
parent: 905
---

# gh-909 AgentGateway v0 — session gateway contract + canonical host construction

This is the execution spine extracted from #905. It is deliberately narrow: the
grunt work that, once landed, turns every remaining #905 concern into an
independent parallel lane behind a frozen contract. #905 remains the
architecture authority; this plan changes no ownership decision ratified there.

## Owner decisions this plan executes (2026-07-22)

1. **v0 is embedded multi-agent in one process; the distinct remote Agent Host
   is v2.** No remote protocol, grants, pool, or placement machinery in v0.
2. **Priority 1 is the interface, not the internals.** Freeze the smallest
   honest gateway contract; wrap today's internals with a facade; migrate
   consumers; let cleanup run behind it asynchronously.
3. **The three divergent construction paths are standardized** behind one
   canonical `createAgentHost()` factory. This is in scope here, because
   without it the facade would just hide three bespoke constructions.
4. **Durable streaming, definitions/catalog revival, #861, and v2 remote are
   follow-up lanes**, not part of this issue. Streaming is the first async
   lane after this lands (activating the dormant `SqliteEventStreamStore`).
5. **Third-party agents = pushed Host artifacts (v2+); first-party agents get
   the revived definition/digest machinery as catalog format.** v0 only keeps
   the door open: the contract must never leak process-coupled values.

## Verified current state (2026-07-22 code verification)

- **No interface exists today — consumers construct agents.** Three divergent
  paths:
  - `packages/workspace/src/app/server/createWorkspaceAgentServer.ts` (~1027
    lines): imports `createAgentApp`, `provisionWorkspaceRuntime`, picks
    sandbox providers (`VERCEL_SANDBOX_WORKSPACE_ROOT`), builds its own
    runtime-mode adapter via `./sandboxRuntimeHost`.
  - `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts` (~1139
    lines): the real production host; bypasses `createAgentApp` and
    hand-assembles `registerAgentRoutes` + plugins + auth + adapters.
  - `packages/cli/src/server/modeApps.ts` (~1041 lines): dynamically imports
    both packages and calls Workspace's
    `createSandboxRuntimeModeAdapter(...)` to feed Agent's own provisioning.
- **Two parallel duplicated constructors inside the agent package**:
  `createAgentApp.ts` (~478 lines) and `registerAgentRoutes.ts` (~1474 lines)
  each independently build harness + bridge + tools; neither calls the other.
- **Reverse dependency**: `apps/agent-playground/src/server/index.ts` imports
  `createSandboxRuntimeModeAdapter`/`sandboxRuntimeHostOperations` from
  `@hachej/boring-workspace/app/server`.
- **The seam the code comments promise does not exist**:
  `createWorkspaceAgentApp()` (named in `createAgentApp.ts:272-276`) has no
  implementation anywhere.
- **Replay reality**: the live browser path runs on the in-memory
  `PiChatReplayBuffer`; `AgentLiveEventBuffer` re-buffers it for delegation
  callers; the transactional SQLite `EventStreamStore` is fully built, tested,
  and has zero production wiring; durable truth is Pi JSONL only. Reconnect
  after restart is a 409 → full state rehydrate, not offset catch-up.
- **Naming collision**: `AgentHost`/`BORING_AGENT_HOST_ID` already means
  deployment/trusted-proxy identity in `packages/core` config
  (`loadConfig.ts:117-123`).
- **Agent package dependency direction is already clean** (no deps on
  workspace/core), so the factory and contract can live there without new
  edges.

## Relation to existing surfaces (why a "new" interface)

Today the agent package exposes four consumer surfaces, grown one consumer at
a time. This plan does not add a fifth; it reduces four to two, both cleanups
of surfaces that already exist:

| Today | Consumers | Fate |
| --- | --- | --- |
| `createAgentApp` + `registerAgentRoutes` (construction) | workspace app server, core server, CLI, playground | → **`createAgentHost()`** — the build interface (AH0); old exports become compat wrappers |
| `Agent.send/stream` facade + `AgentLiveEventBuffer` (`core/createAgent.ts`) | `workspaceAgentDispatcher`, `managedAgentDelegate` | → **`AgentGateway`** — the talk interface. The facade was already an attempt at a clean programmatic surface; it failed by wrapping the engine and adding a second in-memory buffer. The gateway is this surface rebuilt with correct grammar (DTOs, scope, addressing, idempotency). After its two callers migrate (MIG-DEL), the facade and the duplicate buffer are deleted under compat/contraction discipline. |
| `HarnessPiChatService` (live engine) | chat HTTP routes | internal engine behind the gateway. Must not be the contract: the streaming lane replaces its buffer with the durable store, and that swap must be invisible to consumers. |
| `PiSessionStore` (storage) | session listing/CRUD | internal storage behind the gateway. |

End state: **two public surfaces — build (`createAgentHost`) and talk
(`AgentGateway`)** — engine and storage are internals.

## Agent-first principle (host stays invisible)

The agent is the semantic entity; the host is physical infrastructure. Three
commitments every lane must preserve:

1. **Placement-independent agent identity.** `agentTypeId` is a binding name
   for a content-addressed authored definition (catalog lane digest), never a
   host slot. `AgentSummary` carries definition version/digest. The same
   agent entity may run embedded, on a shared managed host, or on a dedicated
   host without identity change.
2. **Isolation cardinality is deployment policy.** Shared host (N agents : 1
   process) and dedicated host (1:1) run the same `AgentHostAgentSpec`
   through the same gateway. v0 must not preclude the 1:1 setting: per-agent
   session namespaces, no cross-agent state in specs, no host-scoped identity
   in DTOs. Explicit limit: v0 shared-host isolation between agents is
   logical only (one process, one key custody) — sufficient for first-party
   agents, never to be presented as security isolation; hard isolation is the
   dedicated-host tier (v2, and the pushed-artifact case).
3. **The console never shows hosts.** All consumer/product surfaces (agent
   lists, sessions, orchestration) are agent-first; hosts appear only in
   operator diagnostics.

## The contract (G1-lite)

One server-side TypeScript interface in `@hachej/boring-agent/shared` (types)
plus `@hachej/boring-agent/server` (embedded adapter). Session surface only —
no `files`, no `pluginAssets`, no egress handler in v0. Those cross the
gateway only when the host leaves the process (v2); Workspace keeps its
current in-process file routes untouched.

```ts
interface AgentGateway {
  listAgents(input: AuthorizedAgentScope): Promise<AgentSummary[]>
  listSessions(input: AuthorizedAgentSessionQuery): Promise<AgentSessionPage>
  createSession(input: CreateAgentSessionInput): Promise<AgentSessionRef>
  connectSession(input: ConnectAgentSessionInput): Promise<AgentSessionConnection>
  readSessionState(input: ReadAgentSessionStateInput): Promise<AgentSessionStateSnapshot>
  close(): Promise<void>
}

interface AgentSessionRef {
  readonly agentTypeId: string
  readonly sessionId: string
  // hostId reserved for v2; absent or constant in v0
}

interface AgentSessionConnection {
  readonly ref: AgentSessionRef
  readonly events: AsyncIterable<AgentSessionEvent> // PiChatEvent envelope preserved
  send(input: IdempotentAgentSend): Promise<void>
  interrupt(input: IdempotentAgentControl): Promise<void>
  stop(input: IdempotentAgentControl): Promise<void>
  close(): Promise<void> // unsubscribe only, never implicit stop
}
```

Rename/delete session ride along as part of the session surface (they exist
today and Workspace lists/renames sessions); they are DTO-in/DTO-out like
everything else.

### Contract discipline (the one non-negotiable)

Everything crossing the interface is **DTOs + async + idempotent**. No live
service objects, Fastify/Pi/React values, raw roots, provider handles, or
process-coupled references may appear in any gateway type. This is the single
property that makes the v2 `RemoteAgentGateway` an adapter instead of a
Workspace rewrite, and it is enforced by a type-level lint/test in the
conformance suite.

### Conformance levels (so today's internals can implement it honestly)

The events contract specifies **two documented conformance levels**:

- **Level B (bounded replay + snapshot rehydrate)** — what the current
  in-memory `PiChatReplayBuffer` provides: cursor replay within the live
  buffer; on gap/restart the connection surfaces a typed replay-gap and the
  consumer recovers via `readSessionState`. The v0 embedded facade ships at
  Level B.
- **Level D (durable offset catch-up)** — offsets survive process restart;
  reconnect catches up then tails. The streaming lane upgrades the embedded
  implementation to Level D **without changing the contract**.

The conformance suite runs against both levels; Level D cases are marked
pending until the streaming lane lands.

## Front and server: one contract, one projection

There is one designed interface — the server-side `AgentGateway`. The browser
never holds it.

1. **Server code** (workspace server, orchestration, route handlers) consumes
   the injected `AgentGateway`.
2. **The browser keeps talking HTTP/NDJSON to the workspace origin exactly as
   today.** The existing pi-chat/session routes become thin handlers that call
   the gateway instead of closed-over agent internals. The HTTP surface is the
   *projection* of the gateway — it already exists and stays wire-compatible.
   `PiChatEvent → reducer → BoringChatMessage` is untouched (391 decision 8
   insulation holds).
3. **Front components** (PiChatPanel, session hooks, reducers) are unchanged.
   The only v0 front change is **multi-agent addressing**: session refs carry
   `agentTypeId`, routes gain an agent segment, the front transport threads it
   through. Mechanical.

In v2 the browser still talks only to the workspace origin; route handlers
swap the embedded facade for the remote client. The browser cannot tell the
difference — which is also the security model (the control plane authorizes
everything; the browser never reaches a host directly).

## AH0 — canonical `createAgentHost()`

One factory in `@hachej/boring-agent/server` becomes the only way to obtain
an agent composition. Its typed options are the official statement of what a
host needs:

```ts
interface CreateAgentHostOptions {
  agents: AgentHostAgentSpec[]        // one or more agent types (catalog input)
  runtimeModeAdapter: RuntimeModeAdapter
  runtimeHost: RuntimeHostOperations
  sessionRoot?: string                 // BORING_AGENT_SESSION_ROOT default
  plugins?: AgentHostPluginInput
  auth?: AgentHostAuthOptions
  modelConfig?: AgentHostModelOptions
  dispatcherHooks?: WorkspaceAgentDispatcherResolver
}
createAgentHost(options): { host: AgentHostHandle; gateway: AgentGateway; registerRoutes(app): void }
```

### `AgentHostAgentSpec` — the per-agent/host split

Litmus test for every field: *could it safely appear in a file a third party
pushes to the cloud?* Yes → agent spec; no → host option.

- **Agent spec (identity + policy, pure data):** `agentTypeId`; authored
  `definition` (instructions/label/version — the portable core the catalog
  lane makes content-addressed); `plugins` as **selection by name** from the
  host's loaded pool; `model` as **policy by name** (preferred model, limits).
- **Host options (mechanism + custody):** plugin **loading** (dirs, discovery,
  managers); model **credentials/providers**; `sessionRoot` (host namespaces
  per `agentTypeId` internally); `runtimeModeAdapter`/`runtimeHost`; `auth`.

No credential, filesystem path, adapter, or live object may appear in an
agent spec — the spec is exactly what must remain portable across embedded,
managed-host, and future pushed-artifact deployments.

Scope of AH0:

- **Funnel the duplicated constructors.** `createAgentApp` and
  `registerAgentRoutes` are reconciled into one internal construction path the
  factory owns. Both existing exports remain as thin compatibility wrappers
  over the factory until H2c-style contraction (no deletion in this issue).
  This is the heaviest single work item in v0.
- **Multi-agent in one process.** `agents: AgentHostAgentSpec[]` makes the
  factory natively multi-agent: N agent types, one process, one session store
  namespace per agent type, one gateway. This is the v0 product goal.
- **Mode-adapter ownership moves Workspace → Agent.**
  `createSandboxRuntimeModeAdapter` and `sandboxRuntimeHostOperations`
  relocate into the agent package (per #905 owner decision 5: Agent execution
  owns Environment mechanics). Workspace/CLI/playground import them from
  Agent; Workspace re-exports temporarily for compatibility.
- **Naming collision resolved.** The factory's host handle must not be named
  `AgentHost` bare, or core's `BORING_AGENT_HOST_ID` concept must be renamed —
  decide in the first PR and record in the glossary. Recommendation: keep
  `AgentHost` for the new service concept (it matches #905's glossary) and
  rename core's config concept to `BORING_DEPLOYMENT_HOST_ID` with an env
  alias.
- **`EmbeddedAgentGateway`** wraps the factory output. It is the facade over
  today's `HarnessPiChatService` + `PiSessionStore` behavior — no behavior
  change, Level B conformance.
- **Naming is settled; do not re-litigate in lanes.** Types carry full names
  (`AgentHost`, `AgentGateway`); destructured members are short (`host`,
  `gateway`, `registerRoutes`) since the factory origin disambiguates. The
  talk handle is **not** named `Agent`: "Agent" is the normative #905 glossary
  term for the authored composition (identity/instructions/plugins), the
  gateway fronts *all* agent types (plural), and the existing `Agent` facade
  being deleted by MIG-DEL must remain grep-unambiguous during coexistence.
  The mount function is **not** named `registerAgentRoutes`: that export
  already exists as the legacy constructor/compat wrapper and both are
  importable until contraction. Optional ergonomics later: a scoped
  per-agent-type handle (`gateway.agent(agentTypeId)`) may be added as sugar
  over the same contract.

## Lanes

Sequential spine (this issue):

| Slice | Delivers | Proof |
| --- | --- | --- |
| **G1-lite** | Gateway DTO/contract types, conformance suite (Level B green, Level D pending), DTO-discipline lint | contract tests; no runtime change |
| **AH0** | `createAgentHost()` funnel, multi-agent specs, `EmbeddedAgentGateway`, mode-adapter relocation, naming resolution, compat wrappers | existing agent test suites + conformance suite green through the factory path |

Parallel consumer migrations (dispatch after AH0, independent of each other):

| Lane | Delivers | Proof |
| --- | --- | --- |
| **MIG-WS** | `createWorkspaceAgentServer` consumes factory + injected gateway; stops importing sandbox providers/`createAgentApp` directly | workspace app tests, playground smoke |
| **MIG-CORE** | `createCoreWorkspaceAgentServer` consumes factory; hand-assembly of `registerAgentRoutes` removed | core server tests, full-app smoke; heaviest lane — the production path |
| **MIG-CLI** | `modeApps.ts` composes factory directly; no Workspace reach-through for Agent adapters | CLI mode smokes with workspace/core absent |
| **MIG-PG** | agent-playground drops the backward Workspace import | playground boots from agent-package exports only |
| **MIG-DEL** | `workspaceAgentDispatcher` + `managedAgentDelegate` consume the gateway; `Agent.send/stream` facade and `AgentLiveEventBuffer` become compat wrappers (deleted at contraction) | existing delegation/dispatcher tests green through the gateway path; no second event buffer in the target path |

Follow-up async lanes (separate issues, unblocked by this one):

- **Streaming activation** — wire the dormant `SqliteEventStreamStore`,
  unconditional writes, offset reconnect, collapse `AgentLiveEventBuffer`;
  upgrades embedded gateway to Level D. First lane to dispatch.
- **Definitions/catalog revival** — `AgentHostAgentSpec` adopts the currently
  dead `materializeAgentDirectory`/digest machinery as the catalog format.
- **#861** — Agent↔Bash/Sandbox package back-edges (needed before v2 package
  qualification, not before v0).
- **v2 remote** — tracer first (one host, service auth, send+events), then
  hardening per #905 (grants, pool, placement, model proxy gated on BYOK).

## Acceptance

- [ ] `AgentGateway` types exported from `@hachej/boring-agent/shared` with no
      Fastify/Pi/React/Node-path/provider/live-object values (lint-enforced).
- [ ] Conformance suite green at Level B against `EmbeddedAgentGateway`;
      Level D cases specified and pending.
- [ ] `createAgentHost()` is the single construction funnel; `createAgentApp`
      and `registerAgentRoutes` are compatibility wrappers over it.
- [ ] One process serves ≥2 agent types with independent session namespaces
      through one gateway (the v0 multi-agent proof).
- [ ] Workspace, core, and CLI consumers construct via the factory; no direct
      sandbox-provider or agent-internal construction imports remain in their
      target paths.
- [ ] agent-playground has no `@hachej/boring-workspace` import.
- [ ] Browser wire unchanged: existing front chat/session flows pass without
      front changes beyond agentTypeId addressing.
- [ ] `AgentHost` naming collision resolved and recorded.
- [ ] All existing agent/workspace/core/CLI test suites green.

## Out of scope

- Remote protocol, grants/nonces, pool routing, placement epochs (v2, #905).
- Durable stream activation (first follow-up lane).
- Files/pluginAssets/egress gateway surfaces (cross the gateway in v2 only).
- Definitions schema changes; plugin system changes; workbench changes.
- Deletion of `createAgentApp`/`registerAgentRoutes` exports (contraction
  needs its own approval per #905 H2c discipline).
- #861 package-cycle removal.

## Risks

1. **MIG-CORE is the production path** — the hand-assembled core server has
   behavior (auth, plugin loading, DB stores) not present in `createAgentApp`;
   the factory options must be proven sufficient there before the lane starts.
   Mitigation: MIG-CORE begins with a diff-audit of core's assembly vs.
   factory options; missing options are added to AH0 before migration.
2. **Contract freeze before streaming** — mitigated by the two conformance
   levels; the contract is designed for Level D and honestly implementable at
   Level B.
3. **Compat wrappers drift** — wrappers must delegate, never fork; enforced by
   making the factory path the only construction implementation.
