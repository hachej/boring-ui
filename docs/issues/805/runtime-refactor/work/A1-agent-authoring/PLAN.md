---
github: https://github.com/hachej/boring-ui/issues/805
issue: 805
state: ready-for-agent
updated: 2026-07-20
track: owner
flag: not-needed
---

# A1 — declarative agents on one Workspace-owned multi-agent runtime

## Authority

This plan replaces every earlier A1 plan that made Core the agent composer,
introduced an authored tool catalog, or created a separate development app.
It incorporates the owner grill completed on 2026-07-20.

The durable authority is Decision 26 in [`docs/DECISIONS.md`](../../../../../DECISIONS.md).
The product sequence remains in [`docs/issues/391/plan.md`](../../../../391/plan.md).
This file owns the corrective implementation plan for #805 A1 and the Workspace ↔
Agent binding needed to consume authored agents.

### Repository status at the cutover

| Work | Actual state | Ruling |
| --- | --- | --- |
| #813 authored-source materializer | Merged to `main` | Corrective input. Preserve useful source validation. |
| #814 authored tool catalog | Merged to `main` and published in `0.1.90` | Corrective input. Owner confirmed no consumers: replace it in one reviewed R4 follow-up, without a compatibility window or dedicated `0.2.0` boundary. Do not rewrite history. |
| #815 validate CLI | Merged to `main` | Preserve the command and simplify its product contract. |
| #816 separate dev app | Open, based on #814 | Do not merge; replace with the regular server path. |
| #817 dev CLI | Open, based on #816 | Do not merge; replace with a clean launcher slice. |
| #821 conformance | Merged only into #817's feature branch | Historical evidence, not code on `main`. |
| Seneca #16 | Open | Do not merge in its current catalog-based form. |

R0 rechecked these facts in [`R0-AUDIT.md`](R0-AUDIT.md). The `0.1.90`
Agent/CLI cohort publishes #813–#815/#814 exports, errors, and validate fields.
On 2026-07-20 the owner confirmed there are no consumers and approved one
separately reviewed corrective R4 follow-up without a compatibility window or
dedicated `0.2.0` boundary. Gate
`wt-391-forward-step1a-current-xn9.1.6.3` is resolved.

## Problem

The current combined `RuntimeBinding` in
`packages/agent/src/server/registerAgentRoutes.ts` owns too much at once:

- Workspace and Sandbox creation;
- runtime provisioning and readiness;
- one Agent/harness/tool set;
- sessions and chat services;
- request/actor-sensitive cache identity;
- HTTP route binding.

That shape cannot safely express several logical agents sharing exactly one
Workspace + Sandbox. The previous A1 plan compounded the problem by proposing a
Core-owned behavior resolver, a second behavior composer, authored executable
references, and a dedicated dev app.

The product needs a smaller model:

```text
Core
  authenticates + verifies membership + persists workspaceTypeId
  └─ hands an authorized workspace context to Workspace

Workspace
  resolves static workspace-agent policy
  owns one WorkspaceRuntime
  owns lazy Map<agentTypeId, AgentBinding>
  └─ requests one typed agent from Agent

Agent
  loads and executes one requested agent type
  does not select workspace policy or create another Workspace/Sandbox
```

## Product outcome

A host can define focused agents as declarative identity/instructions plus
trusted behavior plugins:

```text
agents/<agent-type-id>/
  agent.json
  instructions.md
```

```json
{
  "schemaVersion": 1,
  "definitionId": "outreach-manager",
  "version": "1.0.0",
  "label": "Outreach manager",
  "description": "Plans and coordinates customer outreach.",
  "instructionsRef": "instructions.md"
}
```

The host supplies static executable policy:

```ts
const agentTypes = {
  "outreach-manager": {
    source: outreachManagerSource,
    pluginIds: ["company-context", "outreach"],
  },
  "company-researcher": {
    source: companyResearcherSource,
    pluginIds: ["company-context", "web-research"],
  },
} as const

const workspaceTypes = {
  "ceo-outreach": {
    defaultAgentTypeId: "outreach-manager",
    allowedAgentTypeIds: ["outreach-manager", "company-researcher"],
    workspacePluginIds: ["governance"],
  },
} as const
```

Initially, human ingress starts new sessions with only the Workspace default.
The backend nevertheless proves that both types resolve lazily to distinct
Agent singletons sharing the same WorkspaceRuntime and Sandbox.

## Locked decisions

### Ownership

1. Core owns authentication, membership, workspace persistence, and the trusted
   `workspaceTypeId` handed to Workspace.
2. Core does not load authored sources, inspect prompts/tools/skills/Pi
   resources, select an agent type, create a harness, or compose behavior.
3. Workspace owns static workspace-agent policy, WorkspaceRuntime lifecycle,
   plugin grouping, default/session agent resolution, and the typed singleton
   map.
4. Agent owns loading and executing exactly one requested agent type using a
   Workspace-supplied runtime.
5. The host application declares domains and both Core/Workspace inputs. Core
   executes trusted hostname normalization and resolves the expected
   `workspaceTypeId`; Workspace owns only type → agent policy. A host-composition
   validator cross-checks those two graphs before serving. Trusted plugins
   implement behavior but cannot add themselves to product policy.

### Runtime and identity

6. One logical agent singleton exists per `(workspaceId, agentTypeId)`.
7. One WorkspaceRuntime, including one Workspace + Sandbox pair, exists per
   `workspaceId` in a host. `workspaceId` is the sole cache identity; changing
   root, runtime mode, template, provisioning, or other workspace-static input
   while it is live is a configuration mismatch, not permission to create a
   second pair. Every agent receives the same object identities and trust domain.
8. Agent type is a behavior boundary, not a filesystem/process/security
   boundary. Real isolation requires an explicitly created separate Workspace.
9. WorkspaceRuntime and all AgentBindings load lazily on first use. The default
   agent is not special-cased into eager loading.
10. Concurrent first lookups deduplicate through cached promises. Repeated
    successful lookup returns the same AgentBinding object.
11. Independent sessions may execute concurrently. Existing Pi per-session
    queue, interrupt, stop, timeout, spawn, and depth rules remain authoritative.
12. Accepting a background prompt/follow-up acquires one idempotent
    WorkspaceAgentScope operation lease per logical work item—even after the
    HTTP 202 response and without an SSE subscriber. Duplicate receipt/
    `clientNonce` admission reuses the token; queued → running transfers it
    without release/reacquire. Queue-clear may release a never-started queued
    item after removal. For running work, interrupt/stop/timeout only request
    cancellation: the producer owns the lease until its terminal `finally` after
    model/tool/hook/abort cleanup settles, then releases exactly once. A control
    receipt is never a release point. Queues persist only stable subject/target
    IDs, never a prior invocation or `RunContext`; queued → running, retries, and
    auto-posted follow-ups obtain a fresh background issuer and consume a
    `task.start`/`agent.followup` token before any model/tool/plugin effect. If
    authority was revoked after HTTP 202, the item terminalizes without effects
    and releases through the producer's `finally`.
13. A loaded AgentBinding remains until its WorkspaceRuntime is retired; there
    is no separate idle-agent eviction policy. Retirement drains accepted
    background runs plus request/dispatcher/tool leases, closes revocable passive
    streams with reconnect state, disposes loaded bindings, then disposes the
    shared runtime exactly once. An entry with an active/queued run is not an LRU
    candidate; a passive stream alone cannot pin the cache indefinitely.

### Static policy

14. Agent types are globally defined once per host. Workspace types reference
    them by stable ID.
15. Every workspace-type policy has one `defaultAgentTypeId`, a unique non-empty
    `allowedAgentTypeIds`, and a default contained in the allowed set.
16. `agentTypeId` must equal the authored source `definitionId`; aliases are
    forbidden.
17. The complete source/plugin/policy graph is copied, frozen, and validated at
    host startup. Runtime and harness creation remain lazy.
18. Policy changes require a normal deployment/restart. There is no registry,
    watcher, install/update endpoint, active pointer, or controller.
19. Existing hosts that omit explicit policy are normalized internally to one
    `default` workspace type and one `primary` agent. They still execute through
    the same Workspace orchestrator; there is no compatibility adapter class or
    old/new runtime branch.
20. Existing host options feed that normalized `primary` definition so full-app
    behavior remains compatible.

### Plugins and tools

21. Host-selected trusted `WorkspaceServerPlugin` descriptors load and validate
    once at host startup and remain grouped by canonical plugin ID until policy
    selection. Pi extension entrypoints assigned by those descriptors still load
    through Pi at AgentBinding/session time and report Pi resource diagnostics.
22. Agent behavior filtering applies to plugin prompt, tools, skills, Pi
    packages/extensions, and other Pi resources.
23. Every agent receives standard Boring Workspace tools. Plugin sets customize
    behavior; they are not ACLs.
24. For one workspace type, the effective workspace plugin set is the explicit
    `workspacePluginIds` union the plugin IDs referenced by all allowed agents.
25. Runtime provisioning uses that effective set once when WorkspaceRuntime is
    first needed. It never provisions separately per agent.
26. Host-level routes, bridge handlers, preserved UI state, and asset packaging
    continue to use the boot-time host union in this shipment. Agent assignment
    does not hide or authorize an HTTP route. Each route/handler keeps its own
    authentication and resource authorization.
27. Tool collisions remain non-fatal and deterministic. Preserve the current
    Boring final composer, warnings, readiness wrapping, and Pi semantics; do
    not introduce a new fatal collision mode.
28. Pi currently reports extension conflicts and makes the first extension in
    load order win; SDK `customTools` are applied later and override extension
    or built-in tools. This shipment records and tests the effective ordering
    rather than replacing Pi's registry.
29. Explicit multi-agent configurations use only host-selected Pi resources.
    Ambient workspace/user/global Pi discovery cannot silently enter every
    typed agent. The normalized compatibility `primary` path preserves existing
    standalone ambient behavior until separately migrated.

### Authored source

30. Authored JSON/Markdown contains identity, safe display metadata, version
    metadata, and instructions only.
31. Authored data never selects code, plugin IDs, tool names, skill paths,
    package paths, MCP URLs/commands, credentials, model/provider policy,
    workspace roots, runtime modes, or deployment policy.
32. Trusted host policy binds an authored source to canonical plugin IDs.
33. `label` and `description` are optional bounded, control-free display
    strings. Neither is executable or authorization input.
34. Existing legacy `toolRefs`, `skillRefs`, `mcpServerRefs`, and capability
    fields remain parseable for package compatibility, but non-empty values are
    product-invalid in A1. Empty/absent values have no runtime meaning.
35. The source loader returns a frozen server-only value; it does not return
    tools, catalogs, digests, paths, or runtime handles.
