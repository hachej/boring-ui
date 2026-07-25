---
github: https://github.com/hachej/boring-ui/issues/391
issue: 391
state: ready-for-agent
updated: 2026-07-21
flag: not-needed
track: owner
---

# gh-391 — application agent fleet, Workspace orchestration, and shared execution environments

## Authority

This is the product roadmap, product-gate, correction, and release authority
for #391. Decision 28 owns durable invariants. The #805 fleet plan is the sole
source for implementation node definitions, dependency edges, and replacement
Bead acceptance; diagrams here are non-normative mirrors.

- Durable ruling: [`../../DECISIONS.md`](../../DECISIONS.md), Decision 28.
- Package implementation and exact replacement Bead map under root
  `wt-391-forward-step1a-current-xn9`:
  [`../805/runtime-refactor/work/A1-agent-authoring/WORKSPACE-AGENT-FLEET-PLAN.md`](../805/runtime-refactor/work/A1-agent-authoring/WORKSPACE-AGENT-FLEET-PLAN.md).
- Consumption modes: [`AGENT-CONSUMPTION-MODES.md`](AGENT-CONSUMPTION-MODES.md).
- Ownership: [`OWNERSHIP.md`](OWNERSHIP.md).
- Retained work alignment: [`ROADMAP-ALIGNMENT.md`](ROADMAP-ALIGNMENT.md).

All TypeScript in this product plan is illustrative vocabulary. Normative
package interfaces and exact field names live only in the #805 fleet plan.

Decision 28 supersedes Decision 26's domain-routed Workspace-type product
partition. The old C1–C4 typed-product plan and the old #805 R1–R6 graph are
non-dispatchable until their open Beads are rewritten by this recut. Closed R0
publication evidence and closed R4 declarative-authoring work remain valid.

## Owner-approved premise

Boring is an application platform with a deployment-static fleet of agent
applications. Core/web and CLI are independent consumers of Workspace.
Workspace bundles and orchestrates the fleet. Agent runs one application. In
v1, every configured fleet member is available to every authorized Workspace;
there is no per-Workspace Agent allowlist. The persisted default controls default
ingress, not fleet membership. `boring-bash` exposes one transport-neutral execution-environment service over
`boring-sandbox` providers.

```text
Core/web consumer ─┐
                   ├→ Workspace orchestrator
CLI consumer ──────┘    ├→ AgentApp primary
                        ├→ AgentApp legal
                        └→ AgentApp research
                               │
                               ▼
                    boring-bash EnvironmentService
                               │
                               ▼
                    boring-sandbox backend/provider
```

Every Workspace durably stores one `defaultAgentTypeId`. A trusted signup domain
may initialize that value for a newly created default Workspace. The domain has
no continuing routing, membership, selection, or authorization effect.

The first implementation is service-shaped but in-process. The contracts must
permit future remote Agent and Environment adapters without adding network
transport, service discovery, distributed task durability, or remote deployment
to this delivery.

## Product journeys

### Web signup through an agent domain

```text
exact trusted signup hostname
→ host-owned hostname-to-agent mapping
→ durably reserve bounded signup intent
→ authenticate/create user and bind intent
→ atomically create ordinary default Workspace + owner membership + persisted default
→ Workspace invokes that AgentApp
```

Rules:

- the mapping value must name one member of the validated application fleet;
- the mapping is trusted host configuration, never a body/query/header value;
- email domain does not select an agent;
- an invite joins the invited Workspace and never rewrites its default agent;
- login through another domain never creates a Workspace or changes an existing
  default;
- ordinary membership is the only authority for Workspace access;
- the signup hostname is discarded after initialization and is not persisted as
  product identity.

### Ordinary web use

```text
authenticated user
→ verify current-app Workspace membership
→ load Workspace
→ Workspace reads defaultAgentTypeId
→ validate it against the current app fleet
→ invoke AgentApp with governed Environment capability
```

Workspace listing and selection are unchanged by hostname. There is no product
membership, type-filtered portfolio, or domain-specific chooser.

### CLI use

```text
trusted CLI YAML
→ validate app fleet + CLI Workspace metadata
→ select/create local Workspace
→ persist/resolve Workspace.defaultAgentTypeId
→ instantiate Workspace directly
→ invoke AgentApp
```

