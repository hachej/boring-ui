# #805 Workspace agent fleet and Environment service plan

Status: active package implementation authority under Decision 28.

Product ordering and final acceptance remain in
[`../../../../391/plan.md`](../../../../391/plan.md). This file owns the
reusable Agent, Workspace, `boring-bash`, `boring-sandbox`, and CLI package
contracts. The former [`PLAN.md`](PLAN.md), [`HANDOFF.md`](HANDOFF.md), and
[`TODO.md`](TODO.md) are Decision 26 planning snapshots and non-dispatchable
except for closed R0/R4 evidence explicitly adopted here.

## Goal

Build one service-shaped but initially in-process stack:

```text
Core/web adapter ─┐
                  ├→ Workspace orchestrator → AgentApplication
CLI adapter ──────┘                          → named Environment map
                                             → boring-bash EnvironmentService
                                             → boring-sandbox backend
```

The app supplies one frozen fleet. Each Workspace persists one default fleet
member. Workspace orchestrates Agents and governance. `boring-bash` owns the
coherent Environment service API. `boring-sandbox` owns provider/isolation
backends. Core and CLI are independent consumers.

## Retained completed work

### R0 publication/consumer audit

PR #869 and `R0-AUDIT.md` remain authoritative evidence for current exports,
consumers, runtime owners, plugin/Pi seams, and published package shape. Recheck
that evidence against current main before each migration slice; do not assume
line numbers remain current.

### R4 declarative authoring correction

PR #885 and `R4-PROOF.md` remain complete:

- authored directories contain identity, bounded safe metadata, version, and
  instructions only;
- fixed `agent.json`/`instructions.md` authoring protocol and size limits remain;
- authored executable tool/plugin/package/MCP/model/runtime references remain
  forbidden;
- trusted host configuration supplies executable plugins and fleet composition;
- validate CLI and packed-consumer proof remain valid.

Do not reopen R4 or restore PRs #816/#817/Seneca #16.

## Terms

### Application agent fleet

A deployment-static set of service-shaped Agent applications. Fleet identity is
`agentTypeId`. The fleet is configuration, not a database registry or mutable
control plane.

### Workspace default

A durable `defaultAgentTypeId` stored for one Workspace. It selects default
human/CLI ingress and legacy session fallback. It grants no membership and does
not imply per-Workspace fleet allowlisting.

### Agent application

A model-loop application with declarative source plus trusted behavior plugins.
It accepts an invocation and an injected execution context. V1 calls it in
process; future adapters may call it remotely.

### Environment service

The `boring-bash` boundary that opens named, rooted Environments and exposes
native files/search/watch/exec operations. The ordinary `workspace` Environment
is canonical; another name may be a governance-enforced subset or independent
logical source. V1 is in process and semantically transport-neutral.

### Environment backend

The Agent/Workspace-neutral `boring-sandbox` provider handle implementing
confinement, persistence, mounts, exec, health, and cleanup.

### Environment access

The trusted, immutable governance result for one Environment name: logical
source, allowed path subset, operations, network policy, and expiry, evaluated
for an authorized actor, Workspace, acting Agent, session/invocation, and task.
It is a policy record—not a bearer token—and only trusted Workspace composition
can submit it to the Environment service. Agent receives only opened Environment
operations, never the evaluator or backend/lifecycle authority.

## Dependency direction

Target value-import direction:

```text
Core server/front ──type/value──→ Workspace public consumer API
CLI server/front  ──type/value──→ Workspace public consumer API
Workspace server  ──type/value──→ Agent application API
Workspace server  ──type/value──→ boring-bash shared/client API
Agent server      ──type/value──→ boring-bash shared/client API
boring-bash server ─type/value──→ boring-sandbox shared/provider API
boring-sandbox                ──→ no Agent/Workspace/Core/CLI values
```

Shared/front-safe modules keep existing no-`node:*`, no-`Buffer`, and package
layering invariants. Core and CLI must not value-import each other's adapters.

### Host composition roots

Workspace receives a prebuilt `EnvironmentService`; it never selects a provider.
`boring-bash/server` constructs the service around an injected neutral backend.
The concrete web application root and CLI executable root may each import
`boring-bash/server` plus explicitly selected `boring-sandbox/providers/*`, then
inject the result into their independent Workspace consumer. Generic Core,
Workspace, Agent, and CLI consumer modules contain no provider-specific branch.
Each consumer root also injects its own `ModelClientIssuer`; Workspace
requests one opaque model client per authorized invocation and never owns credential
custody. Manifest/import tests enumerate these allowed and forbidden edges. The
host also injects a non-caller-controlled deployment trust class
(`hosted` or `trusted-local`) used by provider eligibility.

## Contract 1 — AgentApplication

The contract lives in a dedicated server-neutral
`@hachej/boring-agent/application` export. It contains no Fastify/UI/Core/CLI,
Workspace implementation, or Sandbox-provider values. Workspace server may
import it; Workspace front/shared may not.

Conceptual contract:

```ts
interface AgentApplication {
  readonly agentTypeId: AgentTypeId
  start(
    input: AgentInvocationInput,
    context: AgentExecutionContext,
  ): Promise<AgentInvocation>
  dispose?(): Promise<void>
}

interface AgentInvocation {
  readonly events: AsyncIterable<AgentInvocationEvent>
  readonly result: Promise<AgentInvocationResult>
  send(input: AgentFollowUpInput): Promise<void>
  interrupt(): Promise<void>
  stop(): Promise<void>
}

interface AgentExecutionContext {
  readonly session: AgentSessionRuntime
  readonly model: ModelClient
  readonly environments: ReadonlyMap<EnvironmentName, Environment>
}
```

Requirements:

- no Fastify request/reply, Core store, CLI registry, raw root path, provider, or
  Sandbox admin object enters the semantic contract;
- caller/actor authority stays in Workspace; Agent receives only the Pi-backed
  session runtime, opaque model client, and readonly opened-Environment map;
- source/plugin composition occurs from trusted fleet configuration;
- Workspace calls an injected consumer-specific `ModelClientIssuer` after
  authorization; Core/web retains encrypted BYOK custody and membership-backed
  issuance, while CLI supplies an independent trusted-local adapter;
- Agent receives an opaque invocation-scoped model client, never raw
  reusable credentials, and it is distinct from Environment/shell secrets;
- Workspace owns session authority/attribution while `AgentSessionRuntime`
  delegates transcript persistence, replay, follow-up queue, and model-loop
  mechanics to the existing Pi harness;
- an instance reused across actors cannot capture the first actor, model client,
  session runtime, Environment, or cancellation channel;
- `result` is the terminal fence: the event stream ends no later than terminal
  settlement, `send` rejects after it, and `stop`/cancellation drive bounded
  terminal settlement; `interrupt` may end only the current turn;
- streaming events, follow-up, interrupt, stop, and stable result/error semantics
  survive a future remote adapter without serializing local objects;
- no HTTP/A2A wire schema is frozen in v1.

The existing Agent route/harness/session implementations are migration inputs.
Agent remains responsible for model-loop behavior; Workspace remains responsible
for selecting and invoking one application.

## Contract 2 — ApplicationAgentFleet

Conceptual normalized value:

```ts
interface ApplicationAgentFleet {
  readonly applicationDefaultAgentTypeId: AgentTypeId
  readonly agents: readonly AgentApplicationDefinition[]
}

interface AgentApplicationDefinition {
  readonly agentTypeId: AgentTypeId
  readonly source: AuthoredAgentSourceV1
  readonly pluginIds: readonly string[]
}
```

Workspace owns validation/copy/freeze:

- one canonical AgentTypeId grammar;
- non-empty fleet and unique IDs;
- application default exists;
- source `definitionId` equals `agentTypeId` exactly;
- every plugin reference resolves to one trusted installed plugin;
- validation does not instantiate models, tools, AgentApps, Environments, or
  provider resources;
- deterministic diagnostics include safe provenance but no secrets/prompts;
- startup failure is global to that consumer instance.

The host and CLI YAML may have different external syntax. Both compile to this
same semantic value and use the same conformance fixture.

## Contract 3 — WorkspaceAgentState

Workspace defines the semantic persistence port; Core DB and CLI registry supply
adapters. The normative hosted representation is a nullable
`workspaces.default_agent_type_id` column, not a separate agent-state row.
Missing Workspace, legacy null column, and initialized non-null column are the
three states.