36. Model selection continues through existing host/session policy.

### Sessions and ingress

37. Reuse `SessionStore`/`PiSessionStore`; do not add a Core session table.
38. New sessions persist trusted `agentTypeId` selected by Workspace. Existing
    session metadata is not client authority.
39. Resuming/executing a typed session uses its persisted agent type after
    checking that the type remains allowed by current Workspace policy.
40. A session whose agent is no longer allowed fails stably for execution and
    never changes behavior silently. Ownership-authorized history management
    remains possible without loading that AgentBinding: list, stored state,
    attachments, changes, and deletion may read/remove deprecated history.
41. A legacy session without `agentTypeId` resolves through the Workspace's
    current default. Reviewed history is not rewritten in bulk.
42. A deployment update to an agent definition keeps session history but uses
    the currently deployed definition for the same `agentTypeId`; historical
    behavior versions are not retained as runtime authority.
43. Public HTTP/UI APIs do not accept an `agentTypeId` selector in this
    shipment. New human sessions use the default; session IDs may resolve
    trusted stored type internally.
44. Human selectors, arbitrary direct non-default chat, agent switching, and
    productized session forking are deferred.
45. The AgentBinding singleton is actor-neutral and shared by workspace
    members. User identity, membership snapshot, credentials, and request data
    enter per invocation. Tool definitions and caches may not capture one actor.

### Reload and failure boundaries

46. `/reload` reprovisions the shared WorkspaceRuntime and refreshes resource
    state for currently loaded AgentBindings only. It reloads only the requesting
    actor's selected live session, never every persisted or other user's session.
    Unloaded agents remain unloaded; refresh uses live handles rather than a
    persistent-session scan.
47. Workspace-wide reprovision/reload remains behind host admission. Explicit
    multi-agent hosts must provide an authorization predicate/capability for the
    operation; absence fails closed. The omitted-policy compatibility path keeps
    the current admission behavior.
48. `/reload` never changes explicit workspace-type membership, default/allowed
    sets, plugin assignments, or boot-registered host routes; those need
    restart/redeployment. It may refresh implementation/resources within the
    already assigned Pi/plugin IDs. The omitted-policy compatibility path also
    preserves current standalone asset rescan, runtime-backend add/update/removal,
    server-plugin rebuild diagnostics/restart warnings, and reprovisioning; that
    work runs inside the same generation writer transaction and does not create
    a second orchestrator.
49. Workspace/Sandbox creation failure is a workspace-level hard failure and is
    retryable after partial cleanup. Background provisioning failure is shared
    degraded readiness: all agents observe the same failure, runtime-dependent
    tools remain unavailable, and non-dependent chat retains current behavior.
50. Agent-specific harness/behavior load failure affects only that type. The
    failed promise/partial binding is retired and removed so a later request can
    retry; other agents remain usable.
51. Invalid host-selected source/plugin/policy descriptors prevent serving.
    Compatibility-only ambient plugin discovery and Pi extension loading retain
    current per-resource diagnostics instead of becoming host-fatal.

### Deferred Pi integration

52. The intended future direction is a Boring Pi package/extension seam that
    can add Boring runtime context and tools to any Pi agent.
53. That Pi package will not own Core auth, workspace policy, HTTP routing,
    Workspace/Sandbox creation, provisioning, session-root persistence, or
    singleton maps. Workspace remains the orchestrator.
54. The exact package/extension API is a follow-up decision; this shipment must
    not claim it has transformed arbitrary Pi agents already.
55. `pi-subagents` currently launches child processes and does not share the
    Boring WorkspaceRuntime. A Workspace-native executor/backend is a separate
    follow-up. Normal collaboration is not declared complete until that exists.

## Responsibility diagram

```text
Host application
├─ domain routing config ───────────────┐
├─ WorkspaceAgentHostPolicy             │
└─ installed trusted plugins            │
                                        ▼
Core                                Workspace
────────────                        ─────────
authenticate                        validate static policy/plugin graph
verify membership                  receive authorized workspaceTypeId
load/persist Workspace record       resolve default or stored session type
return authorized context ────────► get/create WorkspaceRuntime
never inspect agent behavior        provision effective workspace plugin union
                                    get/create AgentBinding by agentTypeId
                                             │
                                             ▼
                                         Agent
                                         ─────
                                         compose one source + plugin subset
                                         create one harness/agent
                                         execute with per-run actor context
                                         use supplied WorkspaceRuntime
```

## One embeddable Workspace host seam

R1 must introduce one Workspace-owned embeddable orchestrator used by both
existing host shells. Conceptually:

```ts
type WorkspaceAgentHost = Readonly<{
  register(
    app: FastifyInstance,
    integration: Readonly<{
      resolveInvocationIssuer(
        request: FastifyRequest,
      ): Promise<WorkspaceInvocationIssuer>
      authorizeBackgroundSubject(
        subject: TrustedBackgroundWorkspaceSubject,
      ): Promise<WorkspaceInvocationIssuer>
      authorizeWorkspaceReload?(
        invocation: AuthorizedWorkspaceInvocation,
      ): Promise<boolean>
    }>,
  ): Promise<void>
  retireWorkspace(
    invocation: AuthorizedWorkspaceInvocation,
    options: { reason: "core-delete" | "account-doomed-workspace" | "cli-remove" },
  ): Promise<WorkspaceRetirementReceipt>
  retireActor(
    invocation: AuthorizedWorkspaceInvocation,
    options: { reason: "account-delete" },
  ): Promise<ActorRetirementReceipt>
}>

function createWorkspaceAgentHost(
  options: WorkspaceAgentHostOptions,
): WorkspaceAgentHost
```

The host application constructs this object from Workspace policy/plugins before
passing it to a top-level shell:

- `createWorkspaceAgentServer()` creates a Fastify app and registers it with a
  fixed trusted local context resolver;
- `createCoreWorkspaceAgentServer()` creates Core auth/stores/routes and
  registers the same object with a Core authorization resolver;
- CLI `modeApps.ts` workspaces mode registers the same object and removes its
  direct `registerAgentRoutes`, `pluginRuntimes`, runtime-backend registry, and
  provisioning ownership;
- Core/CLI receive an opaque `WorkspaceAgentHost` and never receive or inspect
  its agent definitions, plugin subsets, prompts, tools, or Pi resources.

This replaces the current duplication where Core directly collects behavior and
calls `registerAgentRoutes()` while standalone calls `createAgentApp()`. Agent
route/resource modules become consumers of Workspace's runtime/agent resolvers;
they do not create a second app or runtime.

A host-composition validator owns the only cross-graph check:

```text
host domain target workspaceTypeIds
⊆ declared Core product workspaceTypeIds
⊆ WorkspaceAgentHost policy workspaceTypeIds
```

Core validates hostname/type syntax and performs request-time type equality.
Workspace validates its agent/plugin graph. Neither layer reaches into the
other's private graph.

## Conceptual contracts

Exact exported names are fixed only after the package/API audit. The semantics
below are not optional.

```ts
type AgentTypeId = string
type WorkspaceTypeId = string

type TrustedAgentBehaviorDescriptor = Readonly<{
  systemPromptAppend?: string
  tools?: readonly AgentTool[]
  pi?: TrustedPiResourceDescriptor
  dynamicPrompt?: (ctx: WorkspaceStaticContext) => Promise<string | undefined>
}>

type WorkspaceAgentTypeDefinition = Readonly<{
  agentTypeId: AgentTypeId
  source?: AuthoredAgentSourceV1
  pluginIds: readonly string[]
  hostBehavior?: TrustedAgentBehaviorDescriptor
}>

type WorkspaceTypeAgentPolicy = Readonly<{
  workspaceTypeId: WorkspaceTypeId
  defaultAgentTypeId: AgentTypeId
  allowedAgentTypeIds: readonly AgentTypeId[]
  workspacePluginIds?: readonly string[]
}>

type WorkspaceAgentHostPolicy = Readonly<{
  agentTypes: readonly WorkspaceAgentTypeDefinition[]
  workspaceTypes: readonly WorkspaceTypeAgentPolicy[]
}>
```

Workspace receives only a Core-authorized request context:

```ts
type TrustedBackgroundWorkspaceSubject = Readonly<{
  appId: string
  workspaceId: string
  actorId: string
  requiredCapability: string
  causeId: string
}>

type WorkspaceInvocationOperation =
  | "session.list" | "session.create" | "session.resolve" | "session.delete"
  | "session.state" | "session.attachment" | "session.events"
  | "session.changes" | "session.system-prompt"
  | "agent.catalog" | "agent.skills" | "agent.commands.list"
  | "agent.commands.execute" | "agent.send" | "agent.prompt"
  | "agent.followup" | "agent.queue-clear" | "agent.interrupt"
  | "agent.stop" | "agent.reload"
  | "task.start" | "task.status" | "task.progress" | "task.result"
  | "task.cancel" | "artifact.read" | "workspace.retire" | "actor.retire"
  | "plugin.route" | "plugin.bridge"
  | "tool.effect"

type WorkspaceInvocationTarget = Readonly<{
  workspaceId: string
  agentTypeId?: string
  sessionId?: string
  resourceId?: string
}>

type WorkspaceInvocationIssuer = Readonly<{
  mint(
    operation: WorkspaceInvocationOperation,
    target: WorkspaceInvocationTarget,
  ): Promise<AuthorizedWorkspaceInvocation>
}>

declare const authorizedInvocationBrand: unique symbol

type AuthorizedWorkspaceInvocation = Readonly<{
  readonly [authorizedInvocationBrand]: true
}>
```

The Workspace-host integration owns a private issuer/mint registry. A request or
background resolver returns a short-lived `WorkspaceInvocationIssuer` backed by
copied/deep-frozen stable subject facts and a host verifier; callers cannot
supply token fields or validation code. Each `issuer.mint(operation, target)`
creates a distinct empty frozen token. Its immutable operation/target/subject
facts live in a private `WeakMap`; replay state lives separately in a private
mutable `WeakSet`, never inside the frozen facts.

Every Workspace/router/facade entry calls one private `consumeInvocation(token,
expectedOperationAndTarget)`: validate registry identity before reading facts,
atomically reject replay/mark consumed, revalidate current app/user/membership/
Workspace type/capability, reject global-user/Workspace deletion fences, verify
this replica's live runtime-owner registration where applicable, and compare invocation facts with the Workspace,
AgentBinding type, and session-handle facts. Casts, mutable lookalikes, structural
objects, Proxies, replay, and cross-actor/workspace/agent/session use fail closed.
The only fence bypass is a privately minted app-owned retirement-job issuer that
can mint `workspace.retire`/`actor.retire` operations only; it cannot mint chat,
tool, plugin, session, artifact, or task operations.