CLI does not start Core, forge a hosted actor, call a private Core route, or use
Core as its Workspace adapter. It consumes the same Workspace contracts through
its own trusted-local adapter.

### Several agents in one Workspace

The application fleet is available to Workspace. Human ingress initially uses
the persisted default. Workspace may internally invoke another fleet member
through a trusted operation after Step 2 product approval. Agent identity is
behavior identity, not membership or isolation.

All first-party fleet agents use the same canonical Workspace environment API.
They may share one underlying environment when their compiled governance grant
and runtime identity are compatible. A narrower grant receives a separate
execution view over the same canonical filesystem—not a copied filesystem.

## Package ownership

TypeScript below is illustrative product vocabulary. The #805 fleet plan is the
single normative source for package interfaces and exact field names.

### Core

Core owns:

- web authentication and current-app Workspace membership;
- ordinary Workspace row/member persistence adapters;
- exact trusted request-host normalization needed by web signup/auth;
- forwarding a trusted signup initialization value supplied by host composition;
- web routes and safe browser projections.

Core is one consumer of Workspace. It does not:

- define or validate the application agent fleet;
- map Workspace types to agents;
- compose AgentApps, plugins, prompts, tools, skills, models, or environments;
- filter membership by domain, Workspace type, or agent type;
- own the Workspace orchestrator or Environment service;
- provide a runtime path required by CLI.

Core may physically persist `defaultAgentTypeId` through a Workspace-defined
persistence port. That does not make Core the semantic owner of agent policy.

### CLI

CLI owns:

- trusted YAML ingestion and validation errors at the CLI edge;
- local Workspace registry persistence/compatibility;
- trusted-local actor/workspace selection;
- one-shot, serve, and development lifecycle UX.

CLI independently consumes Workspace. It does not import Core product/auth
policy or route through Core HTTP.

### Workspace

Workspace owns:

- the application agent-fleet contract and startup validation;
- durable Workspace default-agent semantics;
- validation that a persisted default exists in the deployed fleet;
- AgentApp composition and lookup;
- invocation/session attribution;
- governance-plugin composition;
- environment admission and capability issuance;
- orchestration between fleet agents;
- lazy actor-neutral AgentApp instances keyed by `(workspaceId, fleetGeneration,
  agentTypeId)` when instance reuse is safe.

Workspace does not implement filesystem/bash operations or Sandbox providers.
It consumes `boring-bash`'s service contract.

### Agent

Agent owns one service-shaped application contract published from a dedicated
server-neutral `@hachej/boring-agent/application` entrypoint. That entrypoint has
no Fastify, UI, Core, CLI, Workspace implementation, or Sandbox-provider value
imports; Workspace server may import it, while Workspace front/shared may not.

```ts
interface AgentApplication {
  readonly agentTypeId: string
  invoke(input: AgentInvocation, context: AgentExecutionContext): Promise<AgentInvocationResult>
}
```

An AgentApp owns:

- declarative identity/instructions plus trusted behavior plugins;
- model loop and Agent-specific tool/prompt/skill/Pi composition;
- Agent-specific session behavior and result mapping.

It receives governed environment operations plus an opaque invocation-scoped
model capability. Core/web supplies the encrypted-BYOK issuer after membership;
CLI supplies an independent trusted-local issuer; Workspace requests one per
authorized invocation. A cached AgentApp never captures raw/reusable model
credentials. Hosted resolution proves readable BYOK, explicit instance-key
fallback only when BYOK is absent, stable failure when both are absent or BYOK is
unreadable, and no ambient Pi/OAuth fallback. Agent does not create Workspaces,
verify membership, evaluate governance policy, mint capabilities, provision
arbitrary sandboxes, or own HTTP/server deployment. The initial adapter is an
in-process call. A remote adapter is a later consumer of the same semantic
contract.

### `@hachej/boring-bash`

`boring-bash` owns the execution-environment service interface because it owns
the consumer-visible coherence contract for files and shell execution:

```ts
interface EnvironmentService {
  acquire(admission: EnvironmentAdmission): Promise<EnvironmentLease>
}

interface EnvironmentLease {
  readonly environmentId: string
  readonly operations: EnvironmentOperations
  release(): Promise<void>
}

interface EnvironmentOperations {
  read(input: FileRead): Promise<FileReadResult>
  write(input: FileWrite): Promise<FileWriteResult>
  edit(input: FileEdit): Promise<FileEditResult>
  list(input: FileList): Promise<FileListResult>
  stat(input: FileStat): Promise<FileStatResult>
  mkdir(input: FileMkdir): Promise<FileMkdirResult>
  delete(input: FileDelete): Promise<FileDeleteResult>
  move(input: FileMove): Promise<FileMoveResult>
  find(input: FileFind): Promise<FileFindResult>
  grep(input: FileGrep): Promise<FileGrepResult>
  watch(input: FileWatch): AsyncIterable<FileEvent>
  exec(input: ExecRequest): Promise<ExecResult>
}
```

The concrete contract will reuse and narrow existing `FilesystemBinding`,
`BoundFilesystemContext`, `FilesystemBindingResolver`, and runtime-binding
lifecycle work. Shared types must contain no `node:*`, `Buffer`, Fastify,
Agent, Workspace, or provider implementation imports.

The interface is transport-neutral:

```text
v1: in-process EnvironmentService adapter
later: remote EnvironmentService client/server adapter
```

A local method call and a future remote call must preserve the same operation,
error, cancellation, capability, and lifecycle semantics. This plan does not
standardize a wire protocol prematurely.

### `@hachej/boring-sandbox`

`boring-sandbox` owns lower-level environment backend/provider contracts:

- process/container/provider provisioning;
- isolation and runtime image identity;
- canonical filesystem persistence;
- command execution against that filesystem;
- mounts/bindings, health, invalidation, and cleanup;
- provider capabilities and production qualification.

It must become independent of Agent/Workspace types. The current
`WorkspaceSandboxPairV1` is retained migration input, not the final service
boundary. The target backend returns an Agent/Workspace-neutral environment
handle consumed by `boring-bash/server`.

## Canonical filesystem and no-copy rule

For an ordinary Workspace, the Environment service owns one authoritative
working filesystem. Agent tools, bash, file UI, CLI, search, and watch all use
the same operations/API and underlying data.

```text
Agent A ───────┐
Agent B ───────┤
Workspace UI ──┼→ EnvironmentOperations → one canonical filesystem
CLI ───────────┘
```

Forbidden for ordinary same-Workspace collaboration:

- a host file tree plus a Sandbox copy synchronized in the background;
- per-Agent copied working trees presented as the same Workspace;
- file tools reading one source while bash mutates another;
- model-visible tools bypassing the Environment operations/admission boundary.

Persistence may use a durable volume, remote worker volume, or provider-backed
storage. “Canonical” names authority, not physical location or process shape.

Separate readonly projections remain valid for contracted/cross-Workspace work,
but they are explicit distinct filesystems, not silent copies masquerading as
the caller's live Workspace.

## Governance and capabilities

Governance is evaluated before an Agent receives Environment access.

```text
authorized actor + Workspace + acting Agent + invocation
→ trusted governance plugins
→ EnvironmentAdmission
→ EnvironmentService.acquire()
→ attenuated EnvironmentLease/operations
→ AgentApplication.invoke()
```

A conceptual admission includes:

```ts
type EnvironmentAdmission = Readonly<{
  workspaceId: string
  actorId: string
  agentTypeId: string
  sessionId: string
  invocationId: string
  filesystemBindings: readonly FilesystemBinding[]
  allowedOperations: readonly EnvironmentOperation[]
  networkPolicy: NetworkPolicy
  runtimeIdentity: RuntimeIdentity
  expiresAt: string
}>
```

Environment admission contains durable/reusable environment policy only. Secrets
are never environment or lease state. Governance separately supplies a
single-invocation execution grant whose opaque references are bound to the exact
Workspace, actor, Agent, invocation, operation, and expiry; only the Environment
service resolves and injects them into that one process. A secret value cannot
enter filesystem state, a reused lease, process-global environment, or cache.