```ts
interface WorkspaceAgentMetadata {
  readonly workspaceId: string
  readonly defaultAgentTypeId: AgentTypeId | null // null only for legacy rows
}

interface WorkspaceAgentMetadataStore {
  get(workspaceId: string): Promise<WorkspaceAgentMetadata | null>
  initializeLegacyDefault(input: {
    workspaceId: string
    applicationDefaultAgentTypeId: AgentTypeId
  }): Promise<WorkspaceAgentMetadata> // CAS requires existing null column
}
```

New hosted Workspace row, owner membership, and validated non-null default commit
atomically in one Core-adapter transaction; incomplete new state is never treated
as legacy. Workspace validates the fleet member before Core persists it, without
Core implementing a second fleet validator. If the auth user commits first,
short-lived durable signup-initialization state makes Workspace creation
idempotently retryable with the original mapped Agent and cannot rewrite an
existing Workspace. The hostname itself is not Workspace identity.

CLI maps a registry entry missing the new YAML key to legacy null, while a
missing registry entry means no Workspace. Folder mode and `agent dev` register
or load the same path-derived Workspace entry; no in-memory-only default is
allowed. CLI uses a single-writer lock plus local registry-entry revision/mtime
conflict check and fails closed on concurrent initialization rather than
promising database CAS. This local file-write guard is not the hosted fleet/
deployment publication CAS rejected by Decision 28.

V1 deliberately omits a general update method. Rules:

- new Workspace creation always persists a Workspace-validated fleet member;
- legacy null initializes once from the application default, never signup domain;
- an existing non-null default is never changed by login, domain, invite, list,
  reload, or fleet normalization;
- partial/conflicting initialization has a stable corruption/recovery outcome;
- a missing fleet member yields stable execution-unavailable error;
- ownership-authorized history/list/delete remains accessible;
- default identity survives restart and is not held only in process memory.

## Contract 4 — Environment service (`boring-bash`)

The final shared contract has five concepts: pure invocation attribution,
governance-produced access for one name, a trusted open service, Agent-facing
native Environment operations, and a hidden Sandbox backend.

```ts
type AuthorizedInvocation = Readonly<{
  readonly workspaceId: string
  readonly actorId: string
  readonly invocationId: string
  readonly purpose: InvocationPurpose
} & (
  | {
      readonly kind: 'agent-invocation'
      readonly agentTypeId: string
      readonly sessionId: string
      readonly taskId: string
      readonly delegatedByAgentTypeId?: string
    }
  | {
      readonly kind: 'member-operation'
      readonly consumer: 'web' | 'cli'
      readonly operation: MemberEnvironmentOperation
    }
)>

interface EnvironmentPathRule {
  readonly sourcePath: string
  readonly environmentPath: string
  readonly access: 'readonly' | 'readwrite' | 'absent'
}

interface EnvironmentAccess {
  readonly name: EnvironmentName
  readonly source: LogicalEnvironmentId
  readonly paths: readonly EnvironmentPathRule[]
  readonly operations: readonly EnvironmentOperation[]
  readonly network: NetworkAccess
  readonly expiresAt: string
}

interface EnvironmentService {
  open(request: {
    readonly invocation: AuthorizedInvocation
    readonly access: EnvironmentAccess
    readonly cancellation: AbortSignal // Environment-lifetime cancellation
  }): Promise<{
    readonly environment: Environment
    close(): Promise<void>
  }>
}

interface Environment {
  readonly name: EnvironmentName
  // bounded read/write/edit/list/stat/mkdir/delete/move/find/grep
  // current invalidation/resync watch semantics
  // exec inside this Environment only
  // every operation also receives an operation-scoped AbortSignal
}
```

`AuthorizedInvocation` is pure/loggable data for either an Agent invocation or
an Agent-independent member file operation; the latter never invents Agent,
session, or task identity. `EnvironmentAccess` is a policy record, not a
capability token. Only trusted Workspace composition receives the
service; Agent/fleet code receives a readonly map of already-opened
Environments. The `open` signal owns the Environment lifetime; each operation
also receives a distinct operation/turn signal. `interrupt()` aborts current-turn
operations without closing Environments needed for follow-up; stop, lifetime
cancel, expiry, or shutdown ends the Environment lifetime. Cancellation is never
attribution data.
The Workspace runner retains every returned `close()`; partial multi-name open
or Agent start failure closes every Environment immediately. After successful
start, the Environments remain open for the complete streaming/control lifetime.
The runner wraps `result` as the terminal fence and closes exactly once before
the outward result settles. `stop`, cancellation, expiry, and orchestrator
shutdown drive bounded terminal settlement/drain and cleanup. Agent-facing
`Environment` exposes no lifecycle or provider administration.

The native Environment-backed file/shell base set remains `read`, `write`,
`edit`, `find`, `grep`, `ls`, and `bash`; this is not a claim that the whole Agent
tool catalog has only seven tools. F0b inventories every upload/UI/automation/
plugin/diagnostics/isolated-code tool name, schema, composition source, and file/
exec dependency, then assigns an explicit retain/migrate/disable disposition.
No model-visible `stat`/`mkdir`/`delete`/`move`/`watch` tool is silently added.
Each Environment-backed tool input gains
a required `environment: EnvironmentName`. The shared boring-bash tool factory
performs one exact lookup in the readonly invocation map, rejects an unknown/
absent name stably, and calls that Environment's native method with the remaining
input (`ls` maps to `Environment.list`). Tool descriptions list only available
names, never roots or policy. Other Environment operations serve authorized UI/CLI/internal consumers and
require separate approval before model exposure. Existing tools unrelated to
files/exec keep their existing owner; every retained upload/plugin/UI/automation/
diagnostics tool that does touch files or exec must select one opened Environment
by name and cannot retain a raw Workspace/Sandbox/provider bypass.
There is no default, ambient mount, type translation, duplicate file API, or
Agent-specific local/remote strategy; one tool call is permanently bound to one
opened Environment.

The current conditional `execute_isolated_code` path is explicit migration input,
not an authority exception. If retained as a model tool, F2b-ii must redefine it
over one required selected Environment's native `exec` without caller-selected
Sandbox ID, image, packages, provider, or administration; otherwise it is disabled
in F2b-ii and deletion waits for H2c/F2c.

Final Agent code has no `RuntimeBundle`, named-filesystem operations adapter,
provider mode, or local/remote branch. Temporary omission→`workspace` migration
compatibility, if required for old recorded tool calls, disappears at F2c.

Operations cover the complete live surface: bounded binary/text read/write/edit,
list/tree/stat, mkdir, delete, move/rename, find, grep, current invalidation/
`resync-required` watch, and command execution. Operation permission remains
explicit so governance may distinguish write from delete/move. Optimistic writes,
atomic rename, traversal/symlink behavior, output bounds/truncation, expiry,
cancellation, and stable errors are frozen. Watch is not a journal and adds no
cursor/exactly-once contract.

### Named Environment and coherence invariant

A former named filesystem is now one named Environment. Names are unique within
an invocation. Each Environment has one rooted filesystem, one operation set,
one network policy, and optional `exec`.
One command executes in exactly one Environment and cannot mount or ambiently
read another. File tools/routes/UI and `exec` within that name use identical
paths and underlying data. `workspace` names the ordinary canonical Workspace
Environment. Other names such as `company-context` or `delegated-input` are
independent logical sources or physically enforced subset views.

`EnvironmentAccess.source` is logical. Each path rule maps an approved
`sourcePath` to `environmentPath` inside the one root; omission means absence and
explicit `absent` overrides access. Effective path authority is the intersection
of the listed operation verb and the matching path effect; neither can broaden
the other. The trusted service resolves this to provider storage.
Workspace/governance never
emits raw host/remote/cache roots, and Agent never chooses a mount source. Two
named Environments may reference different governed views of one canonical
source without copying or synchronizing it. Write-through-every-surface and
delegated-subset hostile tests prove coherence and non-escape.

### Governance-plugin invariant

Workspace gives trusted governance plugins the authorized actor, Workspace,
acting Agent, session/invocation, and trusted delegation/task purpose set by the
Workspace operation—not self-asserted by Agent code. Plugins compile
zero or more `EnvironmentAccess` records. Composition is deterministic and
fail-closed: rules for the same source/name intersect rather than broaden, a
deny cannot be overridden by later order, conflicts reject, and a new logical
source requires the plugin/host authority that owns it. The Agent cannot request
an absent name or widen source, paths, operations, network, or expiry.