One invocation is minted and consumed for exactly one operation. Nested route
flow mints separate tokens—for example `session.resolve` then `agent.prompt`—
from the same short-lived issuer, with both targeted to the same Workspace/
agent/session facts. The issuer itself is never persisted past that request or
background API operation.

Only Core's request resolver, Core's host-only background-subject resolver, or
the explicitly trusted standalone adapter can request an issuer. The
background resolver receives a server-owned subject—not the trigger request's
identity—and freshly validates app, user, membership, persisted Workspace type,
and required capability before issuing the same revalidatable invocation. Hosted
automation, scheduled/manual runs, managed MCP, and future trusted jobs must use
this seam; dispatchers no longer accept raw `{workspaceId, userId}`.

Every prompt/follow-up/queue-clear/interrupt/stop/delete/reload/slash-command/
tool/read and every retained dispatcher operation consumes its fresh targeted
invocation before work. A retained dispatcher cannot rely on an old membership
snapshot. The invocation is passed per operation and is never stored in an AgentBinding;
Fastify request objects never enter singleton state. Trusted background clients
store only stable IDs/receipts, never a raw authorized Workspace or invocation
for reuse. They call `authorizeBackgroundSubject()` afresh for start, status,
progress/result, cancel/interrupt/stop, and every artifact/session read. Each
operation receives a newly minted invocation whose private verifier revalidates
immediately before the operation.
Automation and managed MCP proof revokes membership/capability after resolver
creation and after task start, then proves status, artifact read, and stop fail
closed without leaking retained Workspace handles.

Core may construct and pass this context, but it cannot turn `workspaceTypeId`
into an agent type. Workspace owns that lookup.

The internal runtime shape is conceptually:

```ts
type WorkspaceRuntime = {
  workspaceId: string
  workspace: Workspace
  sandbox: SandboxOrRuntimeBundle
  provisioning: WorkspaceProvisioningResult | undefined
  dispose(): Promise<void>
}

type AgentBinding = {
  agentTypeId: string
  catalog(invocation: AuthorizedWorkspaceInvocation): Promise<readonly AgentToolSummary[]>
  commands(invocation: AuthorizedWorkspaceInvocation): Promise<readonly AgentCommandSummary[]>
  session(handle: AuthorizedAgentSessionHandle): Readonly<{
    send(invocation: AuthorizedWorkspaceInvocation, input: AgentInput): AgentEventStream
    followUp(invocation: AuthorizedWorkspaceInvocation, input: AgentInput): Promise<Receipt>
    interrupt(invocation: AuthorizedWorkspaceInvocation): Promise<Receipt>
    stop(invocation: AuthorizedWorkspaceInvocation): Promise<Receipt>
    // every other session operation has the same fresh-invocation first argument
  }>
  dispose(): Promise<void>
}
```

The exported/Workspace-visible binding is a narrowed façade. Raw `Agent`,
`AgentHarness`, raw-ID session operations, and stores live only in an unexported
Agent-package implementation/compatibility adapter. Every session-sensitive
facade method requires a privately minted handle and every read/effect accepts a
freshly issued invocation; returned operation objects retain only the session
handle, never authority. Export-shape/type tests prove objects reachable from
`WorkspaceAgentHost`, Core, routes, and plugin contexts cannot obtain the raw
harness/store or bypass the façade.

Existing standalone `@hachej/boring-agent/core`, `/server`, and `/shared` Agent,
harness, and `SessionStore` exports remain supported. The owner-approved R4
correction is limited to the unused catalog/materializer/validate surface and
does not authorize other package-wide removal; raw public APIs adapt internally
at the private compatibility boundary. The Agent factory separately returns an
unexported `AgentBindingGenerationParticipant` directly to the coordinator; it
is not reachable from the façade/routes/plugins.

```ts

declare const authorizedAgentSessionHandleBrand: unique symbol

type AuthorizedAgentSessionHandle = Readonly<{
  readonly [authorizedAgentSessionHandleBrand]: true
}>

type WorkspaceAgentSessionRouter = {
  list(invocation: AuthorizedWorkspaceInvocation): Promise<SessionSummary[]>
  create(
    invocation: AuthorizedWorkspaceInvocation,
    init: { title?: string; serverSelectedAgentTypeId: string },
  ): Promise<AuthorizedAgentSessionHandle>
  resolveForExecution(
    invocation: AuthorizedWorkspaceInvocation,
    sessionId: string,
  ): Promise<AuthorizedAgentSessionHandle> // requires current allowed type
  resolveForHistory(
    invocation: AuthorizedWorkspaceInvocation,
    sessionId: string,
  ): Promise<AuthorizedAgentSessionHandle> // ownership only; no binding load
  delete(
    invocation: AuthorizedWorkspaceInvocation,
    handle: AuthorizedAgentSessionHandle,
  ): Promise<void>
}

type WorkspaceAgentScope = {
  runtime: Promise<WorkspaceRuntime>
  sessions: WorkspaceAgentSessionRouter
  agents: Map<AgentTypeId, Promise<AgentBinding>>
}
```

The contract type may live in Agent server exports to preserve the existing
acyclic package direction; instance selection, caching, and disposal ownership
still belong to Workspace.

### One runtime identity and input classification

Workspace caches `WorkspaceAgentScope` by `workspaceId` only. On each authorized
lookup it resolves a frozen workspace-static descriptor and compares its safe
fingerprint with the live scope. A mismatch fails
`WORKSPACE_RUNTIME_CONFIGURATION_MISMATCH`; it never allocates a second runtime.

Current `RuntimeScope.key` contributors must be audited and moved deliberately:

| Current input | New owner/lifetime |
| --- | --- |
| `workspaceRoot` / `getWorkspaceRoot` | Workspace-static; resolve after auth, freeze on first use, reject drift. |
| `mode` / `runtimeModeAdapter` / template | Workspace-static deployment policy; not actor/request selectable. |
| provisioning, runtime env, Sandbox handle | WorkspaceRuntime-static; effective plugin union once. |
| authored source, prompt, static tools, plugin IDs, Pi resources | Agent-type-static; excluded from WorkspaceRuntime cache identity. |
| `getSystemPromptDynamic` | Agent/workspace-static loader; may vary by Workspace, never actor/request. |
| `getPi` | Explicit policy must normalize to agent-type-static resources; request-aware variation is rejected. |
| `getExtraTools` / bridge/UI tools | Static tool definitions; actor/workspace authorization resolves inside `execute` from run context. |
| session root/namespace | Workspace session router with per-invocation actor namespace; not binding identity. |
| filesystem bindings, credentials, model filtering, metering, admission | Per invocation; never captured by runtime or AgentBinding. |
| `getRuntimeScopeContribution` | Split into workspace-static runtime descriptor, agent-static prompt/resources, and per-invocation services; the mixed callback is removed from explicit policy. |
| ambient/external plugins | Compatibility `primary` only; explicit multi-agent policy is host-selected. |

### Compatibility behavior normalization

The omitted-policy normalizer does not squeeze legacy options into only
`source + pluginIds`. It creates three internal values:

1. a `WorkspaceRuntimeDescriptor` from root/mode/template/provisioning/runtime
   env;
2. a synthetic `primary` `TrustedAgentBehaviorDescriptor` from static prompt,
   tools, Pi, plugin, and harness options;
3. `WorkspaceInvocationServices` from admission, filesystem, model, credential,
   metering, bridge, telemetry, and actor/session resolvers.

R0 inventories every `CreateAgentAppOptions`, `RegisterAgentRoutesOptions`,
`CreateWorkspaceAgentServerOptions`, and `CreateCoreWorkspaceAgentServerOptions`
field. R1 records an option-by-option mapping and compatibility test. A callback
that mixes lifetimes must be decomposed; it cannot remain hidden in a cache key.

## Startup normalization and validation

One normalizer produces one internal graph for legacy and explicit hosts.

### Compatibility input

```text
no explicit WorkspaceAgentHostPolicy
→ workspaceTypes: default → default primary → allowed [primary]
→ agentTypes: primary → current source/prompt/tool/plugin/Pi options
→ same Workspace orchestrator
```

There is no feature flag and no second runtime implementation.

### Explicit graph validation

Before listening, reject with stable redacted errors when:

- an ID violates the canonical grammar;
- agent IDs or workspace-type IDs duplicate;
- plugin IDs duplicate or are unknown;
- authored `definitionId` differs from `agentTypeId`;
- an allowed type is missing or duplicated;
- the default is missing from the allowed set;
- a workspace plugin reference is missing;
- authored source validation fails;
- the host-composition cross-validator finds a domain/Core workspace type with
  no Workspace policy;
- explicit multi-agent policy attempts to enable ambient executable discovery.

Validation may compose frozen behavior descriptors and collision diagnostics,
but it must not create Workspace, Sandbox, harness, session, or provider
resources. Invalid host-selected static descriptors are fatal. Compatibility
ambient discovery and Pi extension module load failures keep their existing
per-resource diagnostic behavior.

## Request and session flow

```text
1. Core normalizes domain and authenticates.
2. Core loads the workspace under the current app.
3. Core verifies membership and obtains persisted workspaceTypeId.
4. Core passes an authorized context to Workspace.
5. Workspace selects:
   a. current default for a new session; or
   b. trusted stored agentTypeId for an existing typed session; or
   c. current default for a legacy untyped session.
6. Workspace verifies the selected type is allowed by current policy.
7. Workspace lazily gets the shared WorkspaceRuntime.
8. Workspace lazily gets the typed AgentBinding.
9. Agent executes with per-invocation actor/request/session context.
```

An arbitrary body, query, header, browser field, authored file, model output, or
tool call cannot select the agent type.

### Session router and existing namespace preservation

Workspace constructs one actor-multiplexing session router before any
AgentBinding. It evolves `SessionStore`/`PiSessionStore`; it is not a new Core
store or database table.

- `SessionCtx` gains trusted Workspace/actor routing and returned
  `agentTypeId` metadata.
- `PiSessionStore` gains a per-operation directory resolver, or a thin
  multiplexing facade delegates to existing stores per actor namespace.
- Existing full-app `<workspace>_user_<hash>` directories remain in place and
  are resolved from the authorized actor on every operation.
- The first JSONL/session context record atomically stores the server-selected
  agent type for new sessions.
- The client cannot provide or overwrite that type.
- Missing metadata is legacy and resolves to current default.
- Malformed/conflicting metadata is `AGENT_SESSION_METADATA_INVALID` and never
  falls back.