The Agent receives a lease/capability, not policy source, membership records, or
Sandbox administration credentials. It cannot choose another Workspace,
filesystem, capability subject, or secret reference. Additional environments
require a new governance decision and a separately bound capability.

The service enforces the effective grant on every operation. For `exec`, path
checks at the HTTP/tool layer are insufficient: the command process must receive
the same physical readonly/readwrite/absent filesystem view, environment-level
network policy, and one-invocation secret grant. Tool hiding is not an isolation
boundary. The provider matrix labels every binding/network requirement
`physical`, `advisory`, or `unsupported`; hosted admission requires physical
enforcement and fails with a stable unsupported-requirement error when no
eligible provider can supply it. Direct/advisory execution is trusted-local only.

For the in-process implementation, an unforgeable lease object is sufficient.
A future remote adapter must bind an expiring capability to Workspace, actor,
Agent, invocation, environment, operations, and policy digest. Token/wire format
is explicitly deferred until that adapter exists.

## Application fleet

The host and CLI supply equivalent semantic configuration through different
adapters:

```ts
type ApplicationAgentFleet = Readonly<{
  applicationDefaultAgentTypeId: string
  agents: readonly AgentApplicationDefinition[]
}>

type AgentApplicationDefinition = Readonly<{
  agentTypeId: string
  source: AuthoredAgentSourceV1
  pluginIds: readonly string[]
}>
```

Web host composition additionally supplies:

```ts
type SignupAgentDefaults = Readonly<Record<string, string>>
// exact normalized hostname -> fleet agentTypeId
```

CLI YAML may express the same fleet and a local Workspace default. The final YAML
syntax belongs to CLI, while the normalized fleet value belongs to Workspace.

Startup validation is complete before serving or creating runtimes:

- fleet is non-empty;
- agent IDs are unique and satisfy one canonical identifier grammar;
- application default exists in the fleet;
- authored `definitionId` exactly equals `agentTypeId`;
- trusted plugin references exist;
- signup hostnames are exact, unique, and map to fleet members;
- definitions/configuration are copied and frozen;
- validation creates no Workspace, AgentApp, environment, model client, or
  Sandbox backend.

There is no persistent fleet registry, mutation API, watcher, active pointer,
or controller. Fleet changes require deploy/restart.

## Workspace default-agent persistence

Every newly created Workspace persists a fleet member as
`defaultAgentTypeId`. For v1:

- signup initialization chooses the configured signup-domain default;
- ordinary web creation chooses the application default;
- CLI creation uses the application default unless a clearly named trusted
  registry-creation initializer selects another validated fleet member; the
  value persists once and cannot mutate an existing Workspace;
- invite acceptance never changes an existing Workspace default;
- login/domain navigation never changes an existing default;
- no public request body/query/header may provide an arbitrary agent ID;
- changing an existing default is deferred until a separately approved owner UX
  and authorization contract.

The hosted representation is a nullable `workspaces.default_agent_type_id`
column. Missing Workspace, existing legacy null, and initialized non-null are the
three states; there is no separate hosted agent-state row. New Workspace row,
owner membership, and Workspace-validated non-null default commit atomically.
Legacy null initializes by compare-and-set to the application default only. CLI
maps a missing key on an existing registry entry to legacy null and fails closed
on concurrent initialization. The non-null hosted writer lands dark until a
stored-default-aware serving and rollback cohort can honor the value or disable
Agent execution. A metadata-ignorant old cohort is only a pre-write schema
compatibility probe and cannot serve after authoritative non-null writes begin.

Because Better Auth user creation may commit before Workspace creation, web
signup durably reserves a bounded idempotent intent—bound to flow nonce, app, and
already-resolved host default—before the auth-user side effect, then atomically
binds it to the created user. Retry completes the same atomic
Workspace/member/default transaction; conflicting domain/default retry and every
crash boundary surface stable recovery, and ordinary login cannot start it. The
intent is consumed/retired after success; hostname never becomes Workspace
identity. A partially initialized or conflicting state fails stably. Once
persisted, absence or fleet mismatch never silently falls back.

If a persisted default is absent from the current fleet:

- Agent execution fails before Environment acquisition;
- history/list/state/attachments/delete remain available after ordinary
  ownership authorization;