`boring-governance` must migrate from its hard-coded Fastify/raw-root/
`company_context` temporary-copy binding path to this compiler role. It resolves
policy only; `boring-bash` resolves logical sources and `boring-sandbox`
physically materializes readonly/readwrite/absent path views. A delegated Agent
therefore receives only the specific named Environment subset approved for that
Agent and task. Route authorization remains independent of Agent assignment.

For `exec`, the provider's physical root must be the exact approved view; API-
only checks are insufficient. Providers report `physical`, `advisory`, or
`unsupported` for required file/network behavior. Hosted open fails before
effects when exact enforcement is unavailable; direct/advisory is trusted-local
only.

The current command-credential mechanism is preserved unchanged and is not
replaced by a generic broker, token, redemption, or zeroization protocol. Model
access remains an opaque invocation-scoped client; provider credentials remain
host/backend-only. Credential redesign is deferred to a named remote, untrusted,
or scoped-credential requirement.

Backend acquisition is per-open by default. Reuse is an optional, private
optimization only when it is indistinguishable from fresh state—no process,
`/tmp`, environment, daemon, broader path, secret, or cancellation leakage.
No backend key/digest/refcount enters Workspace, Agent, or the shared contract.

### Local-first/remote-later rule

F1/F2 define semantics and an in-process implementation. They do not define HTTP
paths, token format, daemon, discovery, distributed retries, or remote session
replay. A future remote adapter maps pure data, operations, cancellation, events,
and control onto a transport; it does not require local JavaScript objects to be
serializable and must pass the same conformance suite.

## Contract 5 — Sandbox backend (`boring-sandbox`)

The current `SandboxProviderV1` and `WorkspaceSandboxPairV1` are transitional.
The target port is Agent/Workspace-neutral:

```ts
interface SandboxBackend {
  readonly providerId: string
  readonly capabilities: SandboxBackendCapabilities
  open(spec: SandboxBackendSpec): Promise<{
    readonly operations: SandboxBackendOperations
    captureState?(): Promise<SandboxBackendState>
    close(): Promise<void>
  }>
}
```

This handle is private to `boring-bash/server`. It supplies provider operations,
health/persistence metadata, and idempotent cleanup; Agent-facing `Environment`
never exposes it. The backend does not return Agent-owned `Workspace`/`Sandbox`
types or import Agent/Workspace values.

Cleanup settlement is a server-private Bash/Sandbox responsibility, not an Agent
lease/refcount API. Before calling a survivor-capable provider, the service must
durably record a pre-allocation cleanup intent. The private provider spec carries
that opaque intent ID; provider creation is idempotent/discoverable by it, so a
restart can reclaim or quarantine a resource even if the process dies after
remote creation but before a handle/reference returns. A provider unable to
support that protocol is `unsupported` for survivor-capable hosted use. After
return, the intent atomically binds the provider cleanup reference before
`open()` exposes the Environment. `close()` settles only after confirmed disposal
or an atomic transition into durable quarantine. Startup and bounded janitor work
reconcile intents/quarantine, block reuse, and emit operator-visible failure.
Tests crash before provider call, between provider creation and returned-reference
persistence, and after binding; they prove restart discovery/reclamation, close
rejection/timeout, no reuse, alerting, and shutdown drain. Direct ephemeral
providers may settle immediately when no survivor is possible. Workspace/Agent
never sees the intent, identity, reference, or registry.

Existing `ProviderCapabilities.sourceOfTruth` is retained and extended with an
explicit enforcement-strength fact and required-capability matcher. Same-file-
view and hostile-policy conformance run separately for every provider/capability
row. A sandbox-primary remote provider is valid only when file UI/tools/watch/
exec all route to that same remote authority; initial seeding/provisioning may
copy into an unpublished environment, but after publication no host mirror may
remain live. Mutate-through-exec/read-through-UI proof distinguishes canonical
remote state from inert seed input.

Migration requirements:

- preserve direct/bwrap/Vercel behavior and provider IDs until exact consumers
  migrate;
- preserve provider capability reporting and source-of-truth facts;
- adapt rather than duplicate providers;
- no provider-specific branch enters AgentApplication or Workspace orchestration;
- remote-worker work remains gated by its own security/authority plan;
- no user/Workspace authorization is delegated to provider-reported identity.

## Contract 6 — WorkspaceOrchestrator

Conceptual public server API consumed independently by Core and CLI. Every
member-facing operation requires a consumer-issued, unforgeable,
operation-scoped authorization context. Retirement is a separate trusted host
port; no bare Workspace ID is a member-facing capability.

```ts
interface WorkspaceOrchestrator {
  initializeLegacyWorkspace(input: AuthorizedInitialization): Promise<WorkspaceAgentMetadata>
  startDefault(input: AuthorizedAgentInvocation): Promise<AgentInvocation>
  openMemberEnvironment(input: AuthorizedMemberEnvironmentOpen): Promise<WorkspaceMemberEnvironmentHandle>
  getSafeStatus(input: AuthorizedStatusRead): Promise<SafeWorkspaceAgentStatus>
  close(): Promise<void>
}

interface WorkspaceMemberEnvironmentHandle {
  readonly environment: Environment
  close(): Promise<void> // trusted consumer owner; never Agent-facing
}

interface WorkspaceRetirementPort {
  retireWorkspace(input: TrustedHostRetirement): Promise<void>
}
```

Public non-default Agent selection remains deferred. F3b-ii nevertheless freezes
one package-internal operation used by the trusted Pi delegation backend and F7
conformance—not exported through Core/CLI/HTTP/MCP/A2A:

```ts
interface InternalWorkspaceDelegation {
  startDelegated(input: {
    readonly authorization: AuthorizedWorkspaceContext
    readonly originInvocationId: string
    readonly targetAgentTypeId: AgentTypeId
    readonly purpose: DelegationPurposeId
    readonly invocationInput: AgentInvocationInput
    readonly requestedEnvironmentNames: readonly EnvironmentName[]
  }): Promise<AgentInvocation>
}
```

Workspace verifies that the origin is an active invocation in the same authorized
Workspace and that the target is a fleet member; it allocates the new task and
invocation identities. `purpose` is a host-approved bounded value. Requested
names are non-authoritative intent only. This operation cannot accept a logical
source, path rule, operation set, network rule, expiry, `EnvironmentAccess`, or
opened Environment. Governance derives all access from trusted origin/target/task
facts, and the request runs through the same model/session/open/terminal-cleanup
pipeline as default invocation. Workspace derives lineage from the active origin;
callers cannot submit or truncate it. Every origin→target→purpose edge is freshly
authorized. F0b must identify the actual installed delegation executor and prove
which depth/cycle/timeout/cancellation guards it truly enforces; verified Pi
guards remain authoritative. F3b-ii owns the complete integration contract and
implements any missing depth, cycle, fan-out, execution-timeout, and cascade guard
once in Workspace orchestration—without a second dispatcher or duplicate Pi
model loop. Origin stop/cancel/shutdown cascades to children, and every child's
terminal cleanup completes before its parent outward result. Productized
delegation/selector UX remains later.

Workspace flow:

```text
receive consumer-authorized Workspace context
→ load/initialize WorkspaceAgentState
→ select persisted default or trusted session/internal type
→ validate fleet membership
→ evaluate governance plugins into named EnvironmentAccess records
→ open each approved Environment
→ obtain/create AgentApplication and Pi-backed session runtime
→ start invocation with the readonly Environment map
→ keep Environments for its streaming/control lifetime
→ on start failure or terminal result/stop/cancel/shutdown, close exactly once
→ settle the outward result only after cleanup
```

Workspace does not re-authenticate web users or emulate CLI trust. Each consumer
must create an unforgeable, operation-scoped `AuthorizedWorkspaceContext`
through its own adapter. UI/CLI file/status/history access uses a separate
Workspace-owned, Agent-independent named Environment access using the
`member-operation` authorization variant; it never fabricates Agent/session/task
identity. Only Agent execution resolves `defaultAgentTypeId`. UI and CLI never
receive raw backend administration. HTTP disconnect, watch unsubscribe, request
cancel, and CLI/orchestrator shutdown cancel the operation/lifetime as applicable
and close owner-held Environments exactly once. The endpoint matrix is exact:

| Consumer event | Effect |
| --- | --- |
| one-shot member file success or operation error | owner-scoped `finally` closes that request's handle exactly once |
| one-shot member file disconnect/cancel | abort that operation/lifetime, then owner-scoped `finally` closes that handle |
| member watch natural completion/error/unsubscribe/disconnect | end and close only that subscriber handle in iterator-owner `finally`; never another subscriber |
| Agent start failure | close all opened invocation Environments immediately |
| normal Agent result | terminal runner drains and closes before outward result settlement |
| Pi Agent event-SSE disconnect | unsubscribe the event listener only; do not stop the replayable Agent invocation or close its Environments |
| explicit Agent stop, invocation expiry/lifetime cancel, or orchestrator shutdown | cancel the invocation lifetime, drain operations/children, then close |
| CLI command/serve success, error, or shutdown | owner-scoped `finally` closes only handles/invocations owned by that CLI orchestrator |

No member route calls `EnvironmentService` directly or preserves the existing raw-
Workspace/root bypass. It receives the Workspace facade, opens one trusted handle,
uses the native Environment operation with request-scoped cancellation, and
closes according to this matrix.

## Consumer adapter — Core/web

Core/web continues ordinary auth and current-app membership. Host composition
provides exact signup-domain defaults separately from Core's generic packages.
The adapter:

- derives a trusted normalized hostname under bounded proxy policy;
- maps hostname to an initial fleet ID and durably reserves a bounded signup
  intent before the auth-user side effect, bound to flow nonce/app/mapped Agent;
- after user creation atomically binds that intent to the resulting user, so
  post-auth retry cannot switch domains/default;
- passes the value only while creating the new user's ordinary default Workspace;
- atomically persists Workspace row, owner membership, and non-null default,
  then retires the intent;
- crash tests cover before/after intent reserve, user commit, user binding,
  Workspace transaction, and intent retirement; orphan/conflict is a stable
  operator recovery state, never ordinary-login fallback;
- uses the application default on ordinary creation;
- never filters Workspace lists by domain/default/type;
- never rewrites an existing Workspace;
- hands an authorized Workspace snapshot to the orchestrator.

Shared sibling authentication remains Core auth configuration, independent of
Agent/product routing. Exact Origins, HTTPS/Secure cookies, narrow PSL-safe
parent, CSRF, redirects, and global logout remain security requirements.

## Consumer adapter — CLI

CLI uses two explicit YAML scopes: trusted application-fleet YAML (one fleet per
consumer process, with source/plugin resolution policy) and the existing local
Workspace registry, whose entries persist `defaultAgentTypeId` and canonical
logical Workspace identity. Fleet YAML never embeds per-Workspace state. New
Workspace creation uses the application default unless a clearly named trusted
registry-creation initializer selects another fleet-validated value; it persists
once under the F4b lock and cannot mutate an existing non-null default. Unknown
compatible fields survive upgrade. Folder mode and `agent dev` use the same
registry rather than an ephemeral second Workspace model. The adapter:

- uses trusted local Workspace identity/root policy;
- calls Workspace directly;
- never starts Core or creates a fake web principal;
- does not embed a second fleet validator or Agent composer;
- preserves atomic file publication, acquires a single-writer lock, checks the
  expected registry revision/mtime, and fails closed on concurrent change;
- supports one-shot and serve/dev through the same orchestrator;
- cleans up Agent/Environment/Workspace resources exactly once.

## Sessions

Workspace owns session authorization, stable identity, acting-Agent metadata,
history/delete visibility, invocation routing, and cancellation authority before
Agent selection. The existing Pi harness remains the injected session runtime
for transcript persistence, replay/resume, follow-up queue, event handling, and
model-loop mechanics. Workspace must not fork or recreate those mechanics.

- new default session: persisted Workspace default;
- existing typed session: stored fleet member;
- legacy missing type: persisted Workspace default, after one-time Workspace
  legacy initialization if required;
- malformed/removed type: execution fails; owned history surfaces remain;
- deployment updates use current definition for the same stable type;
- host session transcripts/indexes remain under durable
  `BORING_AGENT_SESSION_ROOT` (or an injected host store), never the canonical
  working filesystem or an ephemeral Environment backend;
- no forced history rewrite;
- concurrent independent sessions retain existing queue/cancellation semantics;
- actor and credentials are per invocation.

## Governance-plugin integration

Workspace owns the plugin composition point. Trusted contributions are grouped
and validated by role: Agent behavior (prompt/tools/skills/Pi resources),
Workspace-global services/routes/bridge/UI, and Environment policy compilers.
Agent assignment never authorizes a route. For each invocation/delegated task,
global plus Agent-specific compilers receive trusted actor, Workspace, acting
Agent, session/invocation, and task-purpose facts and return named
`EnvironmentAccess` records. Safe normalized inputs/versions enter diagnostics;
secrets do not.

Composition may only narrow existing source authority or add a logical source
through the trusted plugin that owns that source. Same-name/source rules
intersect, deny wins, conflicting source/name claims fail closed, and array order
cannot broaden access. Plugins return normalized operation identifiers and
logical path rules, never operation implementations, raw host/provider paths,
provider handles, credentials, or self-authenticating capabilities.

The existing `boring-governance` `filesystemBindings`/`company_context` path is
migration evidence, not final design: it is hard-coded to Fastify/user/raw-root
contexts and constructs a temporary filtered copy. Replace it with a pure
Environment-policy compiler. The Environment service resolves logical sources;
the Sandbox backend materializes exact readonly/readwrite/absent path subsets
over canonical data without a synchronization copy.

Required proof:

- an ordinary invocation receives only declared named Environments;
- a delegated Agent receives a new task-bound policy exposing only the approved
  subset of the source Environment;
- management access requires a distinct trusted policy result;
- readonly denies every file mutation and physical `exec` mutation;
- omitted paths and Environment names are physically absent;
- one command cannot access two named Environments;
- member file operations never fabricate Agent/session/task identity and close on
  disconnect, unsubscribe, cancellation, or CLI/orchestrator shutdown;
- delegation derives immutable lineage, freshly authorizes every edge, reuses
  every verified installed-Pi guard, fills missing depth/cycle/fan-out/execution-
  timeout/cascade once in Workspace, and never creates a second dispatcher;
- policy conflict/ordering cannot broaden a deny;
- lifecycle open/close is bounded, attributed, and quarantine-safe;
- a plugin cannot name an unauthorized logical source or derive authority from
  model-controlled input.

## Caches, concurrency, and lifecycle

### Workspace state

Consumer-local cache keyed by Workspace ID may deduplicate state loads. It must
not make persisted default identity process-local.

### Agent applications

Fleet membership, IDs, application default, authored source identity, and plugin
assignment are immutable for one consumer lifetime and change only by restart.
A lazy promise map keyed by `(workspaceId, agentTypeId, fleetGeneration)` is
permitted for actor-neutral instances. Rejected creation is removed after exact
cleanup. A trusted development reload may create a bounded behavior-resource
generation without mutating fleet membership/default/assignment; it drains and
disposes stale instances before new invocations. Instances retire with their
Workspace orchestrator scope. If a concrete AgentApplication cannot be
actor-neutral, it declares invocation-scoped lifetime rather than capturing
actor state. Workspace tracks active invocation runners; orchestrator `close()`
stops and bounded-drains them, closes Environments, and only then disposes
AgentApplications.

### Environments

Workspace opens each governance-approved name independently and retains its
owner-only close function. Agent receives the `Environment` operation object but
not close/provider lifecycle. Per-open backend acquisition is the required v1
behavior. Open is atomic: policy/provider failure exposes nothing; partial
source/view/backend work is cleaned. Agent start failure closes immediately.
After start, Environments remain open until the terminal `result` fence; events
end by that settlement. Close is idempotent and exactly once. Interrupt is never
a terminal cause. The first observed terminal cause among normal result, stop,
lifetime cancellation, expiry, provider-fatal error, or shutdown wins; later
operation completion cannot turn a terminal failure into success. Stop, cancellation,
expiry, or orchestrator shutdown drives bounded terminal drain and cleanup, and
the outward result settles only after cleanup; operations/watch terminate with
stable errors and cannot hang cleanup forever. A close rejection/timeout converts
an otherwise-successful invocation into stable `ENV_CLEANUP_FAILED`; an existing
primary invocation error remains primary with cleanup failure attached to audit
diagnostics. Unconfirmed resources are quarantined from reuse and handed to a
bounded host janitor/alert path; ownership is never silently dropped before
disposal completes or quarantine is recorded.

Backend reuse is optional and private. If later enabled, reused state must be
indistinguishable from fresh: no leftover process, `/tmp`, environment variable,
daemon, path, credential, cancellation, or other invocation state. No generic
reuse/refcount protocol is required by v1 or exposed to callers.