- `resolveForExecution` rejects malformed/unknown/disallowed type before
  AgentBinding creation. `resolveForHistory` proves Workspace/actor ownership
  from the scoped store and may return a management handle for deprecated or
  malformed metadata without interpreting it as executable authority.
- Router success mints a frozen empty `AuthorizedAgentSessionHandle`; its private
  `WeakMap` record carries copied/frozen Workspace, actor, raw session ID,
  expected type, legacy state, and authorization version. Structural objects,
  casts, proxies, and mutation fail before facts are read.
- Harness/service/store reload, prompt, attachment, diagnostics, changes,
  command, delete, switch, fork, and open APIs accept only that minted handle,
  never equivalent loose fields or an actorless raw ID. Raw `SessionStore` /
  `PiSessionStore` access remains behind a private compatibility adapter and is
  not exposed to routes, host plugins, or AgentBinding consumers.
- Session-change tracking and reload/resource diagnostics are keyed by the full
  handle identity, not binding-global or raw session ID.
- Native/wrapped Pi session formats continue through existing parsing; no
  unbounded scan or bulk rewrite is introduced.
- Pi extension command/API calls that create, open, switch, fork, or delete a
  session run through a binding session controller. It preserves the same
  Workspace/actor/type, writes metadata before activation, and rejects a
  conflicting target; extensions cannot bypass the Workspace session router.
- Every router/facade method consumes a fresh invocation targeted to its exact
  operation and compares its private facts with the private handle facts and
  binding `agentTypeId` before store/harness access.
- The private handle record also contains a stable `SessionBindingKey` derived
  from a canonical length-prefixed/hash encoding of app, Workspace, actor,
  validated stored agent type (or a fixed invalid-metadata digest sentinel), and
  raw session ID. It is identity for internal persistent plugin/
  tracker state, not authorization and never enters client DTOs.
- Reminting a handle after restart yields the same private key. Stateful plugins
  receive a scoped store façade from `(fresh invocation, handle)` and never the
  key/raw session ID directly; answer/cancel/question lookup revalidates scope.
- Ask-user and other legacy raw-session-keyed files gain a versioned migration:
  read-through occurs only when the session router proves the legacy Pi session's
  Workspace/actor ownership and no conflicting scoped record exists; the
  transaction copies to the stable key. Ambiguous/unowned legacy records remain
  quarantined for operator migration and are never guessed across actors.
- Tests cover token/handle mutation, replay, wrong operation, cross-actor/
  workspace/agent/session combinations, identical raw session IDs for two
  users, handle remint, and answer/cancel after restart; state, attachments,
  changes, diagnostics, commands, plugin state, and reload remain isolated.

### Exhaustive route and dispatcher resolution inventory

Every invocation of a route registered by `AgentRouteBindingProfile`, every
optional Agent route, and every dispatcher method resolves to exactly one of
four scopes after validated request-branching:

| Scope | Current invocation branches | Resolution |
| --- | --- | --- |
| **Host/no binding** | `/health`; global `/ready`; Core `/api/v1/capabilities` | Host process/config readiness/capabilities only. Never create a WorkspaceRuntime or AgentBinding. If the compatibility scope is already loaded, `/ready` may include its readiness; it never loads one. |
| **Authorized Workspace scope/runtime** | file/raw-file/tree/search/git/fs-events; optional `/a/:id`; session list; stored session state/attachment/changes/delete; models; explicit-policy reload without `sessionId` | Revalidate app/membership/type. Files/share use shared WorkspaceRuntime. Session history/delete uses `resolveForHistory` and scoped stores without AgentBinding or allowed-type execution. Models need not instantiate an agent; explicit-policy sessionless reload reprovisions/refreshes loaded bindings but reloads no session. |
| **Default AgentBinding** | create session; sessionless dispatcher `send`; catalog; skills; `/api/v1/ready-status`; command listing without `sessionId`; omitted-policy command execute/reload without `sessionId` | Resolve current default after authorization. Session creation/dispatcher send persist selected type before first effect; command listing uses a binding-level static command inventory. Omitted-policy command/reload preserves the current actor's compatibility default-session semantics. |
| **Stored-session AgentBinding** | session events/prompt/follow-up/queue-clear/interrupt/stop; session system-prompt; command list/execute with `sessionId`; reload with `sessionId`; dispatcher send/interrupt/stop with a session ID | Use `resolveForExecution`, require valid currently allowed type, then lease the typed binding. |

Additional rules:

- `/api/v1/agent/sessions/:id/system-prompt` is session-specific; there is no
  invented sessionless system-prompt route.
- `sessionChanges`, stored state/attachments, and delete validate ownership
  through `resolveForHistory`; the tracker/store may not be a session-ID oracle.
  They remain available for deprecated/malformed agent metadata and never load
  or execute an AgentBinding. Delete also removes scoped plugin/session state.
- attachment reads, event streams, queue clear, commands, reload, interrupt, and
  stop perform the same ownership/type resolution as state/prompt.
- HTTP prompt always has a path `sessionId` and is stored-session-only. Only
  sessionless dispatcher `send` creates a default typed session.
- command listing without `sessionId` uses the default binding's static command
  inventory. On explicit-policy hosts, command execution requires `sessionId`.
  Omitted-policy hosts preserve the current compatibility default session. Any
  supplied session ID is authoritative input to lookup: missing/nonexistent IDs
  fail and are never normalized to default.
- on explicit-policy hosts, reload without `sessionId` performs authorized
  Workspace reprovision/resource refresh and reloads no session. Omitted-policy
  hosts preserve the current actor's compatibility default-session reload.
  Reload with an explicit ID always requires exactly that requester-owned handle.
- plugin-cli currently passes `workspaceId` as a fake reload session. R5 changes
  it to omit the field/use the compatibility default (or pass a real session);
  arbitrary explicit unknown IDs are no longer accepted.
- dispatcher send without a session creates/uses default; future explicit
  internal target type is deferred to Step 2.
- all mutating/effect operations run per-operation authorization revalidation.
- Global `/api/v1/capabilities` has one locked discriminated migration:

  ```ts
  type AgentCapabilities =
    | { // exact legacy spelling; omitted-policy hosts only
        runtimeMode: RuntimeModeId
        tools: string[]
        modelProviders: string[]
      }
    | { // explicit-policy hosts, same endpoint/new exact cohort
        schemaVersion: 2
        catalogScope: "authorized-workspace-default"
      }
  ```

  Omitted-policy full-app returns the existing unversioned `primary` payload
  byte-for-byte. Explicit-policy hosts return only the v2 discriminator/scope:
  no runtime mode, providers, tool names, or host-wide/cross-type union. Their
  UI/server must deploy in the same R3 package cohort and branch on
  `schemaVersion === 2`; legacy clients are not claimed compatible with an
  opt-in explicit-policy host. Authorized callers obtain default-agent tools
  from `/agent/catalog`, models from the authorized models seam, and readiness
  from `/api/v1/ready-status`. Non-members cannot infer any type's behavior.
- accepted background turns and in-flight effects hold non-evictable operation
  leases. Passive event/ready/filesystem transports use revocable subscriptions,
  not indefinite runtime-operation leases: capacity/deletion retirement emits a
  terminal cursor/reconnect frame, closes them within a bound, then disposes.

R3 adds a route-scope manifest beside `AgentRouteBindingProfile` (including
optional routes). Each method/path owns an explicit resolver strategy whose
validated branches produce one of the four classes. A Fastify `onRoute`
conformance test fails when a new Agent route lacks a strategy; branch tests
prove each optional-session path. Every stored-session path rejects missing,
nonexistent, malformed, conflicting, or disallowed metadata before creating or
leasing an AgentBinding.

## Plugin composition

### Agent behavior view

For agent `A`, Workspace supplies only:

```text
standard Boring tools
+ authored instructions for A
+ host prompt/options explicitly assigned to A
+ prompt/tools/skills/Pi resources from A.pluginIds
```

Final tool assembly continues through the existing Agent merge seam. Static
plugin order is host declaration order. Collisions are diagnostic and
non-fatal, consistent with current Boring/Pi behavior.

### Workspace view

For workspace type `W`:

```text
effectiveWorkspacePluginIds(W)
  = W.workspacePluginIds
    ∪ plugins(agent) for every agent in W.allowedAgentTypeIds
```

Provision that effective union once for the shared runtime. Do not let the
first agent loaded determine workspace provisioning; otherwise later agents
would observe an order-dependent environment.

R2 replaces `bootstrapServer()`'s early flattening with a canonical ordered
record per plugin ID spanning prebuilt server objects and package-manifest
resources. A package/server ID mismatch or duplicate canonical ID fails startup.
The record retains behavior and workspace surfaces separately until selection.

Provisioning installs the union into plugin-namespaced locations and returns
safe results by plugin ID (including `skillRootsByPluginId`) rather than only a
parent directory containing every mirrored skill. Each AgentBinding receives
only roots/resources for its assigned plugin IDs. Explicit multi-agent mode does
not add `.agents/skills`, a union parent skill directory, ambient prompt files,
or workspace/user/global Pi discovery. Compatibility `primary` retains current
ambient behavior and diagnostics.

### Shared provisioning generation protocol

The enforceable Workspace-owned contract is conceptually:

```ts
declare const workspaceResourceSnapshotBrand: unique symbol

type WorkspaceResourceGenerationSnapshot = Readonly<{
  generation: number
  provisioning: readonly DeepFrozenPluginProvisioningResult[]
  assets: ImmutablePluginAssetDispatchTable
  runtimeBackends: ImmutableRuntimeBackendDispatchTable
  readonly [workspaceResourceSnapshotBrand]: true
}>

declare const stagedWorkspaceGenerationBrand: unique symbol

type StagedWorkspaceResourceGeneration = Readonly<{
  readonly [stagedWorkspaceGenerationBrand]: true
}>

declare const workspaceGenerationAccessBrand: unique symbol

type WorkspaceGenerationAccess = Readonly<{
  generation(): number
  provisioningFor(pluginId: string): DeepFrozenPluginProvisioningResult | undefined
  dispatchAsset(request: AssetRequest): Promise<AssetResult>
  dispatchRuntimeBackend(request: RuntimeBackendRequest): Promise<RuntimeBackendResult>
  readonly [workspaceGenerationAccessBrand]: true
}>

type RevocableStagedGenerationAccess = WorkspaceGenerationAccess

declare const stagedBindingTokenBrand: unique symbol
type OpaqueStagedBindingToken = Readonly<{
  readonly [stagedBindingTokenBrand]: true
}>

interface AgentBindingGenerationParticipant { // Agent-package private
  prepare(access: RevocableStagedGenerationAccess): Promise<OpaqueStagedBindingToken>
  discard(token: OpaqueStagedBindingToken): Promise<void>
}

interface WorkspaceResourceGenerationCoordinator {
  withReadLease<T>(
    use: (access: WorkspaceGenerationAccess) => Promise<T>,
  ): Promise<T>
  enroll(participant: AgentBindingGenerationParticipant): Promise<void>
  unenroll(participant: AgentBindingGenerationParticipant): Promise<void>
  stage(): Promise<StagedWorkspaceResourceGeneration>
  withStagedAccess<T>(
    staged: StagedWorkspaceResourceGeneration,
    use: (access: RevocableStagedGenerationAccess) => Promise<T>,
  ): Promise<T>
  stageBinding(
    staged: StagedWorkspaceResourceGeneration,
    participant: AgentBindingGenerationParticipant,
  ): Promise<OpaqueStagedBindingToken>
  commit(staged: StagedWorkspaceResourceGeneration): Promise<void>
  abort(staged: StagedWorkspaceResourceGeneration): Promise<void>
}
```