- rollback must restore the previous fleet member or perform an explicitly
  approved migration; it may not reinterpret the Workspace.

## Merged `workspaceTypeId` correction

PR #844 added durable `workspaceTypeId`. The owner has now rejected Workspace
type as domain, membership, or agent-selection authority.

The first corrective slice is additive and non-destructive:

- retain migration 0023 as immutable history;
- audit non-default persisted rows before any pinning migration;
- pin new and compatible existing values to `default` only when that audit is
  clean;
- remove every behavioral use in routing, membership, Workspace selection,
  creation policy, Agent lookup, sessions, provisioning, and cache identity;
- audit published consumers and persisted non-default rows;
- if real non-default data exists, stop and require a separate owner-approved
  before/after mapping migration; never coerce silently;
- deprecate the field in active contracts;
- decide physical column/API removal only in a later reviewed migration after
  consumer/data proof.

`workspaceTypeId` may remain serialized temporarily for compatibility. It has no
product semantics.

## PR #845 correction

PR #845 must not merge its current typed-product graph. Its current green CI is
not semantic approval under Decision 28.

Salvage by recreation from current `main`:

- hostname normalization and exact-host duplicate/malformed rejection;
- bounded trusted-proxy behavior and host-spoof tests;
- explicit sibling-cookie parent validation;
- exact HTTPS trusted Origins, CSRF/redirect/logout proof;
- the real Better Auth + Chromium shared-cookie proof;
- stable configuration errors useful to the narrowed signup-domain map.

Reject:

- `CoreProductRequestScope`;
- domain → `workspaceTypeId`;
- `workspaceProducts` and product creation policy;
- Core↔Workspace type-policy coverage;
- type-filtered membership/list/select/create;
- typed-mode global 503 behavior;
- domain as ongoing request/runtime authority.

The PR is superseded/closed only after the replacement authority PR records the
salvage destinations. Do not force-rewrite its reviewed history.

## Sessions and multi-agent behavior

- New sessions persist the acting `agentTypeId`, initialized from the
  Workspace's persisted default for default ingress.
- Existing sessions resume through their stored fleet type when it still exists.
- Missing/malformed/removed type fails execution stably without hiding owned
  history.
- Legacy sessions without type use the already-persisted Workspace default.
- One actor-neutral AgentApp instance may serve multiple members only when actor,
  credentials, invocation grants, and session context are supplied per call and
  never captured in singleton state.
- Workspace owns session persistence, creation/routing, queueing, and
  cancellation; Agent receives a bounded session snapshot plus append/emit
  surface and owns only Agent-specific interpretation.
- Independent sessions may execute concurrently under existing queue and
  cancellation rules.
- The initial human surface exposes only the default Agent. Public selector,
  default changes, and direct arbitrary Agent invocation remain deferred.
- Workspace-local Agent-to-Agent collaboration uses an in-process semantic
  adapter initially. A future remote Agent adapter is an implementation of the
  same contract, not A2A loopback.

## Lifecycle and failures

### Fleet and Workspace

- startup fleet failure prevents the consumer from serving;
- unknown persisted default affects that Workspace's execution, not history or
  unrelated Workspaces;
- one AgentApp load failure is isolated, cleaned up, and retryable;
- AgentApp cache identity includes fleet/plugin generation; a generation change
  drains/disposes stale instances before new invocations;
- Workspace orchestration and AgentApp caches are consumer-local in v1;
- Core/web and CLI instantiate independently and do not share process globals.

### Environment service

- a service-derived backend/storage key may deduplicate expensive acquisition
  only when Workspace, canonical storage, provider/runtime, enforcement,
  network, and compiled-view facts match exactly; uncertainty isolates;
- every actor/Agent/session/invocation receives a distinct authority-bearing
  lease/view with exact operations, bindings, expiry, and cancellation; it is
  never reused across subjects;
- a narrower grant never reuses a broader mount namespace, operations wrapper,
  process environment, or secret grant;
- shared backends are reference-counted; one lease release/expiry cannot cancel
  another holder and disposal waits for the final bounded drain;
- active operations hold a lease; release is idempotent;
- failed acquire cleans up staged bindings/backend resources;
- provider failure never publishes a partially ready Environment lease;
- lease expiry rejects new operations stably, cancels in-flight operations with
  a bounded grace period, and leaves release idempotent;
