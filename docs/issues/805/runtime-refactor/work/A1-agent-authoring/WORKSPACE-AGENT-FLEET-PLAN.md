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
CLI adapter ──────┘                          → EnvironmentLease
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

The `boring-bash` service boundary exposing files/search/watch/exec against one
canonical filesystem under one governed lease. V1 is in process and transport
neutral.

### Environment backend

The Agent/Workspace-neutral `boring-sandbox` provider handle implementing
confinement, persistence, mounts, exec, health, and cleanup.

### Governance admission

The trusted, immutable result of evaluating actor, Workspace, acting Agent,
session/invocation, filesystem bindings, secrets, network, and runtime policy.
An Agent receives an attenuated lease, never the policy evaluator or backend
admin authority.

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
Each consumer root also injects its own `ModelCapabilityIssuer`; Workspace
requests one capability per authorized invocation and never owns credential
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
  invoke(
    input: AgentInvocation,
    context: AgentExecutionContext,
  ): Promise<AgentInvocationResult>
  dispose?(): Promise<void>
}

interface AgentExecutionContext {
  readonly workspace: AuthorizedWorkspaceSnapshot
  readonly actor: InvocationActorSnapshot
  readonly session: AgentSessionContext
  readonly model: ModelInvocationCapability
  readonly environment: EnvironmentOperations
  readonly cancellation: AbortSignal
}
```

Requirements:

- no Fastify request/reply, Core store, CLI registry, raw root path, provider, or
  Sandbox admin object enters the semantic contract;
- all caller/actor/credential/session authority is invocation-scoped;
- source/plugin composition occurs from trusted fleet configuration;
- Workspace calls an injected consumer-specific `ModelCapabilityIssuer` after
  authorization; Core/web retains encrypted BYOK custody and membership-backed
  issuance, while CLI supplies an independent trusted-local adapter;
- Agent receives an opaque invocation-scoped model client/capability, never raw
  reusable credentials, and it is distinct from Environment/shell secrets;
- an instance reused across actors cannot capture the first actor, model
  credential, or lease;
- cancellation and stable result/error semantics survive a future remote adapter;
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

Transport-neutral shared contract:

```ts
interface EnvironmentService {
  acquire(admission: EnvironmentAdmission): Promise<EnvironmentLease>
  invalidate?(selector: EnvironmentSelector): Promise<void>
  close?(): Promise<void>
}