### Reload

V1 reload refreshes deployment-static fleet/plugin resources only through normal
restart or an existing explicitly authorized development reload. It never
rewrites persisted Workspace defaults. Loaded Agent/Environment generations
must not mix old and new policy within one invocation.

## Errors

Every new failure has a stable code. Minimum classes:

- invalid/duplicate fleet definition;
- application default absent from fleet;
- source/fleet identity mismatch;
- persisted Workspace default absent from fleet;
- default initialization conflict;
- governance denied or conflicting named-Environment policy;
- unauthorized logical source/name or invalid path subset;
- backend unavailable/unsupported physical requirement;
- environment open timeout/cancel/failure;
- environment cleanup failure/quarantine;
- operation timeout/cancel or path outside Environment access;
- environment generation mismatch;
- Agent application unavailable.

Public errors do not disclose other Workspace IDs, fleet internals, plugin
configuration, filesystem roots, secret names/values, provider tokens, or raw
backend errors.

## Security boundaries

1. Core web membership or CLI trusted-local policy authorizes Workspace context.
2. Signup hostname may initialize a default; it cannot authorize Workspace access.
3. Workspace validates Agent identity and evaluates governance.
4. Agent receives only opened named Environments, opaque model client, and
   Pi-backed session runtime—not policy/service/backend/lifecycle authority.
5. `boring-bash` enforces operations, path subsets, expiry, and file/exec
   coherence for each Environment name.
6. `boring-sandbox` enforces the exact physical root, subset, and network view.
7. Existing command-credential behavior remains unchanged; model/provider
   credentials never enter general Environment access.
8. Same-Workspace first-party Agents may share canonical source data, but a
   delegated Agent sees only the separately governed Environment subset issued
   for its invocation/task.
9. Ambient cross-Workspace membership or ACL grants remain forbidden; future
   contracted work reuses task-bound named Environment policy, not live ACLs.

## Corrective migration

### #844

- retain historical migration;
- add nullable hosted default-agent persistence additively and initialize per
  app through the validated application default;
- tighten application write invariants only in this delivery: do not add database
  `NOT NULL` or remove legacy-null semantics; any later constraint requires
  post-cutover writer/data proof and a separate migration;
- run the non-default `workspaceTypeId` data audit before any pinning migration;
- pin/demote Workspace type to compatibility `default` only when audit is clean;
- if real non-default rows exist, stop and dispatch a conditional owner-approved
  migration with before/after artifact mapping each row; never coerce silently;
- audit published consumers before any API/column removal.

### #845

- close/supersede current typed-product implementation;
- recreate hostname/shared-auth tests/utilities in the web adapter slice;
- do not cherry-pick the product graph wholesale;
- record exact salvage/discard disposition and reviewed SHA.

### Current package edges

- remove final `boring-sandbox` imports of Agent-owned Workspace/Sandbox values;
- move consumer-visible environment service types into `boring-bash/shared`;
- keep provider implementations in `boring-sandbox`;
- migrate Agent/Workspace/Core/CLI consumers through expand → migrate → contract;
- contract/delete obsolete exports only after packed-consumer audit and explicit
  compatibility decision. No file deletion occurs without owner approval.

## Normative implementation slices and DAG

Every slice is one bounded PR unless its review budget explicitly permits a
stack. Security/auth/migration/provider slices require independent specialist
review. This DAG is the only implementation ordering authority; #391 uses
product umbrellas and points here.

### F0a — authority and Bead reset

Decision/docs/historical banners, golden-path validation metadata/script, and replacement graph only. Record PR #845's
exact reviewed head/base plus file-by-file salvage/discard destination ledger
before its later closure. No runtime code. Four independent plan rounds plus
owner-authorized Fable review converge before merge.

**Blocked by:** none. **Review:** product architecture + plan/spec + thermo +
Fable. **Human gate:** plan-authority merge before implementation dispatch.

### F0b — current consumer/provider/publication inventory

Refresh R0 against current main; inventory every live file/bash/watch/search/
provisioning/path consumer and every base/upload/UI/automation/plugin/diagnostics/
isolated-code tool name, schema, composition source and file/exec dependency,
including conditional `execute_isolated_code`; package/export/registry consumer, provider mechanics,
session store, #844 data/API, #845 salvage, and the actual installed Agent-
delegation executor with exact depth/cycle/fan-out/execution-timeout/cancellation/
cascade enforcement facts. Record trusted-local model source/precedence/model-
selection behavior for environment keys, Pi auth/settings, OAuth/subscriptions,
and missing/unreadable cases. F1 cannot freeze until this closes.

**Blocked by:** F0a. **Review:** code-grounding + package architecture.

### F1a — native named Environment operation contract

Freeze one rooted `Environment` with complete native operations, explicit
operation permission, one Environment name/source, bounded errors, ordinary
filesystem concurrency, operation-scoped cancellation, and current invalidation/
`resync-required` watch. Keep the native Environment-backed base tools; each
requires an Environment name, exact-selects one object, and calls it directly.
Freeze the F0b disposition rule for every other tool/file-exec dependency. No
ambient default, raw roots, filesystem adapter,
local/remote mode, lifecycle method, or provider value enters the Agent-facing
contract. Provider enforcement facts remain provisional until F2a.

**Blocked by:** F0b. **Review:** API + security.

### F1b — Environment access, governance compiler, and lifecycle contract

Freeze pure `AuthorizedInvocation`, one-name `EnvironmentAccess`, deterministic
fail-closed governance composition, trusted-only `EnvironmentService.open`,
a runtime cancellation channel, invocation-unique names, Workspace-owned terminal
lifetime/idempotent cleanup/expiry, and provider-required capabilities. Start
failure closes immediately; after start, result/stop/cancel/shutdown follows one
bounded terminal fence and the outward result settles only after cleanup.
Preserve current command-credential behavior and
separate model/provider credentials. Do not add generic lease/view, bearer token,
secret broker, backend key/refcount, or remote-wire machinery.

**Blocked by:** F1a. **Review:** security + lifecycle.

### F2a — Sandbox-neutral backend and provider facts

Neutral port; ratified source-of-truth/enforcement/eligibility matrix; actual
Vercel/bwrap/direct mechanics; old exports retained during expansion. Every
provider/capability row labels network enforcement and survivor-acquisition
recovery (`pre-intent + idempotent/discoverable create`) as `physical`, `advisory`,
or `unsupported`; hosted `open()` with no physical enforcer/recovery fails with a stable
unsupported-requirement error. Direct/advisory mode is never hosted-eligible.

**Blocked by:** F1b. **Review:** provider + thermo + security.

### F2b-i — local Environment service

Implement `boring-bash/server` named Environment open/close, logical source plus
path-subset resolution, native operations, physical file/exec/network equivalence,
provider adapters, expiry/cancellation, and cleanup settlement while old paths
remain. Survivor-capable providers record pre-allocation intent before provider
call, create idempotently/discoverably by intent, bind returned reference before
exposure, quarantine failed close, and reconcile on restart; ephemeral providers
may settle directly.
Per-open acquisition is the v1 requirement; reuse is optional/private and need
not be implemented.

**Blocked by:** F2a. **Review:** service + security + lifecycle.

### F2b-ii — native consumer wiring and provider conformance

Retain the native Environment-backed base tools and wire each required-name call
to one selected Environment—do not rebuild per provider or add a second file API.
Apply the F0b retain/migrate/disable ledger to upload/UI/automation/plugin/
diagnostics/isolated-code tools; every retained file/exec dependency binds one
Environment and unknown/absent names reject. Migrate consumers, replace `filesystemId` with
Environment names, and remove active Agent
`RuntimeBundle`/local-remote use. Compatibility files/exports remain inert until
H2c-authorized F2c deletion. Prove every operation, current watch
invalidation, same-name file/exec coherence, one-command/one-Environment
isolation, hostile subset policy, and stable provider rejection. A hosted network
negative fails closed when no physical enforcer is eligible.

**Blocked by:** F2b-i. **Review:** migration + service/security.

### F3a — AgentApplication entrypoint and fleet validator

Dedicated streaming/control application API (`start`, events/result, send,
interrupt, stop), frozen fleet grammar, plugin-role validation,
`ModelClientIssuer` port/fakes, Pi-backed `AgentSessionRuntime`, and
Agent-facing readonly Environment map. No eager runtime or captured invocation
state. Hosted issuer lands in F5a; trusted-local CLI issuer lands in F6.