Snapshots are privately minted, copied, recursively frozen records/arrays and
opaque dispatch tables; `ReadonlyMap` or aliased mutable plugin objects are
forbidden. `StagedWorkspaceResourceGeneration` is also an empty opaque token;
its candidate snapshot remains in the coordinator's private registry. Binding
preparation occurs only through coordinator-owned `stageBinding()` /
`withStagedAccess()` callbacks. Staged accessors are privately minted, revocable,
and fail after callback settlement, so participants cannot retain candidate
assets/backends. The coordinator keeps opaque participant tokens for abort/
commit cleanup. A binding may cache prepared resources by internal generation ID,
but has no independent active/current pointer.

The committed pointer and raw snapshot are coordinator-private and never appear
in a lease/API. Consumers run inside `withReadLease`; its privately minted
`WorkspaceGenerationAccess` delegates to the snapshot while the lease is active
and every method fails after the callback settles. Returning/retaining the access
object therefore grants no snapshot lifetime escape. `withReadLease` releases in
`finally`, including stream/tool/backend failure.

AgentBinding creation enrolls before readiness. `unenroll()` is idempotent and
serialized with the writer: it removes the participant, discards any candidate
staged token, and prevents the writer's enrolled-set freeze from retaining a
failed/retired binding. Every load-failure path unenrolls before removing the
AgentBinding promise; normal typed retirement unenrolls after operation leases
drain and before disposal. If a writer exists, creation
stages that candidate and cannot become visible until commit/abort. Otherwise
the coordinator prepares it from its private committed snapshot. Route/tool/
backend adapters cannot access mutable provisioning state or raw snapshots.

Initial background provisioning and normal authorized reload use two-phase MVCC
stage/commit:

1. serialize writers but leave the private committed pointer/read admission
   unchanged. Initial provisioning has no committed runtime resources and reports
   `preparing`; a reload with a healthy generation reports `ready` plus
   `updateInProgress` while old readers continue safely;
2. build all filesystem/runtime resources in generation-namespaced staging
   locations and build copied/frozen plugin asset, runtime-backend, Pi, skill,
   PATH/env, and diagnostic tables without mutating the committed generation;
3. use coordinator `stageBinding(staged, participant)` for every loaded binding
   and every binding whose creation races the writer. Candidate access is
   callback-scoped/revocable. Freeze the enrolled set and repeat until no binding
   is missing a successful opaque staged token;
4. if any stage fails, abort every staged binding/resource and retain the prior
   committed pointer. Existing readers continue; no binding or route activated
   candidate state;
5. commit by one in-memory compare-and-swap of the coordinator's committed
   snapshot pointer. New `withReadLease` calls use the candidate; operations
   already holding an old lease finish against the immutable old generation;
6. mark initial readiness `ready`/clear reload `updateInProgress`, then emit
   buffered plugin-list events for the committed generation. The long-lived SSE
   transport subscribes to this commit bus without holding a generation lease;
   each initial/event payload is deep-copied under a short lease. An existing
   EventSource remains connected while commit proceeds;
7. reload the requester's exact authorized session separately against the new
   generation. Session-reload/event-delivery failure is diagnostic and never
   rolls back committed resources. Garbage-collect the previous generation only
   after all of its tracked operation leases drain.

If an external provisioner cannot stage and would destructively mutate committed
paths, it enters explicit complete-forward mode: block new dependent readers,
drain existing dependent leases with a bounded grace/cancellation policy, mark
shared readiness `preparing`/`degraded`, mutate, and keep readers blocked until a
retry completes and commits. Persistent SSE transport is not a generation reader;
it receives a version/reconnect event after completion. Complete-forward may not
serve the prior snapshot over modified paths.

“Generation compare-and-swap” here is one in-memory committed-pointer update. It
is unrelated to the retired deployment/publication content-addressed store.

Every provisioned-resource operation executes wholly inside `withReadLease`
through completion: model turns; tools; commands/inventories; skills/catalog/
resource-diagnostic and capabilities/catalog reads; Pi loaders; plugin-list
snapshot serialization; runtime plugin HTTP/backend handlers; bridge handlers;
automation/background jobs; and code reading provisioned PATH, Node, Python,
extensions, packages, skills, or runtime env. Commit-bus/SSE transport and host-
global handlers that do not dereference a generation hold no generation lease.

Tests cover failed binding stage with zero partial activation; deep immutability/
no aliasing/no raw-snapshot or staged-access retention across commit/abort; old-
generation retirement blocked by long-running turn, tool, and backend-handler
leases; commit succeeds while a pre-existing plugin EventSource stays open and
then emits the new version; a binding loaded before initial provisioning success;
another actor's dependent turn/tool during reload; concurrent `/skills` and
runtime-backend/plugin-list serialization; racing binding enrollment; failed-
binding unenrollment followed by healthy-sibling reload and failed-type retry;
bounded complete-forward stream/reconnect behavior; readiness never claims an
uncommitted initial generation; and no other actor's session is reloaded or
aborted.

Routes/bridges/UI state/assets are registered from the host-wide union at boot
for compatibility. Policy membership is not route authorization in this
shipment. Runtime handlers still receive a workspace-scoped context and enforce
their existing auth/resource checks.

## Actor-neutral execution

Current `registerAgentRoutes()` can include `authSubject` in binding cache
identity when `getExtraTools` is present. The new singleton invariant requires a
migration:

- static tool names, schemas, readiness, and implementations are composed once
  per agent type;
- actor-dependent authorization and credentials are resolved inside execution
  from trusted run context;
- a callback may not return a different tool catalog merely because the actor
  changed;
- existing Core/bridge/tool consumers are inventoried and migrated before the
  old actor-specific cache key is removed;
- two users in one workspace prove the same AgentBinding identity while tool
  effects retain correct user attribution and authorization.

If the audit finds a supported API whose product contract genuinely requires
actor-varying tool shape, stop for an explicit contract decision; do not silently
reintroduce per-user AgentBindings.

### Stateful trusted-plugin migration

Grouping plugins by ID is insufficient if a boot-time factory captures one
`workspaceRoot`, bridge, file store, raw dispatcher, actor, or default session.
R0 inventories every installed/default plugin and R2a/R2b migrate stateful
factories before R3 enables explicit multi-agent policy.

- Boot context contains only host-static dependencies and descriptor provenance.
- Workspace/actor/session access is obtained per operation through the minted
  invocation and, where needed, minted session handle plus generation lease.
- Plugin state declares its key explicitly: host-global, Workspace, actor, agent
  type, or session handle. A generic raw session ID or implicit `"default"` is
  forbidden for actor/session state.
- Plugin routes and bridge handlers receive host-verified invocation services;
  plugin tools read the same context from run storage.
- Plugin factories cannot retain a raw Workspace, mutable generation snapshot,
  or dispatcher beyond one operation.
- Standalone compatibility adapts its fixed local subject through this same
  interface; it does not preserve a separate stateful plugin path.

The required inventory includes ask-user state/file stores, boring-automation,
governance/company context, MCP/share/artifact integrations, default package
plugins, and every factory receiving `WorkspaceAgentServerPluginContext`.
Conformance uses two Workspaces, two actors, and identical raw session IDs to
prove plugin state/routes/bridges/tools do not cross-leak.

## Authored source contract

The corrective source value is server-only and frozen:

```ts
type AuthoredAgentSourceV1 = Readonly<{
  schemaVersion: 1
  agentTypeId: string
  version: string
  label?: string
  description?: string
  instructions: string
}>
```

The implementation may use an opaque constructor/brand after the package audit.
Required behavior:

- read only `agent.json` and `instructions.md`;
- no sibling executable discovery/import;
- regular non-symlink files contained under the source directory;
- bounded reads before decode/parse;
- new inclusive maximums of 64 KiB for the manifest and 256 KiB for
  instructions: open without following symlinks, `fstat` the descriptor, read at
  most `cap + 1` bytes, reject oversize before decode/parse with stable
  field-specific `AGENT_DEFINITION_INVALID`; R0 stops for a published contrary
  contract;
- exact ID grammar and expected-ID match;
- non-empty instructions;
- bounded safe metadata;
- absent/empty legacy ref arrays accepted with no runtime meaning;
- non-empty legacy refs rejected as unsupported;
- stable redacted errors;
- no runtime, plugin, Workspace, session, catalog, or deployment side effects.

The deterministic compiler digest may remain compatibility/test evidence. It is
not returned by the product source loader or used for runtime selection.

## `agent validate`

Keep `boring-ui agent validate <dir>` as a declarative source check.

Success reports only:

- schema version;
- agent type ID;
- version;
- optional label/description;
- instruction UTF-8 byte length.

It does not resolve tools, plugins, skills, MCP, models, or deployment state.
Human and JSON errors preserve stable, redacted process behavior. The published
schema-v1 success `refs` field is removed/simplified only in the owner-approved
corrective R4 follow-up, with its repository consumers and tests changed
atomically.

## `agent dev`

`agent dev` is a launcher for the regular server:

```text
boring-ui [normal global server options] agent dev <dir> --prompt <text>
boring-ui [normal global server options] agent dev <dir> --serve
```

It:

1. loads the authored source;
2. creates normal host policy with that source as `primary` unless an embedding
   host supplies explicit policy;
3. calls `createWorkspaceAgentServer()`;
4. uses the normal WorkspaceRuntime, Sandbox, plugins, tools, skills, Pi
   resources, model policy, and lifecycle;
5. makes one-shot versus serve differ only by ingress/lifetime;
6. serves loopback only in local dev;
7. disposes once and emits redacted identity.

Do not add `createMaterializedAgentDevApp()`, a dev behavior composer, a dev-only
plugin suppression policy, an authored tool catalog, or an A1-specific runtime
mode taxonomy.