interface EnvironmentLease {
  readonly environmentId: string
  readonly operations: EnvironmentOperations
  readonly grantSummary: SafeEnvironmentGrantSummary
  release(): Promise<void>
}
```

Operations cover the complete current live Workspace surface: bounded binary and
text read/write/edit, list/tree/stat, mkdir, delete, move/rename, find, grep,
event watch, and command execution. F0b inventories every current route/tool/UI/
plugin/CLI/provisioning consumer before F1 freezes the semantic API. F1 freezes
operation/lease/error/cancellation and local `AsyncIterable` watch semantics;
remote wire/backpressure framing remains deferred. Optimistic writes, atomic
rename, symlink/alias/traversal behavior, expiry, and stable errors are explicit.
Expiry rejects new operations, cancels in-flight operations with bounded grace,
and leaves release idempotent.

### Coherence invariant

For one lease, file tools/routes/UI and `exec` observe the exact same underlying
filesystem state. A test must write through each surface and immediately read
through every other surface. No background copy/sync may be required for
convergence.

### Canonical data invariant

The service owns the authoritative working filesystem and its durable
Workspace-to-storage mapping. Provider-backed storage may be local or remote;
Workspace supplies logical identity and stores no provider path/handle. A trusted
service-side `CanonicalFilesystemResolver` maps `(authorized Workspace identity,
filesystemId)` to an opaque storage handle. Admission carries only logical
filesystem ID, access/projection, and constrained virtual destination—never host
root, remote root, source path, cache root, or caller-chosen mount source. Only
provider adapters derive physical paths. Workspace keeps no competing file tree.

### Governance invariant

An admission is compiled by trusted Workspace/governance composition. The
service enforces it. The Agent cannot widen it. Filesystem bindings remain named
and explicit. For shell execution the provider must physically enforce
readonly/readwrite/absent bindings; API-only path checks are insufficient.
Providers report source-of-truth and `physical` versus `advisory` enforcement.
The host-injected deployment trust class and service-compiled required
capabilities determine eligibility before effects. Advisory direct mode may
serve explicitly trusted-local, full, unrestricted grants only; hosted Core can
never select it. bwrap/Vercel accept only requirements their hostile conformance
proves and otherwise fail stably—never downgrade policy.

Secrets are not Environment admission/lease state. An injected server-side
`ExecutionGrantBroker` owns unforgeable, non-enumerable, single-operation grants
bound to Workspace, actor, Agent, invocation, operation, and expiry. Redemption
is atomic and one-time with explicit retry/idempotency semantics. The Environment
service resolves/injects and zeroizes values only for that child process; expiry,
cancellation, or child cleanup revokes them. No Agent-controlled `ExecRequest`
can name/replace a secret reference, and no value/reference becomes global env,
reusable lease, filesystem artifact, session/log/receipt, or cache state.
Model/BYOK credentials use a separate invocation-scoped Agent model capability
and never enter general shell. Concurrent cross-actor, expiry, redeemed-retry,
cancellation, and ignored-cancel leak tests are mandatory.

### Local-first/remote-later rule

F1/F2 define semantic interfaces and an in-process adapter. They do not define
HTTP paths, token format, daemon process, discovery, or retries for a remote
service. Those follow a named remote consumer and must satisfy the same
conformance suite.

## Contract 5 — Sandbox backend (`boring-sandbox`)

The current `SandboxProviderV1` and `WorkspaceSandboxPairV1` are transitional.
The target port is Agent/Workspace-neutral:

```ts
interface EnvironmentBackendProvider {
  readonly providerId: string
  readonly capabilities: EnvironmentBackendCapabilities
  acquire(spec: EnvironmentBackendSpec): Promise<EnvironmentBackendLease>
  invalidate?(selector: EnvironmentBackendSelector): Promise<void>
  close?(): Promise<void>
}
```

The backend lease supplies raw provider operations required by
`boring-bash/server`, health, provisioning, and idempotent release. It does not
return Agent-owned `Workspace`/`Sandbox` types or import Agent/Workspace values.
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
  invokeDefault(input: AuthorizedAgentInvocation): Promise<AgentInvocationResult>
  getSafeStatus(input: AuthorizedStatusRead): Promise<SafeWorkspaceAgentStatus>
  openEnvironment(input: AuthorizedEnvironmentAccess): Promise<EnvironmentLease>
  close(): Promise<void>
}

interface WorkspaceRetirementPort {
  retireWorkspace(input: TrustedHostRetirement): Promise<void>
}
```

Trusted non-default Agent invocation remains deferred and no
`TrustedAgentInvocationInput` type is frozen in v1. Workspace flow:

```text
receive consumer-authorized Workspace context
→ load/initialize WorkspaceAgentState
→ select persisted default or trusted session/internal type
→ validate fleet membership
→ evaluate governance plugins
→ acquire Environment lease
→ obtain/create AgentApplication
→ invoke with per-call context
→ release operation lease
```

Workspace does not re-authenticate web users or emulate CLI trust. Each consumer
must create an unforgeable, operation-scoped `AuthorizedWorkspaceContext`
through its own adapter. UI/CLI file/status/history access uses a separate
Workspace-owned, Agent-independent Environment admission; only Agent execution
requires resolving `defaultAgentTypeId`. UI and CLI never receive raw backend
administration, and Workspace owns watch-lease duration.

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