- cancellation, timeout, and close are bounded even when a backend ignores its
  first cancellation signal;
- secret values never enter fleet config, Workspace metadata, sessions, logs,
  receipts, or general environment caches.

The environment key and digest are service implementation details, not public
caller-selected authority.

## Delivery sequence

The normative package contracts, exact slice acceptance, review budgets, and DAG
live in the #805 fleet plan. This product plan names the same executable slices;
it does not publish a second coarser graph.

- **F0a authority reset:** Decision/docs/historical banners and replacement Beads.
- **F0b grounded inventory:** refresh R0; enumerate every provider, file/bash/
  watch/search/provisioning/path/session/package consumer; finalize #844/#845
  dispositions. No implementation dispatch before F0b.
- **F1a operation contract:** complete logical no-raw-root Environment operations,
  bounds/errors/cancellation/local watch, canonical resolver port.
- **F1b admission/lifecycle:** backend key versus per-invocation view,
  governance/expiry/refcount, host composition, execution-grant and model-secret
  separation.
- **F2a neutral Sandbox backend:** provider facts, eligibility, source-of-truth,
  physical/advisory enforcement, old-export expansion bridge.
- **F2b-i local Environment service:** implement complete operations/admission/
  lifecycle in `boring-bash/server` while retaining old consumer paths.
- **F2b-ii consumer migration/conformance:** migrate all file/exec surfaces and
  prove per-provider same-view, operation, hostile-policy, and network negatives.
- **F3a Agent application/fleet:** dedicated Agent application entrypoint,
  frozen fleet and plugin roles, invocation-scoped model capability.
- **F4a hosted persistence correction:** nullable Workspace default column,
  atomic Workspace/member/default create, old-cohort tolerance, #844 audit/
  demotion and human-gated conditional remediation.
- **F4b CLI/session persistence:** host-neutral CLI registry locking/revision
  store plus acting-Agent metadata adapters for hosted/local durable sessions.
- **F3b-i Workspace single-Agent orchestrator:** authorized-context API, default
  resolution, sessions, governance, real Environment integration, safe
  Agent-independent file/status/history access.
- **F3b-ii application lifecycle:** generation-safe actor-neutral AgentApp
  registry, retry/drain/disposal, and an internal/conformance-only validated
  second-Agent path; no public non-default selector or UX.
- **F5a Core/web consumer:** ordinary membership plus idempotent signup
  initialization; separate packed fixture proving no CLI dependency.
- **F5b sibling auth/#845:** recreate shared-cookie/Origin/CSRF/logout/browser
  proof from current main and close/supersede #845 with a salvage ledger.
- **F6 CLI consumer:** independent fleet/Workspace YAML adapter, registry lock,
  regular `agent dev`, separate packed fixture proving no Core dependency.
- **F7 multi-Agent/governance conformance:** two Agents, canonical no-copy data,
  narrower views, shell enforcement, refcount, cross-actor secret/model/session
  negatives, restart/fleet-drift behavior.
- **H2c compatibility/deletion approval:** after green F7, the owner approves
  the exact obsolete-export/file list, compatibility cohort, and restoration.
- **F2c compatibility contraction:** remove only H2c-approved obsolete Agent-
  coupled Bash/Sandbox exports and prove final manifest/import boundaries.
- **F8a release-candidate proof:** contracted independent/combined packed cohort,
  full-app/Seneca signup defaults, production restart and rollback; no publish.
- **H8 publication approval:** owner approves one exact immutable cohort/target.
- **F8b publication proof:** exact registry publication, empty-cache install,
  post-release full-app/Seneca proof and provenance.

Every slice is one bounded PR unless the #805 plan explicitly defines migration
batches. Auth, migration, provider, governance, and release slices require their
named independent specialist review.

## Dependency graph (non-normative mirror)

The normative graph is in the #805 fleet plan.