## Pi package/extension follow-up boundary

The follow-up should test whether a Pi package can expose a narrow adapter like:

```text
Pi agent + Boring runtime context
→ Boring-aware Pi agent
```

Candidate Pi-owned responsibilities:

- extension hooks and tool registration;
- per-turn Boring context projection;
- prompt/resource integration;
- Pi session lifecycle callbacks.

Non-Pi responsibilities remain:

- authentication/membership;
- workspace-type/default/allowed-agent policy;
- Workspace/Sandbox/provisioning lifecycle;
- server routes and browser DTOs;
- durable session-root ownership;
- AgentBinding maps and cross-agent orchestration.

This plan deliberately leaves the exact API unresolved rather than forcing the
current Workspace work into an unproven extension contract.

## Failure and lifecycle state machine

### WorkspaceRuntime

```text
absent → creating → ready → retiring → disposed
                  ↘ create-failed ──cleanup/retry──► creating

provisioning: not-started → preparing → ready
                              ↘ degraded ──authorized retry──► preparing
```

Workspace/Sandbox creation failure retires partial resources and fails all
agent requests until a later authorized retry succeeds. Provisioning remains the
current background readiness model: failure marks the one shared runtime
degraded, every AgentBinding sees the same readiness, runtime-dependent tools
fail closed, and chat/tools without that requirement remain usable.

### AgentBinding

```text
absent → creating → ready → retiring → disposed
                  ↘ failed ──remove map entry/retry──► creating
```

A failed type does not poison the WorkspaceRuntime or sibling bindings.
Concurrent waiters observe the same creation result. Partial failure cleanup
unenrolls its generation participant before removing the typed promise, so later
provision/reload stages only healthy participants and the type may retry cleanly.

### Reload

```text
authorize workspace-wide reprovision
→ retry shared provisioning
→ refresh resource generations on loaded AgentBindings
→ reload only the requesting actor's selected live session
→ preserve unloaded bindings and all other persisted/live sessions
```

The coordinator stages resources on live bindings from the in-memory map and
commits one snapshot pointer; it never enumerates persistent session directories
or activates bindings independently. Explicit static policy/assignments and boot
route registration are not reloadable. Compatibility ambient asset/runtime-
backend rescan and assigned Pi resource reload remain supported inside the
writer transaction.

### Stable failure matrix

Final package registries may choose established names, but these distinct
semantics and safe fields are required:

| Condition | Stable semantic code | HTTP/retry |
| --- | --- | --- |
| Invalid static graph | `WORKSPACE_AGENT_POLICY_INVALID` | boot failure; deployment fix |
| Authorized Workspace type has no policy | `WORKSPACE_AGENT_POLICY_NOT_FOUND` | 503; deployment fix |
| Live workspace-static descriptor changes | `WORKSPACE_RUNTIME_CONFIGURATION_MISMATCH` | 500; non-retryable until restart |
| Workspace/Sandbox creation fails | `WORKSPACE_RUNTIME_CREATE_FAILED` | 503; retryable after cleanup |
| Shared provisioning degrades | `WORKSPACE_RUNTIME_PROVISIONING_FAILED` | readiness/tool error; authorized reload retry |
| AgentBinding load fails | `AGENT_BINDING_LOAD_FAILED` | 503; retryable, type-local |
| Stored session metadata malformed/conflicts | `AGENT_SESSION_METADATA_INVALID` | execution 500/no fallback; ownership-authorized history/delete still allowed |
| Stored agent type no longer allowed | `AGENT_SESSION_TYPE_NOT_ALLOWED` | execution 409; history/delete still allowed |
| Client attempts agent selection | `AGENT_TYPE_SELECTION_FORBIDDEN` | 400/403 using current disclosure conventions |
| Capacity contains only active work | `WORKSPACE_RUNTIME_CAPACITY_BUSY` | 503; retryable, never abort active work |
| Workspace deletion retirement cannot settle | `WORKSPACE_RETIREMENT_BUSY` | 409/503; no storage/provider destruction |
| Departing actor cannot settle in bound | `WORKSPACE_ACTOR_RETIREMENT_BUSY` | 409/503; survivor remains blocked only for that actor, retryable |
| Protected/managed Workspace forbids account delete | `ACCOUNT_DELETION_WORKSPACE_PROTECTED` | 409; no fence or mutation persisted |
| Live replica acknowledgements pending | `WORKSPACE_RETIREMENT_REPLICA_PENDING` | 202/503; no provider/storage destruction |
| Session/plugin-state cleanup fails | `WORKSPACE_RETIREMENT_DATA_CLEANUP_FAILED` | 503; journaled retry, no final deletion |

Existing Core unauthenticated/not-member/not-found/type-mismatch errors retain
precedence so policy contents are not disclosed.

### Retirement and capacity

Workspace owns a capacity-bounded LRU of `WorkspaceAgentScope` entries, initially
preserving the current capacity unless profiling changes it. Retirement occurs
on app close, LRU eviction, authorized Workspace/account/CLI deletion, failed
creation cleanup, or runtime health invalidation—not ordinary reload. Order is:

```text
block new operation admission
→ emit terminal cursor/reconnect frames and close passive streams within a bound
→ drain accepted background-run, request, dispatcher, generation, and tool leases
→ retire and dispose loaded AgentBindings
→ drain/abort provisioning safely
→ dispose WorkspaceRuntime/Sandbox once
→ remove cache entry
```

An accepted `202` prompt/follow-up and its queued/running work hold one logical
operation-lease token even when no SSE client is attached. Duplicate receipts
reuse it. Queue-clear releases only work proven never started. Interrupt/stop/
timeout receipts request cancellation but the running producer releases only in
its terminal `finally` after all model/tool/hook/abort cleanup. Failure paths do
the same. Such a scope is not an LRU candidate; admitting a 257th workspace
between a control receipt and confirmed settlement cannot abort/dispose it.
Process close uses the existing bounded shutdown/cancellation policy after
admission stops, but capacity eviction may not cancel accepted work. A passive
transport alone is revocable and cannot pin capacity: eviction closes it with a
cursor/reconnect frame, waits a bounded transport-close interval, then retires.
If all capacity entries contain non-evictable active work, new workspace
admission fails promptly with retryable `WORKSPACE_RUNTIME_CAPACITY_BUSY` rather
than waiting indefinitely or aborting work. Tests open passive streams in all 256
entries, admit workspace 257 successfully by bounded stream eviction/resync, and
separately prove active background work survives pressure.

An AgentBinding creation failure removes only its typed promise after partial
cleanup. Static config changes require restart and do not hot-replace a live
scope.

### Workspace deletion retirement

Core Workspace deletion, a Workspace classified as doomed during account
deletion, and CLI workspace removal call idempotent
`WorkspaceAgentHost.retireWorkspace()` before provider/storage/record
destruction:

1. host authorizes deletion and marks the Workspace deletion-in-progress in its
   durable admission/store seam so concurrent requests cannot recreate/lease it;
2. mint/consume a `workspace.retire` invocation targeted to that Workspace;
3. Workspace blocks new operations, closes passive streams with reconnect/
   terminal frames, requests cancellation of active/queued work, and waits for
   producer terminal cleanup plus all leases under a configured bound;
4. on timeout/failure, return `WORKSPACE_RETIREMENT_BUSY`; Core/CLI destroys
   nothing and leaves a visible retryable deletion state/admission block;
5. on success, dispose AgentBindings, staged/old generation resources, asset/
   backend/front targets, WorkspaceRuntime/Sandbox, and cache entry exactly once,
   then return an idempotent retirement receipt;
6. only then may Core/CLI destroy provider/storage and delete the record. A
   destroy failure records retryable deletion failure and never resurrects the
   disposed cache; retry resumes from the receipt.

Core-hosted runtimes are process-local, so one process receipt is insufficient.
Every live `WorkspaceAgentScope` registers a durable `(appId, workspaceId,
replicaId, leaseEpoch, expiresAt)` owner record and heartbeats it. Each operation
checks that its owner lease remains current; expiry/fence stops effects. A
Workspace deletion fence publishes a durable retirement job to every live owner.
Provider/storage destruction waits until every non-expired owner has retired and
acked the same fence epoch. An offline owner either resumes and acks or expires;
it cannot resume effects with the stale lease. New owners cannot register after
the fence. Standalone/CLI use an explicit single-process owner adapter. Tests use
two replicas, one offline/expired owner, stale-resume denial, all-owner ack, and
prove provider destruction waits.

A complete retirement receipt also requires durable cleanup of the Workspace's
host session tree and scoped plugin/user state through validated SessionStore/
plugin-store adapters—never raw unchecked paths. Cleanup is journaled,
idempotent, bounded, and retryable; Core Workspace deletion and doomed-account
deletion cannot finalize the Workspace/global user while transcripts or scoped
state remain. Surviving-Workspace actor retirement applies the existing retention
policy only to that actor's namespaces/state and never collaborators' data.

Account deletion first performs an app-lifecycle preflight under serializable
locks. Managed/dedicated/protected Workspaces use the existing app policy and may
return `deletion-forbidden`; if any membership is protected, reject the account
deletion atomically before persisting a fence, cancelling work, changing roles,
or deleting data. App lifecycle transitions themselves must consult the same
Workspace mutation lock so protection cannot race classification.

After preflight, transactionally create a durable **global user-deletion fence**
and per-Workspace mutation fence/epoch before enumerating/classifying
memberships. Core auth/session issuance, request/background issuer creation, and
invocation consumption in every app reject the user fence immediately; revoke
existing auth sessions at fence commit. Only the narrow app-owned retirement-job
issuer bypasses it. Every store path that adds membership, accepts an invite,
transfers/promotes ownership, or creates a Workspace for that user consults the
user fence; every membership/ownership/app-lifecycle mutation for a classified
Workspace consults its fence/epoch. This closes races between classification,
runtime retirement, and database mutation.

Then classify every membership under the held/epoch-fenced ownership state:

- **doomed Workspace:** no surviving owner/promotion path; use full
  `retireWorkspace()` then destroy;
- **surviving Workspace:** co-owner survives or an eligible editor is promoted;
  never retire its shared runtime or cancel collaborators. Instead call
  `retireActor()` to block only the departing actor, close that actor's passive
  streams, cancel/drain only their queued/running operations to terminal cleanup,
  and apply the existing authorized policy for their session/plugin state before
  removing membership;
- **editor/viewer membership:** same actor-scoped retirement; no Workspace
  retirement.