**Blocked by:** F1b; may run in parallel with F2a/F2b-i/F2b-ii against fakes.
**Review:** Agent API + package layering.

### F4a — hosted default persistence and #844 correction

Hosted nullable Workspace column, atomic Workspace/member/default transaction,
legacy CAS, old-cohort nullable-field tolerance, and `workspaceTypeId` audit/
demotion. The non-null writer lands dark/unreachable: it cannot persist an
authoritative value until a stored-default-aware serving and rollback cohort is
deployed that honors the value or disables Agent execution. A metadata-ignorant
old cohort is only a pre-activation schema-compatibility probe, never a serving
rollback after non-null writes. If non-default data exists, an inactive Human Intention gate blocks
F4a and requires the graph to be amended with an owner-approved before/after
mapping migration; no unnamed conditional implementation node is presumed. The
activation is an ordered, fail-closed tracker procedure: stop F4a; idempotently
change H4a `.26` from deferred to open/`ready-for-human`; add `.13 blocks-on .26`;
verify the graph; only then request the owner decision. A partial update keeps
F4a stopped and the same procedure resumes/reconciles before work. Approval creates the named mapping-migration
Bead and adds it as another `.13` blocker before H4a closes.

**Blocked by:** F3a. **Review:** migration + Core persistence + rollback.

### F4b — CLI registry and acting-Agent session metadata

Host-neutral CLI registry store/lock/revision mechanics plus acting
`agentTypeId` metadata adapters over existing hosted/local Pi session stores.
Prove old cohorts and CLI/Pi transcript colocation survive. Workspace does not
reimplement Pi transcript/replay/follow-up-queue/model-loop mechanics. F4b does
not compose or launch the CLI consumer.

**Blocked by:** F3a. **Review:** sessions + CLI persistence/concurrency.

### F3b-i — Workspace single-Agent orchestrator

Authorized-context API, default resolution, Environment-policy compiler
composition, open/close ownership, Pi session-runtime injection, Agent-independent
file/status/history access, single streaming/control Agent invocation, and the
terminal cleanup fence: immediate start-failure close, result/stop/cancel/shutdown
bounded drain, exactly-once close, outward result after cleanup. Keep fleet,
session attribution, governance, lifecycle, and
orchestration as small internal components behind one Workspace facade—not one
mutable `WorkspaceRuntime` god object.

**Blocked by:** F2b-ii, F3a, F4a, and F4b. **Review:** authority + lifecycle.

### F3b-ii — generation-safe lazy Agent applications

Actor-neutral registry keyed by fleet generation, retry/drain/dispose, and
concurrent sessions. Add one package-internal/conformance-only operation that,
under an already-authorized Workspace context, verifies an active same-Workspace
origin, selects a validated target, allocates task/invocation identity, accepts
only bounded host-approved purpose plus non-authoritative requested Environment
names. Reuse every F0b-verified Pi delegation guard and complete any missing
lineage/depth/cycle/fan-out/execution-timeout/cascade behavior once in Workspace,
without a second dispatcher/model loop. Then pass through the same session/
governance/model/open/terminal-cleanup path as default. It accepts no source/path/operation/network/expiry/
`EnvironmentAccess` or opened Environment. F7 uses it to prove two real
AgentApplications. No public selector,
UX, remote delegation, or externally stable non-default input contract ships.

**Blocked by:** F3b-i. **Review:** concurrency + session isolation.

### F5a — Core/web consumer and signup initialization

Membership adapter, atomic create path, idempotent pending signup operation,
hostname-to-initial-default mapping only, no type filtering, and separate clean
packed Core+Workspace fixture with no CLI dependency. Hosted model issuance
proves the Decision-27 matrix: readable Workspace BYOK wins; absent BYOK uses
only explicit instance `ANTHROPIC_API_KEY`; both absent fails stably; configured-
but-unreadable BYOK fails without instance fallback; ambient Pi auth/OAuth is
never a hosted fallback. Retry whose originally bound Agent no longer exists in
the fleet fails terminally and never coerces to another default.

**Blocked by:** F3b-ii. **Review:** auth + transaction/security.

### F5b — shared sibling auth and PR #845 disposition

Recreate exact host/proxy/origin/cookie/CSRF/logout/browser proof from current
main, record salvage/discard map, and close/supersede #845.

**Blocked by:** F5a. **Review:** independent web-security review.

### F6 — independent CLI consumer and regular dev

Fleet YAML scope, consumption of F4b's host-neutral registry store/lock,
folder/workspaces/dev modes, separate clean packed CLI+Workspace fixture with no
Core dependency, lifecycle cleanup, and the trusted-local `ModelClientIssuer`.
It issues one opaque client per authorized invocation, never exposes/captures raw
credentials or writes them to sessions/Environments/logs, and has no Core/BYOK
fallback. Trusted-local CLI deliberately preserves the current Pi sources and
precedence—explicit environment API keys, Pi auth/settings, and supported OAuth/
subscription credentials—plus current CLI/Pi model-selection semantics. F0b
records the exact precedence and readable/missing/unreadable cases; F6 freezes
parity and stable failures. After migration `ModelClientIssuer` is the sole model-
client construction seam: the harness cannot independently construct `AuthStorage`
or `ModelRegistry` and no source bypasses issuance. Hosted ambient fallback
remains forbidden; these trusted-local sources are not hosted policy.

**Blocked by:** F3b-ii. May run in parallel with F5a/F5b.
**Review:** CLI/package + concurrency.

### F7 — two-Agent/delegation/governance conformance

Two fleet Agents plus a delegated task whose target Agent receives only a
separately named Environment over an approved source subset. Prove fresh edge
authorization, Workspace-derived lineage, every verified Pi guard, Workspace's
single completion of missing depth/cycle/fan-out/execution-timeout/cascade, and
child cleanup before parent result without a second dispatcher. Prove canonical
source coherence without copy, readonly/readwrite/absent file+shell enforcement,
one command cannot access two Environments, deny/intersection ordering, normal
filesystem write semantics, optional/no backend reuse, and cross-actor
Environment/model/session isolation. Validate existing Pi session and delegation behavior,
restart, and removed-fleet handling.

**Blocked by:** F5b and F6. **Review:** thermo + governance/security.

### H2c — Human Intention: approve compatibility contraction/deletions

Review green F7 proof, the exact obsolete-export/file list, packed compatibility
cohort, consumer audit, and restoration plan. Approval authorizes only the named
F2c contraction; rejection returns to plan space. This gate does not implement
or delete anything.

**Blocked by:** F7. **Review/owner:** explicit owner compatibility and file-
deletion approval.

### F2c — contract obsolete Agent-coupled Environment exports

After H2c approval, remove/contract only the approved transitional
`WorkspaceSandboxPairV1`, Agent-coupled `RuntimeBundle`, named-filesystem
adapters, local/remote Agent branches, generic lease/view/grant machinery, and
obsolete provider edges. Manifest/import assertions prove `boring-sandbox`
exports no Agent/Workspace types and `boring-bash` exposes the native named
Environment boundary. No publication occurs before this contraction.

**Blocked by:** H2c. **Review:** package compatibility + final thermo.

### F8a — contracted packed release-candidate and Seneca qualification

Prove independent and combined packed consumers from the contracted cohort,
full-app/Seneca two signup defaults, production restart, session/history safety,
and the pinned default-aware rollback cohort. Do not publish.

**Blocked by:** F2c. **Review:** release + product + final architecture/security.

### H8 — Human Intention: approve exact publication/release

Review F8a's exact SHA/version/integrity/proof packet and rollback cohort.
Approval names only that immutable cohort and target registry/environment;
rejection or drift returns to F8a. This gate performs no publication.

**Blocked by:** F8a. **Review/owner:** explicit publication/release approval.

### F8b — exact publication and post-release proof

Publish only the H8-approved immutable cohort, install from the target registry
with no workspace/link/file/source fallback, run post-publication full-app and
Seneca smoke, record integrity/provenance, and close the delivery.

**Blocked by:** H8. **Review:** release operations + final product/security.

```text
F0a → F0b → F1a → F1b
                    ├→ F2a → F2b-i → F2b-ii ─┐
                    └→ F3a ─┬→ F4a ───────┤
                             └→ F4b ───────┤
                              └────────────┴→ F3b-i → F3b-ii
                                                   ├→ F5a → F5b ─┐
                                                   └→ F6 ────────┤
                                                                 ▼
                                                                F7 → H2c → F2c → F8a → H8 → F8b
```

### Replacement Bead map