Workspace owns session persistence, creation/routing, queueing, and cancellation
and creates the actor-multiplexing router before Agent selection. Session
metadata stores acting `agentTypeId`. Agent receives a bounded session snapshot
plus append/emit surface and owns only Agent-specific interpretation.

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
Workspace-global services/routes/bridge/UI, and governance policy compilers.
Agent assignment never authorizes a route. Global plus Agent-specific governance
compilers combine in deterministic host order; their normalized policy inputs,
versions, bindings, runtime/network facts, and safe configuration enter the
policy digest, while secrets do not. A governance plugin contributes policy
resolution, not raw operations or self-issued capabilities.

The existing governance `filesystemBindings` and `company_context` readonly
projection are concrete prior art. F7 generalizes their conformance without
turning plugin assignment into route authorization.

Required proof:

- normal actor receives declared bindings only;
- management view requires distinct trusted grant;
- readonly binding rejects file mutations;
- bash sees the same readonly binding and cannot modify it;
- omitted binding is physically absent from command view;
- lifecycle prepare/dispose/invalidate is bounded and attributed;
- a plugin cannot name another Workspace or mint secret references from model
  input.

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
actor state.

### Environments

Environment lifecycle has two layers. A service-derived backend/storage key over
Workspace, canonical storage, provider/runtime image, enforcement class, network
policy, and compiled view digest may deduplicate expensive backend acquisition.
A separate invocation lease/view is always bound to actor, Agent, session,
invocation, exact operations/bindings, expiry, cancellation, and policy digest
and is never reused across subjects/invocations. Any digest uncertainty or
mismatch fails toward isolation. A narrower view never reuses a broader mount
namespace, operations wrapper, process environment, or grant.

Shared backend lifecycle is reference-counted: one invocation lease release or
expiry cannot cancel/dispose other holders; backend disposal happens after the
last holder and bounded drain. Exec-scoped secret grants are never backend or
lease state. Release/dispose/invalidate are idempotent. Creation/prepare rollback
cleans partial resources. Timeouts and cancellation must not hang close forever.

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
- governance denied;
- environment capability/admission invalid;
- backend unavailable/unsupported requirement;
- environment acquire timeout/cancel/failure;
- operation outside grant;
- environment generation mismatch;
- Agent application unavailable.

Public errors do not disclose other Workspace IDs, fleet internals, plugin
configuration, filesystem roots, secret names/values, provider tokens, or raw
backend errors.

## Security boundaries

1. Core web membership or CLI trusted-local policy authorizes Workspace context.
2. Signup hostname may initialize a default; it cannot authorize Workspace access.
3. Workspace validates Agent identity and evaluates governance.
4. Agent receives attenuated Environment operations, not policy/admin authority.
5. `boring-bash` enforces operation and filesystem coherence.
6. `boring-sandbox` enforces confinement and physical filesystem/network view.
7. Secrets are reference-based and injected per invocation; no general shell
   model key path is introduced.
8. Same-Workspace first-party Agents may share canonical data; this is explicit
   trust, not accidental tool-list isolation.
9. Contracted/untrusted Agents use separate Workspace/governed projection work
   and remain later scope.

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
provisioning/path consumer, package/export/registry consumer, provider mechanics,
session store, #844 data/API, and #845 salvage. F1 cannot freeze until this closes.

**Blocked by:** F0a. **Review:** code-grounding + package architecture.

### F1a — Environment operation and logical-binding contract

Complete operations, logical IDs/no raw roots, bounds/errors/cancellation/local
watch semantics, fake conformance, and service-side canonical resolver port.
Provider enforcement/network facts remain provisional until F2a ratifies them.

**Blocked by:** F0b. **Review:** API + security.

### F1b — admission, lease/view, execution-grant, and lifecycle contract

Backend key versus invocation view, expiry/drain/refcount, governance digest,
provider-required capabilities, secret broker, model-capability separation, and
host composition interfaces.

**Blocked by:** F1a. **Review:** security + lifecycle.

### F2a — Sandbox-neutral backend and provider facts

Neutral port; ratified source-of-truth/enforcement/eligibility matrix; actual
Vercel/bwrap/direct mechanics; old exports retained during expansion. Every
provider/capability row labels network enforcement `physical`, `advisory`, or
`unsupported`; hosted admission with no physical enforcer fails with a stable
unsupported-requirement error. Direct/advisory mode is never hosted-eligible.