A durable account-deletion journal records user-fence ID, Workspace app ID,
Workspace fence epoch, classification/action, owning host, and receipt. The fence
makes classification stable through retirement; every receipt and final mutation
must match its epoch. On actor-retirement failure, preserve the Workspace and
journal for retry. On survivor success, remove the membership/user-scoped data,
clear the actor-admission block, then clear the Workspace mutation fence without
affecting collaborators. The global user fence remains until all app groups
finish; explicit deletion rollback is the only operation that may clear it early.

Account deletion is global but WorkspaceAgentHost authority is app-owned. The
coordinator groups journal entries by persisted `appId`:

- the current app processes its group locally;
- another app must claim/process its group through that app's own
  WorkspaceAgentHost via a durable internal retirement job; the initiating app
  cannot mint foreign-app authority;
- the global user row is deleted only after every app group has durable receipts;
  an offline/missing app leaves deletion pending/retryable;
- a deployment that intentionally permits only one app per identity database may
  use the simplified path only after startup/runtime validation proves there are
  no foreign-app rows; discovery fails pending rather than deleting them.

All app hosts enforce the shared global user fence on membership/invite/create
paths. CLI remove/re-add creates a fresh scope after a successful receipt.

Tests cover protected/managed preflight with zero mutation; auth/request/MCP/
automation denial immediately after the user fence; retirement-job-only bypass;
membership/invite/promotion/lifecycle attempts after fencing; a new membership
race during enumeration; fence-epoch mismatch; sole-owner destruction; co-owner
survival; editor promotion; editor/viewer active work; collaborator continuity;
actor and doomed-Workspace transcript/plugin cleanup with failure/retry; partial
multi-Workspace retry; two app IDs with one host offline then resumed; two live
runtime replicas plus stale lease denial/all-owner ack; one-app validation failure
on foreign rows; Core delete; CLI remove/re-add; passive SSE; active/queued work;
timeout/provider-destroy retry; survivor unblock; and exact-once disposal.

### Runtime-adapter creation cleanup

R1 freezes one failure contract for every `RuntimeModeAdapter`/WorkspaceRuntime
factory: before returning a complete runtime handle, the adapter must register
acquired resources on a staged rollback stack or self-rollback them before
rejecting. A newly allocated remote provider resource is deleted on failure
unless a durable `SandboxHandleStore` explicitly adopts it for retry; an
already-persisted handle is never deleted as though it were newly allocated.
Cleanup failure is logged as a redacted secondary diagnostic while the original
creation error remains primary. Tests inject failure immediately after provider
acquisition for direct/local/remote adapters and assert no orphan or double
close.

## Migration and rollback

### Preserve

- current Workspace records and persisted `workspaceTypeId`;
- current full-app `default`/`primary` behavior;
- existing Workspace/Sandbox paired lifecycle and lazy request-scoped creation;
- Pi JSONL history and `SessionStore`/`PiSessionStore`;
- import-free authored-directory validation;
- validate CLI process contract where published;
- existing plugin contract and regular server host shells;
- existing non-fatal tool collision behavior;
- existing model/provider selection policy.

### Remove or replace

- authored tool catalog/runtime resolution from #814;
- tools and declared tool refs in the product source value;
- catalog-only validation/errors after consumer audit;
- separate dev app proposed by #816;
- catalog/dev-app CLI proposed by #817;
- Core `GetAgentBehaviorV1` or any equivalent agent composer;
- one combined cache entry that duplicates Workspace/Sandbox per agent or actor;
- actor-specific AgentBinding cache identity;
- singular `workspaceType → agentType` policy shape.

### Rollback

- Before non-default typed sessions exist, removing explicit host policy and
  redeploying normalizes to `default → primary` through the same runtime.
- After non-default typed sessions exist, rollback must use the last known-good
  typed-aware package cohort and policy. A pre-typed binary may not reinterpret
  or hide those sessions.
- Policy/plugin/source rollback is a normal version/config deployment, never a
  mutable registry action.
- Existing workspace/session data is retained; no rollback rewrites history.
- #816/#817/Seneca #16 remain open or close as superseded only after replacement
  PR links and proof exist.

## Test seams

### Highest public seams

- `createWorkspaceAgentServer()` with omitted and explicit policy;
- Core authenticated workspace routes handing an authorized context to the
  Workspace host integration;
- Workspace orchestrator lookup and lifecycle through normal routes/dispatcher;
- `SessionStore`/`PiSessionStore` list/create/load/resume;
- `agent validate` and `agent dev` installed binaries;
- packed Agent/Workspace/Core/CLI consumers;
- Seneca's real host composition.

### Required conformance fixture

One workspace type permits two agent types with visibly different:

- authored instructions;
- plugin prompt sections;
- tools;
- skills;
- Pi package/extension resources.

The fixture proves:

1. both types receive the exact same Workspace and Sandbox object identities;
2. one WorkspaceRuntime/provisioning call occurs;
3. each AgentBinding factory runs once despite concurrent first requests;
4. repeated lookup returns strict-equal bindings;
5. each agent sees only its behavior plugin subset plus standard tools;
6. one agent failure is retryable without breaking the sibling;
7. shared provisioning failure produces one degraded readiness state seen by
   both while non-runtime chat retains current behavior;
8. initial provisioning success and authorized reload publish one monotonic
   generation, refresh loaded bindings, protect dependent effects from partial
   rebuilds, and reload only the requesting actor's selected live session;
9. runtime disposal drains and closes every loaded agent once, while accepted
   and queued/running background work without SSE survives LRU pressure;
   duplicate receipts and queued→running transfer one token, queue-clear releases
   never-started work, running cancellation releases only from terminal cleanup,
   and revocation between HTTP 202 and producer start causes no effect;
10. two users share the same actor-neutral singleton with correct per-run
    attribution and per-operation revalidation;
11. two existing user namespace directories survive restart unchanged while
    sharing that singleton;
12. new sessions use the default, typed execution uses stored type, legacy
    sessions use current default, malformed/disallowed types fail before
    execution load, and ownership-authorized history/delete remain usable;
13. every route/dispatcher operation follows the resolution matrix;
14. public requests cannot choose arbitrary `agentTypeId`.

### Compatibility fixture

With no explicit policy, capture and compare current full-app/standalone:

- route availability;
- prompt section order;
- final tool names and per-Workspace `/api/v1/ready-status` readiness;
- plugin skills/Pi resources;
- model policy;
- session namespace/history;
- Workspace/Sandbox create/dispose counts;
- reload behavior.

Two intentional compatibility deltas are versioned and documented:

1. global `/ready` no longer eagerly creates the compatibility runtime. Before
   first use it reports host/config readiness; after `primary` is loaded it may
   include that scope's readiness. `/api/v1/ready-status` remains the Workspace/
   default-agent readiness surface;
2. an explicitly supplied nonexistent reload/command session ID no longer acts
   as an unvalidated raw harness key or falls back. Omitted session IDs preserve
   current omitted-policy default-session behavior. Plugin-cli migrates its fake
   workspace-ID reload argument in the same cohort.

Tests prove probes never create a second/eager runtime and every current CLI/UI
consumer follows the versioned session branch.

Avoid asserting private helper shape when a server/session seam proves the
contract.

## Implementation slices

Every code slice receives independent Standards and Spec review. Runtime/auth/
session/plugin boundary changes also receive adversarial architecture/security
review. If a slice exceeds its review budget, split it vertically before code;
do not create another abstraction layer merely to satisfy a line target.

### R0 — authority cutover and consumer audit

**Delivers**

- Decision 26, #391 roadmap/vision/modes/alignment, this plan, `HANDOFF.md`,
  `TODO.md`, and #805 plan agree;
- exact PR/merge ancestry and npm publication evidence;
- inventory of every #813–#815 export/error/CLI field, the public/global
  capabilities tool-list contract, and repository/Seneca consumers;
- option-by-option inventory of every current runtime cache-key contributor,
  every direct `registerAgentRoutes`/parallel plugin-runtime owner (including CLI
  workspaces mode), raw Agent/harness/store/Workspace dispatcher consumer, stateful
  trusted-plugin factory/store/context, and actor/request-sensitive tool/Pi/
  template/root/prompt/session callback;
- replacement Bead graph; old `wt-391-forward-c0u` children marked historical
  only after this plan merges;
- P3's stale tool-catalog/custom-tool/v1 dispatch plan marked non-dispatchable
  pending a post-#846 recut.

**Recorded result:** [`R0-AUDIT.md`](R0-AUDIT.md). Registry `0.1.90` already
publishes the materializer/catalog/error/validate contracts. The owner resolved
R4.0 by approving one corrective follow-up with atomic repository migration, no
compatibility window, and no dedicated `0.2.0` boundary; R1/C1 remain
independent.

**Proof:** `gh`/ancestry evidence, npm/package export evidence, `rg` consumer
matrix, authority-link grep, `git diff --check`, `pnpm check:golden-path`, `br
lint`, `br dep cycles`, `bv --robot-insights`, independent plan reviews.

**Review budget:** planning/evidence only, 30–45 minutes.

### R1 — split WorkspaceRuntime from one AgentBinding, compatibility first

**Delivers**

- explicit WorkspaceRuntime primitive over the current runtime bundle;
- one embeddable `WorkspaceAgentHost` registered by standalone, Core, and CLI
  workspaces-mode shells;
- Agent factory that consumes an existing WorkspaceRuntime and builds one
  behavior binding;
- Workspace-owned `workspaceId`-only lifecycle/cache with stable-descriptor
  mismatch rejection, bounded passive-stream eviction, idempotent
  `retireWorkspace`, and lazy `primary` normalization;
- complete legacy-option mapping into runtime descriptor, synthetic `primary`
  behavior, and invocation services;
- current standalone/Core/CLI-workspaces hosts route through the one
  orchestrator with one agent type only;
- R1 may temporarily retain the current private actor-scoped primary-binding
  cache while the runtime is extracted; it adds no adapter class/export or
  second runtime path, exposes no explicit multi-agent policy, and R2a removes
  the actor key before R3;
- no behavior-policy or authoring change yet.

**Proof:** compatibility fixture across standalone/Core/CLI workspaces mode;
repository gate forbidding direct host `registerAgentRoutes` and parallel plugin-
runtime/provisioning ownership outside WorkspaceAgentHost; lazy creation,
concurrency dedupe, exact
Workspace/Sandbox/Agent create-dispose counts, root/mode/template/Pi/session/
actor variation never creates a second runtime, provisioning generation/reload/
failure and LRU lease-drain behavior; 256 passive streams permit bounded
257th-workspace eviction/resync while active 202 work survives capacity pressure
and the control-receipt-before-terminal-settlement race; duplicate
receipt/queued follow-up/queue-clear/interrupt/stop lease accounting;
post-provider-acquisition rollback leaves no orphan; package
layering/invariants.