Root epic: `wt-391-forward-step1a-current-xn9` (retitled/re-scoped to Decision
28; former open Decision-26 descendants are deferred, while closed R0/R4 remain
evidence).

| Symbol | Bead | Symbol | Bead |
| --- | --- | --- | --- |
| F0a | `wt-391-forward-step1a-current-xn9.5` | F0b | `.6` |
| F1a | `.7` | F1b | `.8` |
| F2a | `.9` | F2b-i | `.10` |
| F2b-ii | `.11` | F3a | `.12` |
| F4a | `.13` | F4b | `.14` |
| F3b-i | `.15` | F3b-ii | `.16` |
| F5a | `.17` | F5b | `.18` |
| F6 | `.19` | F7 | `.20` |
| H2c | `.21` | F2c | `.22` |
| F8a | `.23` | H8 | `.24` |
| F8b | `.25` | conditional H4a | `.26` (deferred/non-blocking unless audit triggers) |

## Per-slice acceptance, proof, rollback, and gates

Every implementation Bead carries the same semantic scope, acceptance, review,
rollback, proof artifact, and blockers as its row, with concrete changed-file
test paths where useful. Proof bundles are minimums, not substitutes for focused
tests:

- **D:** `git diff --check && pnpm check:golden-path` plus changed-Markdown link
  validation and a Decision-28 active-authority scan.
- **B:** `br lint <replacement-ids> && br dep cycles && bv --robot-insights`.
- **E:** `pnpm --filter @hachej/boring-bash test && pnpm --filter
  @hachej/boring-bash typecheck && pnpm --filter @hachej/boring-bash build`.
- **S:** the equivalent `test`, `typecheck`, and `build` commands for
  `@hachej/boring-sandbox`.
- **A/W/C/L:** the equivalent package commands for Agent, Workspace, Core, and
  CLI respectively; every pack-facing slice also tests a clean tarball consumer.
- **G:** `pnpm audit:imports && pnpm lint:invariants && pnpm check:golden-path &&
  git diff --check`.

| Node | Exact blockers | Acceptance artifact and minimum proof | Named review | Rollback | Blocking Human Intention |
| --- | --- | --- | --- | --- | --- |
| F0a | none | merged Decision 28 authority diff, #845 SHA/file ledger, replacement Beads; generic and simplified-bundle Fable verdicts plus Flue/Eve evidence; `D+B`; `F0A-PLAN-PROOF.md` | product architecture, plan/spec, thermo, Fable, owner abstraction review | documentation/tracker revert only; no runtime/data effect | plan-authority merge before any implementation Bead dispatch |
| F0b | F0a | machine-readable and narrative current-main inventory covering every named consumer/provider/export/session/#844/#845 surface, full base/upload/UI/automation/plugin/diagnostics/isolated-code tool ledger/dispositions, installed delegation executor/guard matrix, trusted-local model-source/precedence matrix, all runtime/filesystem adapters, and governance Fastify/raw-root/temporary-copy path; pack/registry facts reproduced; `D`; `F0B-INVENTORY.{md,json}` | code-grounding, governance and package architecture | no-op: evidence-only; supersede with a newer dated inventory | none |
| F1a | F0b | API snapshot + fake conformance for one named rooted Environment, every operation/permission, operation-scoped cancellation, bounds, stable errors, ordinary concurrent writes and current invalidation watch; native Environment-backed base tools remain read/write/edit/find/grep/ls/bash, require Environment name, exact-map-select one, reject unknown/absent, and add no ambient default/destructive base tool/duplicate API/provider mode; full tool ledger plus execute_isolated_code disposition explicit; `E+G`; `F1A-CONTRACT-PROOF.md` | Environment API and security | additive exports remain unused; revert before consumer migration | none |
| F1b | F1a | pure discriminated Agent-invocation/member-operation identity with no fake Agent/session/task; member-handle endpoint matrix (one-shot success/error/cancel/disconnect, watch completion/error/unsubscribe, Agent start/result/lifetime, Pi-SSE unsubscribe-only, CLI success/error/shutdown), all owner-scoped finally; trusted purpose; unique names; source-path→environment-path access and governance tests; Environment-lifetime versus operation/turn cancellation; partial-open/expiry and terminal-fence tests; close rejection/timeout converts success to stable cleanup failure, preserves primary failure with audit detail, quarantines before ownership release; credential separation/no generic lease/token/broker/reuse; `E+W+G`; `F1B-LIFECYCLE-PROOF.md` | security, governance, and lifecycle | additive contract/fakes revert; no persisted Environment authority | none |
| F2a | F1b | neutral backend + provider matrix with source/binding/network and survivor pre-intent/idempotent-discovery recovery as `physical|advisory|unsupported`; hosted no-physical-enforcer/recovery negatives; no final Agent/Workspace values; `S+G`; `F2A-PROVIDER-PROOF.md` | provider, thermo, security | old provider exports stay live; host selects old path | none |
| F2b-i | F2a | named Environment conformance for source/subset, operations, physical equivalence, expiry/cancellation, per-open and partial failure; survivor resources have durable pre-intent before provider call, idempotent/discoverable create, crash-between-create-and-reference restart reclaim, binding before exposure, confirmed close or quarantine/reconcile/no-reuse/alert/shutdown proof; `E+S+G`; `F2B-I-SERVICE-PROOF.md` | service, security, lifecycle | consumer-local switch keeps old path; close new service resources | none |
| F2b-ii | F2b-i | base read/write/edit/find/grep/ls/bash use required Environment names and native calls; every upload/UI/automation/plugin/diagnostics/isolated-code ledger item has reviewed retain/migrate/disable disposition and any file/exec tool uses one Environment; execute_isolated_code has no Sandbox/provider controls; zero active old-path consumers while files/exports await H2c/F2c; endpoint cleanup/coherence/subset/network negatives; `E+S+A+W+L+G`; `F2B-II-MIGRATION-PROOF.md` | migration and service/security | switch consumers to retained old path; canonical data is never copied or rewritten | none |
| F3a | F1b | streaming/control AgentApplication entrypoint, Workspace-owned fleet validator, Pi-backed session-runtime/model-client/readonly-Environment-map contract tests, eager/capture negatives, pack/import proof; `A+W+G`; `F3A-APPLICATION-PROOF.md` | Agent API and package layering | additive entrypoint/fakes remain unused | none |
| F4a | F3a | forward/old-reader/old-writer/rollback migration matrix for absent Workspace, legacy null, initialized non-null and CAS; atomic Workspace/member/default tests; main-data `workspaceTypeId` audit; proof writer is dark until a stored-default-aware serve/rollback cohort honors the value or disables execution; `C+W+G`; `F4A-MIGRATION-PROOF.md` | migration, Core persistence, rollback | nullable column and legacy state remain; metadata-ignorant cohort is schema-probe/pre-write rollback only and cannot serve execution after non-null writes; never map null/non-null to another Agent | if audit finds non-default semantic data, block and amend graph with owner-approved mapping migration |
| conditional H4a | related to F4a until audit; ordered fail-closed activation stops F4a, idempotently opens/labels `.26`, adds `.13 blocks-on .26`, verifies graph, and reconciles partial update before resume | owner decision records anonymized semantics/counts, exact mapping/dry-run/validation/rollback; approval creates named migration Bead and adds it as `.13` blocker before H4a closes; gate mutates no data | owner migration/data review | no-op; unresolved trigger keeps F4a blocked | approve the new mapping-migration Bead before data mutation |
| F4b | F3a | CLI process-lock/revision conflict/crash plus acting-Agent metadata adapters over existing hosted/local Pi stores; transcript/replay/follow-up queue and CLI/Pi colocation remain intact; old-cohort tolerance; `W+L+G`; `F4B-PERSISTENCE-PROOF.md` | sessions and CLI persistence/concurrency | preserve additive values and existing Pi mechanics; old cohort reads/ignores without rewriting | none |
| F3b-i | F2b-ii, F3a, F4a, F4b | authorized/default flow plus member-operation file path with no fake Agent/session/task; policy compilation, Pi session runtime, stream/control; operation interrupt versus lifetime cancellation; start/result/stop/cancel/expiry/shutdown plus full one-shot/watch/Pi-SSE/CLI success-error-cancel-disconnect owner-finally matrix; close rejection/timeout stable precedence/quarantine, exactly-once close before outward result; no-god-object assertion; `A+W+E+G`; `F3B-I-ORCHESTRATOR-PROOF.md` | authority, governance, and lifecycle | consumer switch disables new invocation or uses a stored-default-aware compatible path | none |
| F3b-ii | F3b-i | generation/concurrency plus internal two-Agent path: active origin/target, immutable lineage, fresh edge auth; prove F0b executor matrix, reuse verified Pi guards and implement missing depth/cycle/fan-out/execution-timeout/cascade once in Workspace with no second dispatcher; child cleanup before parent terminal; Workspace IDs, non-authoritative names, no accepted Environment authority, no public selector; `A+W+G`; `F3B-II-LIFECYCLE-PROOF.md` | concurrency, session and delegation isolation | drain generation and use F3b-i single-default path | none |
| F5a | F3b-ii | isolated-Postgres membership/default tests; Decision-27 issuer matrix: readable BYOK, absent→explicit instance key, both absent→stable fail, unreadable BYOK→fail without fallback, and no ambient Pi/OAuth fallback; intent reserve→user commit→bind→Workspace transaction→retire crash table; orphan/conflict/operator states; clean packed Core+Workspace consumer proves no CLI edge; `C+W+G`; `F5A-WEB-PROOF.md` | auth, transaction, security | disable signup initialization; existing defaults remain honored or execution is unavailable | none |
| F5b | F5a | current-main exact-host/proxy/origin/cookie/CSRF/logout tests plus real-browser signup/logout proof; reviewed #845 salvage/closure evidence; `C+G`; `F5B-AUTH-PROOF.md` | independent web security | revert shared-auth adapter without changing Workspace identity/default data | none |
| F6 | F3b-ii | fleet/registry/lock/mode/Environment/Pi-session parity; trusted-local ModelClientIssuer solely constructs one opaque client, preserving F0b-recorded environment-key/Pi-auth-settings/OAuth-subscription precedence and model selection with missing/unreadable tests; no raw/session/Environment/log leak, Core/BYOK/independent-harness bypass or hosted ambient fallback; clean CLI+Workspace no Core; `L+W+G`; `F6-CLI-PROOF.md` | CLI/package and concurrency | local consumer switch preserves registry/default/session values; disable execution rather than reinterpret | none |
| F7 | F5b, F6 | two real AgentApplications plus delegated task; fresh edge auth, Workspace lineage, verified Pi guards plus one Workspace completion of missing depth/cycle/fan-out/execution-timeout/cascade with no duplicate dispatcher, child-before-parent cleanup; target-only subset, canonical no-copy source, readonly/readwrite/absent file+shell, one-command/one-Environment, policy/network negatives, normal writes, no-required-reuse, restart/fleet drift and cross-actor Environment/model/Pi-session isolation; `E+S+A+W+C+L+G`; `F7-CONFORMANCE-PROOF.md` | thermo and governance/security | no data migration; block contraction and publication on any failure | none |
| H2c | F7 | owner reviews F7 proof, exact file/export list, consumer/pack audit, compatibility cohort and restoration plan; signed decision recorded in the Bead/Inbox | owner compatibility and deletion review | no-op gate; rejection returns to plan space | approve exactly named compatibility contraction and file deletions |
| F2c | H2c | zero approved-obsolete `WorkspaceSandboxPairV1`/`RuntimeBundle`/filesystem-adapter/local-remote/lease-token-broker exports or imports; native Environment package boundary, neutral Sandbox manifest and packed compatibility cohort; `E+S+A+W+C+L+G`; `F2C-CONTRACTION-PROOF.md` | package compatibility and final thermo | restore only the pinned default-aware compatibility cohort; never arbitrary pre-fleet artifacts | none; H2c is the blocker |
| F8a | F2c | independent Core-only, CLI-only, combined full-app, and Seneca packed release-candidate fixtures; streaming Agent API, Pi-session compatibility, native named Environments, delegated subset, canonical no-copy storage, two signup defaults, restart, session history, unavailable-Agent and default-aware rollback cohort; no publication; full-app test/typecheck/build/e2e plus `G`; `F8A-RELEASE-CANDIDATE-PROOF.md` | release, product, final architecture/security | restore/deploy pinned compatibility cohort preserving stored defaults or leaving execution unavailable | none |
| H8 | F8a | owner reviews exact immutable SHA/version/integrity/proof packet, target, and rollback cohort; signed decision recorded in Bead/Inbox | owner publication/release review | no-op gate; rejection/drift returns to F8a | approve exactly named publication/release cohort |
| F8b | H8 | publish approved cohort; empty-cache registry install with no workspace/link/file/source fallback; post-publication full-app/Seneca smoke; integrity/provenance record; `G`; `F8B-PUBLICATION-PROOF.md` | release operations and final product/security | redeploy the H8-approved pinned compatibility cohort; preserve stored defaults or disable execution | none; H8 is the blocker |