**Blocked by:** F1b. **Review:** provider + thermo + security.

### F2b-i — local Environment service

Implement `boring-bash/server`, provider adapters, canonical resolver, lifecycle,
and all normative operations against the F1 ports while old consumer paths remain.

**Blocked by:** F2a. **Review:** service + security + lifecycle.

### F2b-ii — consumer-surface migration and provider conformance

Migrate file/bash/UI/CLI/plugin/provisioning consumers to the Environment service
and prove per-provider read/write/list/stat/mkdir/delete/move/find/grep/watch/exec
same-view plus hostile-policy conformance. Every provider admitted to F8b
publication proves supported operations and same-actor file/exec coherence;
unsupported operations reject stably and make the provider ineligible rather
than silently degrading. A hosted network-policy negative must fail closed when
no physical enforcer is eligible.

**Blocked by:** F2b-i. **Review:** migration + service/security.

### F3a — AgentApplication entrypoint and fleet validator

Dedicated application API, frozen fleet grammar, plugin-role validation,
`ModelCapabilityIssuer` port/fakes and Agent-facing opaque model capability, no
eager runtime. Hosted issuer lands in F5a; trusted-local CLI issuer lands in F6.

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
mapping migration; no unnamed conditional implementation node is presumed.

**Blocked by:** F3a. **Review:** migration + Core persistence + rollback.

### F4b — CLI registry and acting-Agent session metadata

Host-neutral CLI registry store/lock/revision mechanics plus acting
`agentTypeId` metadata adapters for hosted and local durable session stores.
Prove old cohorts tolerate additive typed-session metadata. F4b does not compose
or launch the CLI consumer.

**Blocked by:** F3a. **Review:** sessions + CLI persistence/concurrency.

### F3b-i — Workspace single-Agent orchestrator

Authorized-context API, default resolution, governance admission, real
Environment integration, session router/queue/cancellation, Agent-independent
file/status/history admission, single Agent invocation, failure cleanup.

**Blocked by:** F2b-ii, F3a, F4a, and F4b. **Review:** authority + lifecycle.

### F3b-ii — generation-safe lazy Agent applications

Actor-neutral registry keyed by fleet generation, retry/drain/dispose, and
concurrent sessions. Add one package-internal/conformance-only operation that,
under an already-authorized Workspace context, selects a validated fleet member
and passes through the same session/governance/model/Environment path as default
invocation. F7 uses it to prove two real AgentApplications. No public selector,
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
Core dependency, lifecycle cleanup.

**Blocked by:** F3b-ii. May run in parallel with F5a/F5b.
**Review:** CLI/package + concurrency.

### F7 — two-Agent/governance/canonical-data conformance

Two fleet Agents, same canonical data, narrower view isolation, readonly/absent
file+shell proof, shared-backend refcount, cross-actor secret/model/session leak
negatives, restart/removed-fleet behavior. It validates typed session behavior
already persisted in F4b; it does not introduce session identity.

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
`WorkspaceSandboxPairV1`, Agent-coupled Bash runtime-bundle exports, and obsolete
provider edges. Manifest/import assertions prove `boring-sandbox` exports no
Agent/Workspace types and `boring-bash` exposes the normative Environment
boundary. No publication occurs before this contraction.

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