```text
closed R0 + closed R4
          │
          ▼
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

F3a may develop against F1 fakes while F2 proceeds. The real Workspace
orchestrator does not dispatch until both the local Environment service and
persistence/session foundation exist. F5 and F6 are independent consumer slices.

## Acceptance

This plan is complete when:

1. Core/web and CLI independently consume Workspace and neither routes through
   the other.
2. One static application fleet validates before serving; no mutable fleet
   registry/controller exists.
3. Every initialized Workspace durably stores a default fleet Agent type.
4. Signup domain initializes only a newly created default Workspace and has no
   later authorization/routing effect.
5. Ordinary membership remains the only live Workspace access authority.
6. Workspace bundles/orchestrates service-shaped in-process AgentApps.
7. Agent receives governed Environment operations, not policy sources or
   Sandbox administration.
8. `boring-bash` owns one transport-neutral Environment service contract.
9. `boring-sandbox` implements Agent/Workspace-neutral backends.
10. Files, bash, UI, CLI, and all first-party Agents use one canonical Workspace
    filesystem through Workspace-owned admissions to the same environment
    operations; UI/CLI do not hold raw backend administration and no
    synchronization copy exists.
11. Governance restrictions are enforced in both file operations and command
    execution.
12. Existing sessions/history remain manageable when an Agent is unavailable;
    execution never silently falls back.
13. `workspaceTypeId` has no routing, membership, Agent, session, provisioning,
    or cache semantics.
14. PR #845's security work is selectively recreated without its typed-product
    architecture.
15. Full-app and Seneca prove the exact packaged cohort, restart, and rollback.

## Proof gates

Applicable slices run focused tests plus:

```bash
pnpm lint
pnpm lint:invariants
pnpm typecheck
pnpm test
pnpm e2e
pnpm check:golden-path
git diff --check
```

Planning/graph proof:

```bash
br lint <all active replacement Beads>
br dep cycles
bv --robot-insights | jq '{cycles:.Cycles,status:.status}'
br ready --json
```

Package proof uses clean external consumers and packed/registry artifacts. UI,
auth, governance, and deployment claims require browser or executed evidence.

## Rollout and rollback

1. Merge F0 authority before changing code or closing PR #845.
2. Land service contracts behind existing local adapters without changing user
   behavior.
3. Bridge current providers and prove canonical file/bash parity.
4. Add Workspace fleet/default persistence and migrate legacy Workspaces
   explicitly.
5. Move Core/web and CLI independently onto Workspace contracts.
6. Recreate narrowed signup-domain/shared-auth behavior from current main.
7. Qualify sessions, governance, and two-Agent behavior.
8. Pack and test one exact cohort.
9. Deploy Seneca dark, prove two signup defaults, then enable.
10. Roll back only to a cohort that understands persisted Workspace defaults;
    never hide/reinterpret them.

The already-landed `workspaceTypeId` column is not dropped in this delivery.
Rollback keeps it pinned to compatibility `default` while restoring the prior
fleet/default-aware cohort.

## Out of scope

- remote Agent deployment and Agent-service discovery;
- remote Environment wire protocol/capability token format;
- public Agent selector or Workspace-default editing;
- per-Workspace Agent allowlists;
- dynamic fleet mutation, registry, marketplace, or controller;
- product memberships or type-filtered Workspace portfolios;
- Agent-specific canonical filesystem copies;
- contracted-agent live cross-Workspace access;
- durable external task/A2A state machine;
- custom tenant executable tools;
- billing, channels, mounts outside named Environment bindings;
- physical removal of `workspaceTypeId` before consumer/data audit.

## Stop conditions

Stop and amend this plan if:

- Core or CLI becomes the Agent behavior composer;
- one consumer must start or call the other to use Workspace;
- domain, Agent ID, or Environment capability grants Workspace membership;
- Agent code evaluates its own governance policy or mints Sandbox access;
- file tools and bash operate on different authoritative data;
- a copied/synchronized same-Workspace file tree is introduced;
- `boring-sandbox` retains Agent/Workspace-owned contracts as the final boundary;
- Workspace implements provider-specific Sandbox logic;
- a remote protocol is frozen without a real remote consumer;
- an unavailable persisted default silently falls back;
- a public Agent selector/default mutation is smuggled into the first delivery;
- AgentHost, controller/reconciler, deployment-publication CAS, mutable registry,
  or a second runtime composer reappears.