**Boundary:** Agent runtime primitives + Workspace server orchestration + thin
Core/CLI host handoff. Target one reviewable vertical stack; CLI workspaces mode
cannot remain on the old owner while R1 is considered complete.

### R2a — actor-neutral binding façade and session authority

**Delivers**

- narrowed AgentBinding façade with no raw Agent/harness/store reachable through
  the Workspace-hosted object graph; existing standalone package exports remain
  except the catalog/materializer/validate fields explicitly listed for R4;
- privately minted Workspace+actor+session+type handles;
- Workspace-visible actor-multiplexing session router over existing stores;
- preservation of existing per-user session directories in place;
- default/new, legacy/default, malformed, and disallowed metadata behavior
  across the exhaustive invocation-strategy manifest, including history/delete
  without executable binding resolution;
- static tool definitions with authorization/session context supplied only per
  operation;
- actor/session-neutral plugin invocation context and composite state keys;
- one actor-neutral `primary` binding per Workspace; remove the R1 temporary
  actor-scoped adapter before completion.

**Proof:** compile/export no-bypass tests, two-user strict-equal primary binding,
two old namespaces with identical raw session IDs across restart, command/
extension-driven create/open/switch/fork/delete enforcement, handle-partitioned
state/attachments/changes/diagnostics/reload, malformed metadata, token/handle
mutation/replay/wrong-operation/cross-target negatives, route strategy/branch
coverage, and ask-user/stateful-plugin two-Workspace/two-actor negatives.

**Boundary:** Agent + Workspace session/binding façades only. No Core session
table and no multi-agent map yet.

### R2b — authorized request/background ingress and consumer migration

**Delivers**

- opaque request and host-only background-subject invocation resolvers;
- per-operation revalidation for start/status/progress/result/cancel/stop/
  artifact/session/effect operations;
- replace raw `WorkspaceAgentDispatcherResolver.resolveWithWorkspace()` and raw
  `{workspaceId,userId}` dispatcher APIs with the narrowed invocation façade;
- migrate Core integration and Workspace/account deletion through global user +
  Workspace-epoch mutation fences, doomed/full versus survivor/actor retirement,
  and app-owned durable retirement jobs; migrate full-app managed MCP, Agent MCP delegate/share/
  artifact reads, boring-automation hosted/manual/scheduled runs, ask-user and
  every stateful default plugin, and trusted-plugin context; retain no raw
  authorized Workspace across operations;
- Core hands authorized Workspace facts to Workspace without agent inspection;
- public routes use default only and accept no agent selector;
- full-app omitted-policy compatibility.

**Proof:** auth-before-runtime spies; request/background resolver positives;
Core/account deletion with managed/protected preflight, global-fence admission
denial, mutation races, doomed/surviving classification, co-owner/editor
promotion, actor-only drain/unblock, collaborator continuity, transcript/plugin
cleanup retry, partial/cross-app offline retries, multi-replica owner ack/stale-
lease denial, passive/active work, provider-destroy retry, and exact-once
disposal; membership/
capability revocation after resolver creation, between HTTP 202 and
queued/retry/auto-follow-up producer start, and after task start; zero-effect
queued rejection plus status/progress/result/artifact/stop denial; automation and managed-MCP tests;
no raw resolver/Workspace exports to affected consumers; full-app suite.

**Boundary:** Agent/Workspace/Core/full-app/MCP/automation/trusted-plugin consumer
migration. Split package PRs may stack, but R3 cannot activate until all are
merged on one exact cohort.

### R3 — static multi-agent policy and plugin views

**Delivers**

- normalized global agent definitions and per-workspace-type default/allowed
  policy;
- startup graph validation;
- canonical ordered plugin records across server/package surfaces;
- per-agent behavior filtering, including plugin-namespaced provisioned skill
  roots;
- per-workspace effective provisioning union and enforceable generation
  coordinator;
- lazy typed actor-neutral singleton map built only after R2a/R2b;
- standard tools for every type;
- explicit Pi resource policy for configured multi-agent hosts;
- locked global-capabilities DTO migration and authorized default catalog.

**Proof:** required two-agent conformance fixture, startup/error/capability
matrices, plugin cross-leak negatives, one provisioning union, generation reader/
writer concurrency, collisions remain diagnostic, ambient resource negative for
explicit policy, non-member/cross-type capability negatives.

**Boundary:** Workspace/Agent plugin-policy seam; no public selector or
cross-agent delegation.

### R4 — declarative source correction and policy binding

**Delivers**

- simplified frozen authored source with safe metadata/instructions only;
- exact source ID equality with host agent type;
- remove the unused published `0.1.90` authored catalog/tool runtime semantics
  in one separately reviewed corrective follow-up, migrating repository callers
  atomically and preserving unrelated public exports;
- `agent validate` simplified to the declarative contract;
- bind sources to trusted plugin IDs only in host policy.

**Proof:** source bounds/path/symlink/UTF-8/ID/legacy-ref matrix, executable
sentinel, frozen/redacted output, validate human/JSON tests, packed Agent/CLI
consumer, two-agent prompt identity.

**Boundary:** Agent source + validate CLI. R0 found the public `0.1.90`
surface; the owner confirmed it has no consumers and closed R4.0. R4 shipped as
the separately reviewed corrective follow-up documented in
[`R4-PROOF.md`](R4-PROOF.md); I0 retains package-version/publication approval.

### R5 — regular-server `agent dev` and package conformance

**Delivers**

- clean `agent dev` launcher built from current `main`;
- no separate dev app or catalog adapter;
- one-shot and loopback serve through `createWorkspaceAgentServer()`;
- regular global runtime/plugin/model/session policy;
- plugin-cli fake reload-session migration;
- exact-cohort Agent/Workspace/Core/CLI/plugin-cli package proof and docs.

**Proof:** installed-bin validate/dev and plugin-cli plugin-test/reload smoke,
one-shot/serve/regular-server capture
equality, prompt/tool/skill/Pi invocation, signal/listen failure and close-once,
full-app compatibility, build/typecheck/tests/invariants/golden path.

**Boundary:** CLI + conformance/docs.

### R6 — linked #391 Seneca two-product integration and closeout

**Delivers**

- replacement for Seneca #16 from current Seneca `main`;
- declarative sources and trusted Seneca plugins;
- two workspace types with multi-agent-ready policies and one human default each;
- explicit one-shot company/customer workspace seeding where required;
- exact package pins, deployment proof, rollback floor, and PR supersession.

**Proof:** Seneca typecheck/tests/build/image, two-domain auth/type negatives,
two agents sharing one runtime in the configured backend fixture, restart/session
proof, executed rollback/restore, final independent architecture/security/spec
review.

**Boundary:** linked #391 product slice, not an A1/runtime-foundation completion
criterion. Separate Seneca PR and final evidence. No selector, native named
agent delegation, or production domain enablement without #391 gates.

## Dependency graph

```text
R0 → R1 → R2a → R2b → R3
R0 ───────────────────→ R4
R3 + R4 → R5  (#805 A1/runtime foundation complete)
R5 + #391 Core domain/auth/create/frontend/rollback track → R6

R3 → independent follow-up: Boring Pi package/extension seam
R3 → follow-up: Workspace-native pi-subagents executor
R3 → future: human selector/switch/fork UX
```

One coordinator owns synthesis. One writer owns each overlapping worktree. R4
may begin after R0 only when it does not overlap an active R1–R3 Agent-package
writer. R2b may use stacked package PRs, but R3 activation waits for the complete
consumer migration.

## Acceptance

### #805 A1 and Workspace ↔ Agent foundation (through R5)

The #805 foundation is complete when:

1. authored source is declarative identity/safe metadata/instructions only;
2. trusted host policy—not authored data—selects executable plugins;
3. Core authenticates/persists/authorizes but does not resolve or compose
   agents;
4. Workspace owns one shared WorkspaceRuntime and a lazy typed AgentBinding map;
5. Agent loads and executes one requested type against the supplied runtime;
6. compatibility hosts use the same orchestrator as `default → primary` with no
   second path;
7. two differently configured agents demonstrably share exactly one Workspace +
   Sandbox while retaining separate behavior and singleton identity;
8. standard Boring tools are available to both, and plugin behavior does not
   cross-leak;
9. provisioning uses the effective workspace plugin union once;
10. agent-specific failures retry independently; shared failures, reload, and
    disposal follow the locked boundaries;
11. sessions persist trusted type, preserve legacy history, and expose no public
    arbitrary agent selector;
12. one actor-neutral binding serves multiple members with per-run auth;
13. `agent validate` checks only authored data and `agent dev` launches the
    regular server;
14. no authored catalog, separate dev app, Core behavior resolver, AgentHost,
    deployment/publication content-addressed store, mutable registry, or second Workspace/Sandbox authority remains in the
    active path;
15. full-app and packed Agent/Workspace/Core/CLI/plugin-cli compatibility pass;
16. all R0–R5 slices carry exact command/artifact proof and independent review
    with no open P0/P1 finding.

### #391 Step 1A integration (R6)

R6 closes only after the independent #391 Core domain/auth/type/list-select-
create/frontend/typed-rollback track is complete and Seneca consumes the exact
reviewed package cohort. A delay in that product track does not make the #805
package foundation incomplete.

## Out of scope

- public `agentTypeId` route/body/query parameters;
- human agent selector, arbitrary direct non-default chat, switching, or
  productized session forks;
- adapting `pi-subagents` to WorkspaceRuntime;
- implementing the Boring Pi package/extension seam;
- plugin-contributed MCP servers or Step 1B external MCP ingress;
- same-workspace product delegation UX;
- external A2A, durable tasks/events/replay/approvals;
- contracted cross-workspace agents and governed projections;
- per-agent sandbox/process isolation inside one workspace;
- workspace-type-gated plugin HTTP route registration;
- fatal tool collision policy;
- historical agent-definition pinning/version registry;
- model/provider selection in authored data;
- dynamic policy mutation, AgentHost, controller, deployment/publication
  content-addressed storage, publication state,
  marketplace, billing, mounts, or channels.

## Stop conditions

Stop and amend the plan instead of improvising if:

1. one agent type requires a separate Workspace/Sandbox without an explicit
   workspace;
2. Core must inspect prompts/tools/plugins/Pi resources to route a request;
3. actor-neutral singleton execution cannot preserve a supported authorization
   contract;
4. session migration would hide or rewrite reviewed history;
5. a supported published consumer depends on #814 catalog semantics;
6. explicit multi-agent policy requires ambient executable discovery;
7. a plugin assignment is being treated as route authorization;
8. the implementation starts building the deferred Pi package, selector,
   delegation backend, registry, controller, or durable task system.