Every implementation Bead copies its row verbatim and adds concrete changed-file
test paths. Proof bundles are minimums, not substitutes for focused tests:

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
| F0a | none | merged Decision 28 authority diff, #845 SHA/file ledger, replacement Beads; `D+B`; `F0A-PLAN-PROOF.md` records all plan/Fable verdicts | product architecture, plan/spec, thermo, Fable | documentation/tracker revert only; no runtime/data effect | plan-authority merge before any implementation Bead dispatch |
| F0b | F0a | machine-readable and narrative current-main inventory covering every named consumer/provider/export/session/#844/#845 surface; pack/registry facts reproduced; `D`; `F0B-INVENTORY.{md,json}` | code-grounding and package architecture | no-op: evidence-only; supersede with a newer dated inventory | none |
| F1a | F0b | API snapshot + fake conformance for every operation, bounds, stable errors, cancellation, logical IDs, no raw roots, local-watch semantics; `E+G`; `F1A-CONTRACT-PROOF.md` | Environment API and security | additive exports remain unused; revert before consumer migration | none |
| F1b | F1a | admission/view/backend-key state-machine, expiry/drain/refcount, governance digest, grant/model separation, host-root fakes; race/property tests; `E+G`; `F1B-LIFECYCLE-PROOF.md` | security and lifecycle | additive contract/fakes revert; no persisted lease authority | none |
| F2a | F1b | neutral backend tests + ratified provider matrix with source-of-truth and binding/network `physical|advisory|unsupported`; hosted no-physical-network-enforcer negative; no final Agent/Workspace values; `S+G`; `F2A-PROVIDER-PROOF.md` | provider, thermo, security | old provider exports stay live; host selects old path | none |
| F2b-i | F2a | local service conformance for all operations, resolver, lease/view, grant redemption, refcount/drain and failure cleanup while old consumers stay live; `E+S+G`; `F2B-I-SERVICE-PROOF.md` | service, security, lifecycle | consumer-local switch keeps old path; dispose new manager | none |
| F2b-ii | F2b-i | zero unapproved old consumer-path inventory plus provider matrix for all operations, same-view file/exec, watch, hostile bindings/network, stable unsupported errors; `E+S+A+W+L+G`; `F2B-II-MIGRATION-PROOF.md` | migration and service/security | switch each consumer back to retained old path; canonical data is never copied or rewritten | none |
| F3a | F1b | dedicated AgentApplication entrypoint/fleet/plugin-role/model-capability contract tests, eager-runtime negative, pack/import proof; `A+G`; `F3A-APPLICATION-PROOF.md` | Agent API and package layering | additive entrypoint/fakes remain unused | none |
| F4a | F3a | forward/old-reader/old-writer/rollback migration matrix for absent Workspace, legacy null, initialized non-null and CAS; atomic Workspace/member/default tests; main-data `workspaceTypeId` audit; proof writer is dark until a stored-default-aware serve/rollback cohort honors the value or disables execution; `C+W+G`; `F4A-MIGRATION-PROOF.md` | migration, Core persistence, rollback | nullable column and legacy state remain; metadata-ignorant cohort is schema-probe/pre-write rollback only and cannot serve execution after non-null writes; never map null/non-null to another Agent | if audit finds non-default semantic data, block and amend graph with owner-approved mapping migration |
| F4b | F3a | CLI process-lock/revision conflict/crash tests plus hosted/local acting-Agent session round-trip and old-cohort tolerance; `W+L+G`; `F4B-PERSISTENCE-PROOF.md` | sessions and CLI persistence/concurrency | preserve additive values; old cohort reads/ignores without rewriting | none |
| F3b-i | F2b-ii, F3a, F4a, F4b | authorized-context/default/admission/session/Environment single-Agent integration; cancellation, queue and all failure cleanup; `A+W+E+G`; `F3B-I-ORCHESTRATOR-PROOF.md` | authority and lifecycle | consumer switch disables new invocation or uses a stored-default-aware compatible path | none |
| F3b-ii | F3b-i | generation race/retry/drain/dispose/concurrent-session tests plus internal two-real-Agent path proving the same full authority pipeline and no public selector; `A+W+G`; `F3B-II-LIFECYCLE-PROOF.md` | concurrency and session isolation | drain generation and use F3b-i single-default path | none |
| F5a | F3b-ii | isolated-Postgres membership/default tests; Decision-27 issuer matrix: readable BYOK, absent→explicit instance key, both absent→stable fail, unreadable BYOK→fail without fallback, and no ambient Pi/OAuth fallback; intent reserve→user commit→bind→Workspace transaction→retire crash table; orphan/conflict/operator states; clean packed Core+Workspace consumer proves no CLI edge; `C+W+G`; `F5A-WEB-PROOF.md` | auth, transaction, security | disable signup initialization; existing defaults remain honored or execution is unavailable | none |
| F5b | F5a | current-main exact-host/proxy/origin/cookie/CSRF/logout tests plus real-browser signup/logout proof; reviewed #845 salvage/closure evidence; `C+G`; `F5B-AUTH-PROOF.md` | independent web security | revert shared-auth adapter without changing Workspace identity/default data | none |
| F6 | F3b-ii | fleet versus registry schema, initializer immutability, stale-lock/CAS/conflict, folder/workspaces/dev parity, lifecycle cleanup; clean packed CLI+Workspace consumer proves no Core edge; `L+W+G`; `F6-CLI-PROOF.md` | CLI/package and concurrency | local consumer switch preserves registry/default/session values; disable execution rather than reinterpret | none |
| F7 | F5b, F6 | two real AgentApplications through internal Workspace path; same canonical data; narrower file+shell views; readonly/absent and hosted network unsupported negatives; refcount/restart/fleet-drift and cross-actor shell-secret/model/session leak tests; `E+S+A+W+C+L+G`; `F7-CONFORMANCE-PROOF.md` | thermo and governance/security | no data migration; block contraction and publication on any failure | none |
| H2c | F7 | owner reviews F7 proof, exact file/export list, consumer/pack audit, compatibility cohort and restoration plan; signed decision recorded in the Bead/Inbox | owner compatibility and deletion review | no-op gate; rejection returns to plan space | approve exactly named compatibility contraction and file deletions |
| F2c | H2c | zero approved-obsolete export/import inventory, packed compatibility cohort, neutral Sandbox manifest and normative Bash boundary; `E+S+A+W+C+L+G`; `F2C-CONTRACTION-PROOF.md` | package compatibility and final thermo | restore only the pinned default-aware compatibility cohort; never arbitrary pre-fleet artifacts | none; H2c is the blocker |
| F8a | F2c | independent Core-only, CLI-only, combined full-app, and Seneca packed release-candidate fixtures; two signup defaults, restart, session history, unavailable-Agent and default-aware rollback cohort; no publication; full-app test/typecheck/build/e2e plus `G`; `F8A-RELEASE-CANDIDATE-PROOF.md` | release, product, final architecture/security | restore/deploy pinned compatibility cohort preserving stored defaults or leaving execution unavailable | none |
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
- one canonical filesystem serves Agent tools, bash, UI, and CLI;
- governance is physically enforced for file and exec paths;
- two Agents observe the same canonical state without copy/sync;
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

F2/F7 require dual-target/provider, same-file-view, readonly-shell, lifecycle,
and hostile-policy tests. F5 requires real browser shared-auth proof. F6 requires
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
pinned default-aware compatibility cohort that F8a proves. No rollback may reinterpret or silently
map a stored default to `primary` or another Agent.

## Out of scope

- remote Agent/Environment transport and deployment;
- public Agent/default selection;
- per-Workspace allowlists;
- mutable fleet registry/controller;
- copied same-Workspace filesystems;
- custom tenant executable tools;
- external A2A/task durability;
- contracted-agent data hygiene and billing;
- destructive removal of shipped Workspace-type schema/API without a separate
  approved audit/migration.

## Stop conditions

Stop if package pressure requires:

- Agent/Workspace/Core identity in the final Sandbox backend contract;
- Core and CLI sharing one host shell instead of one semantic Workspace API;
- policy evaluation inside Agent or Sandbox provider;
- file API and exec seeing different canonical files;
- a second fleet validator/composer;
- raw host/remote roots or caller-chosen mount sources crossing the logical
  admission boundary instead of service/provider adapters;
- remote wire semantics without a remote consumer;
- actor/credential capture in cached Agent applications;
- silent persisted-default fallback or history rewrite.