## Package-level acceptance

- `boring-bash/shared` owns transport-neutral Environment contracts.
- `boring-sandbox` has no final Agent/Workspace value imports.
- AgentApp is service-shaped but v1 in-process and its dedicated entrypoint has
  no UI/Fastify/Workspace implementation/provider values.
- Workspace validates one static fleet and persists/resolves defaults through a
  port.
- Core/web and CLI adapters are independent.
- the `workspace` Environment gives Agent tools, bash, UI, and CLI one canonical
  filesystem; native base read/write/edit/find/grep/ls/bash select one opened
  Environment by required name, while every other current tool has a reviewed
  retain/migrate/disable disposition and no raw file/exec bypass;
- Agent-independent member operations use their own authorization variant and
  bounded disconnect/unsubscribe/shutdown cleanup;
- governance compiles named Environment source/subset/operation/network access,
  physically enforced for both files and one-Environment-only exec;
- delegated Agents observe only their approved subset without copy/sync, with
  Workspace-derived lineage, verified Pi guards, and one Workspace-owned
  completion of missing recursion/fan-out/timeout/cascade behavior;
- terminal cleanup failures cannot produce success or release unquarantined state;
- sessions/defaults survive restart and fail safely on fleet drift;
- current direct/bwrap/Vercel behavior remains green;
- packed external consumers prove exports and dependency direction.

## Proof

Each slice runs its package-focused build/typecheck/tests plus applicable:

```bash
pnpm audit:imports
pnpm lint:invariants
pnpm check:golden-path
git diff --check
```

F2/F7 require provider, native-Pi-tool, same-named-Environment file/exec,
delegated-subset, readonly-shell, one-command/one-Environment, lifecycle, and
hostile-policy tests. F5 requires real browser shared-auth proof. F6 requires
clean CLI fixtures. F8a requires clean packed release-candidate consumers; F8b
requires empty-cache exact registry consumers and post-publication smoke.

## Rollback

Expand/migrate/contract keeps existing provider and Agent route behavior until
all independent consumers pass the new conformance. F4a/F4b are additive: prior
serving Core/CLI paths tolerate and ignore the new nullable default/session
metadata without rewriting it. F5/F6 cut over behind consumer-local rollout
switches. Before persisted defaults exist, rollback to current main is safe.
After F4/F5/F6, rollback must preserve stored values and either honor the stored
Agent type or leave execution unavailable; an arbitrary pre-fleet path is not a
valid rollback. H2c approves and F2c contracts after green F7 and before F8a.
After F2c, removed exports are restored only through the explicitly packed/
pinned default-aware compatibility cohort that F8a proves. No rollback may
reinterpret or silently map a stored default to `primary` or another Agent.

## Out of scope

- remote Agent/Environment transport and deployment;
- public Agent/default selection;
- per-Workspace allowlists;
- mutable fleet registry/controller;
- copied same-Workspace or delegated-subset Environments;
- custom tenant executable tools;
- external A2A/task durability;
- contracted-agent data hygiene and billing;
- destructive removal of shipped Workspace-type schema/API without a separate
  approved audit/migration.

## Stop conditions

Stop if package pressure requires:

- Agent/Workspace/Core identity in the final Sandbox backend contract;
- Core and CLI sharing one host shell instead of one semantic Workspace API;
- policy evaluation or `EnvironmentService.open()` access inside Agent or
  Sandbox provider;
- file API and exec inside one Environment seeing different roots;
- one `exec` ambiently mounting or reading multiple named Environments;
- governance retaining the temporary filtered-copy projection as final design;
- a second fleet validator/composer;
- raw host/remote roots or caller-chosen sources crossing EnvironmentAccess
  instead of logical source IDs resolved by service/provider internals;
- remote wire semantics without a remote consumer;
- actor/credential capture in cached Agent applications;
- silent persisted-default fallback or history rewrite.
