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
→ invoke AgentApp with governance-approved named Environments
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

All first-party fleet agents use the same native Environment API. Governance
chooses which named Environments each invocation receives. The ordinary
`workspace` Environment is the canonical Workspace filesystem. A delegated
Agent can instead receive a separately named, physically enforced Environment
view exposing only an approved subset of that same authoritative data—never a
copy or ambient access to the source. One `exec` runs in exactly one Environment.

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
- invocation/session authority and acting-Agent attribution, while Pi retains
  transcript/replay/follow-up-queue mechanics behind an injected runtime;
- deterministic governance-plugin composition into named Environment access;
- retaining Environments for the streaming/control invocation lifetime and
  closing them exactly once at the terminal result/stop/cancel/shutdown fence;
- orchestration between fleet agents;
- Agent-independent web/CLI file operations through the `member-operation`
  authorization variant, with disconnect/unsubscribe/cancel/shutdown cleanup;
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
  start(input: AgentInvocationInput, context: AgentExecutionContext): Promise<AgentInvocation>
  dispose?(): Promise<void>
}

interface AgentInvocation {
  readonly events: AsyncIterable<AgentInvocationEvent>
  readonly result: Promise<AgentInvocationResult>
  send(input: AgentFollowUpInput): Promise<void>
  interrupt(): Promise<void>
  stop(): Promise<void>
}
```

An AgentApp owns:

- declarative identity/instructions plus trusted behavior plugins;
- model loop and Agent-specific tool/prompt/skill/Pi composition;
- Agent-specific session behavior and result mapping.

It receives a map of named, already-authorized Environments, an opaque
invocation-scoped model client, and a Workspace-authorized Pi session runtime.
Core/web supplies the encrypted-BYOK issuer after membership; CLI supplies an
independent trusted-local issuer; Workspace requests one per authorized
invocation. A cached AgentApp never captures actor state, raw/reusable model
credentials, an Environment, or a Pi session. Hosted resolution proves readable
BYOK, explicit instance-key fallback only when BYOK is absent, stable failure
when both are absent or BYOK is unreadable, and no ambient Pi/OAuth fallback.
Agent does not create Workspaces or Environments, verify membership, evaluate
policy, provision arbitrary sandboxes, close provider resources, or own HTTP/
server deployment. The initial call is in process. A future remote adapter
preserves streaming/control semantics; it does not serialize these local
JavaScript objects or define the wire protocol now.

### `@hachej/boring-bash`

`boring-bash` owns the execution-environment service interface because it owns
the consumer-visible coherence contract for files and shell execution:

```ts
interface EnvironmentService {
  open(request: {
    invocation: AuthorizedInvocation
    access: EnvironmentAccess
    cancellation: AbortSignal
  }): Promise<{
    environment: Environment
    close(): Promise<void>
  }>
}

interface EnvironmentOperationControl {
  readonly cancellation: AbortSignal
}

interface Environment {
  readonly name: string
  read(input: FileRead, control: EnvironmentOperationControl): Promise<FileReadResult>
  write(input: FileWrite, control: EnvironmentOperationControl): Promise<FileWriteResult>
  edit(input: FileEdit, control: EnvironmentOperationControl): Promise<FileEditResult>
  list(input: FileList, control: EnvironmentOperationControl): Promise<FileListResult>
  stat(input: FileStat, control: EnvironmentOperationControl): Promise<FileStatResult>
  mkdir(input: FileMkdir, control: EnvironmentOperationControl): Promise<FileMkdirResult>
  delete(input: FileDelete, control: EnvironmentOperationControl): Promise<FileDeleteResult>
  move(input: FileMove, control: EnvironmentOperationControl): Promise<FileMoveResult>
  find(input: FileFind, control: EnvironmentOperationControl): Promise<FileFindResult>
  grep(input: FileGrep, control: EnvironmentOperationControl): Promise<FileGrepResult>
  watch(input: FileWatch, control: EnvironmentOperationControl): AsyncIterable<FilesystemInvalidation>
  exec(input: ExecRequest, control: EnvironmentOperationControl): Promise<ExecResult>
}
```

The final contract replaces rather than wraps the current Agent-coupled
`RuntimeBundle` and named-filesystem adapter graph. The native Environment-
backed file/shell base set stays `read`/`write`/`edit`/`find`/`grep`/`ls`/`bash`;
this is not the complete Agent tool catalog. F0b inventories every upload/UI/
automation/plugin/diagnostics/isolated-code tool and assigns retain/migrate/
disable disposition. Every Environment-backed tool input requires an
`environment` name. The shared
boring-bash tool factory exact-map-selects that opened Environment, rejects
unknown/absent names, and calls its method natively (`ls` maps to `list`). The
conditional `execute_isolated_code` path must be disabled or redefined over one
selected Environment with no caller-selected Sandbox/image/package/provider
administration. Any retained non-base tool that touches files or exec must select
one opened Environment and cannot preserve a raw Workspace/Sandbox bypass. There
is no ambient default, duplicate file API, Agent-specific
filesystem adapter, or local/remote branch after contraction. Any temporary
omission→`workspace` replay shim is deleted at F2c. Shared types contain no `node:*`,
`Buffer`, Fastify, Agent, Workspace, or provider implementation imports.

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

For an ordinary Workspace, the named `workspace` Environment exposes one
authoritative working filesystem. Agent tools, bash, file UI, CLI, search, and
watch all use its native operations and underlying data. Additional named
Environments are separately governed roots or subset views; they do not become
hidden mounts inside another Environment.

```text
Agent invocation.environments
├── workspace        → canonical Workspace filesystem, read/write/exec
├── company-context  → approved source/subset, usually readonly
└── delegated-input  → task-specific subset view
```

Forbidden for ordinary same-Workspace collaboration:

- a host file tree plus a Sandbox copy synchronized in the background;
- per-Agent copied working trees presented as the same Workspace;
- file tools reading one source while bash mutates another;
- model-visible tools bypassing a named Environment's native operations and
  compiled access boundary.

Persistence may use a durable volume, remote worker volume, or provider-backed
storage. “Canonical” names authority, not physical location or process shape.

A delegated/contracted subset remains a separately named Environment whose
logical source and path policy are compiled by trusted governance. It may be a
provider-enforced view over canonical source data, but it is never a synchronized
copy masquerading as live Workspace state. The Agent cannot request an absent
environment name or widen the paths/operations of one it received.

## Governance and capabilities

Governance is evaluated before an Agent receives any named Environment.

```text
consumer-authorized Workspace invocation
→ trusted governance plugins compile EnvironmentAccess[]
→ Workspace calls EnvironmentService.open() for each approved name
→ AgentApplication receives only the resulting Environment map
→ Environments remain open through streaming/follow-up control
→ Workspace closes exactly once on start failure or terminal result/stop/cancel/shutdown
→ outward result settles only after cleanup
```

The minimal trusted records are:

```ts
type AuthorizedInvocation = Readonly<{
  workspaceId: string
  actorId: string
  invocationId: string
  purpose: InvocationPurpose
} & (
  | {
      kind: 'agent-invocation'
      agentTypeId: string
      sessionId: string
      taskId: string
      delegatedByAgentTypeId?: string
    }
  | {
      kind: 'member-operation'
      consumer: 'web' | 'cli'
      operation: MemberEnvironmentOperation
    }
)>

type EnvironmentPathRule = Readonly<{
  sourcePath: string
  environmentPath: string
  access: 'readonly' | 'readwrite' | 'absent'
}>

type EnvironmentAccess = Readonly<{
  name: string
  source: LogicalEnvironmentId
  paths: readonly EnvironmentPathRule[]
  operations: readonly EnvironmentOperation[]
  network: NetworkAccess
  expiresAt: string
}>
```

`AuthorizedInvocation` is pure identity/audit data. Its discriminant represents
an Agent invocation or an Agent-independent member file operation; the latter
never fabricates Agent/session/task identity. `EnvironmentAccess` is a policy
result, not a bearer token. Only trusted Workspace composition can reach
`EnvironmentService`; fleet code cannot submit or widen access records.
Governance plugins receive the authorized actor/Workspace/purpose plus Agent/
session/task fields only for the Agent variant; Agent code cannot self-assert
these fields. They may attenuate the canonical
`workspace` Environment or authorize another logical
source under a distinct name. Composition is deterministic and fail-closed:
conflicting rules narrow access, and adding a new source requires the plugin that
owns authority for that source. Raw roots and provider handles never enter the
policy result.

Names must be unique within an invocation. Each opened Environment has one
rooted filesystem. `EnvironmentPathRule` maps an approved source path to a path
inside that root; omission is absence and explicit `absent` overrides access.
A path operation is permitted only when its verb is in `operations` **and** the
matching path rule permits the requested effect; neither dimension can broaden
the other. Paths mean exactly the same thing to native Pi file tools and `exec`. For a
delegated subset, the provider must physically materialize only approved paths
and readonly/readwrite state; API-only path checks are insufficient. A command
cannot access another named Environment. Providers label every required file and
network guarantee `physical`, `advisory`, or `unsupported`; hosted open fails
stably unless the exact access can be enforced. Direct/advisory mode is trusted-
local only.

The current command-credential mechanism remains unchanged in this delivery and
is not generalized into a broker/token system. LLM credentials remain an opaque
model client, and Sandbox-provider credentials remain host/provider-only. Secret
redesign is deferred until a named remote, untrusted, or scoped-credential need.

Watch retains the current invalidation/`resync-required` contract; it is not a
durable event journal. Concurrent writes retain ordinary filesystem/process
semantics with no global lock, transaction, merge layer, or per-Agent copy.

Transport neutrality means stable behavior, not serializing local objects.
Remote authentication, cancellation transport, token format, wire protocol,
replay, and distributed retries remain deferred until a named remote consumer.

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
  model client, named Environments, and session runtime are supplied per call and
  never captured in singleton state.
- Workspace owns session authorization, stable identity, acting-Agent
  attribution, history/delete visibility, invocation routing, and cancellation
  authority. The existing Pi harness remains the transcript persistence, replay,
  follow-up queue, and model-loop session runtime behind an injected adapter;
  Workspace does not recreate those mechanics.
- Independent sessions may execute concurrently under existing queue and
  cancellation rules.
- The initial human surface exposes only the default Agent. Public selector,
  default changes, and direct arbitrary Agent invocation remain deferred.
- The F3b-ii package-internal delegation operation verifies an active
  same-Workspace origin, validates the fleet target, allocates task/invocation
  identity, and accepts only a bounded host-approved purpose, invocation input,
  and non-authoritative requested Environment names. It accepts no source/path/
  operations/network/expiry/access record or opened Environment; governance
  derives those through the same model/session/open/terminal-cleanup pipeline.
  Workspace derives immutable lineage and freshly authorizes every edge. F0b
  identifies the actual installed delegation executor/guards; verified Pi guards
  stay authoritative, while F3b-ii supplies missing depth/cycle/fan-out/execution-
  timeout/cascade once in Workspace without a second dispatcher. Child cleanup
  completes before parent result.
- Workspace-local Agent-to-Agent collaboration starts another service-shaped
  AgentApplication with a new governance result. Delegation supplies only the
  named Environments approved for the target Agent and task; it does not imply
  membership, ambient source access, or A2A loopback.

## Lifecycle and failures

### Fleet and Workspace

- startup fleet failure prevents the consumer from serving;
- unknown persisted default affects that Workspace's execution, not history or
  unrelated Workspaces;
- one AgentApp load failure is isolated, cleaned up, and retryable;
- AgentApp cache identity includes fleet/plugin generation; a generation change
  drains/disposes stale instances before new invocations;
- Workspace tracks active invocation runners; orchestrator close stops and
  bounded-drains them, closes Environments, then disposes AgentApplications;
- Workspace orchestration and AgentApp caches are consumer-local in v1;
- Core/web and CLI instantiate independently and do not share process globals.

### Environment service

- `EnvironmentService.open()` receives one pure discriminated Agent/member
  authorization record, one immutable access record, and an Environment-lifetime
  cancellation channel; every operation receives a separate operation signal;
- a partially opened or policy-ineligible Environment is never exposed;
- the Workspace runner, not Agent code, owns `close()`; partial open or Agent
  start failure closes immediately; after start, `result` is the terminal fence,
  events end by settlement, and stop/cancel/expiry/shutdown drives bounded drain;
  close runs exactly once before the outward result settles;
- `interrupt` cancels current-turn operations without closing Environments for
  follow-up; stop/lifetime cancel/expiry/shutdown ends the Environment lifetime;
- expiry rejects new operations, bounded-cancels in-flight work, terminates watch
  with a stable error, and leaves close safe;
- one Environment exposes one root and one physical exec view; exact paths,
  mutation modes, operations, and network policy are enforced on every call;
- a delegated subset view references canonical source data through provider
  enforcement, not copy/synchronization;
- backend acquisition is per-open by default. Backend reuse is optional, hidden,
  and permitted only when fresh versus reused is unobservable—no leftover
  process, `/tmp`, environment, daemon, broader mount, or cross-invocation state;
- failed open cleans staged/provider resources, and cancellation/timeout/close
  remain bounded even if a backend ignores its first signal;
- close rejection/timeout turns success into stable `ENV_CLEANUP_FAILED`; an
  existing primary error stays primary with cleanup detail. Survivor-capable
  acquisition requires a durable pre-allocation intent and provider create that
  is idempotent/discoverable by that private ID; otherwise hosted use is unsupported.
  The returned cleanup reference binds before exposure; crash-window/restart and
  quarantine reconciliation are proven. Agent/Workspace never sees this state;
- current command-credential behavior is preserved; model and provider
  credentials never enter the Environment.

Backend identities, reuse keys, digests, handles, and refcounts are private
`boring-bash/server`/`boring-sandbox` implementation details, not Workspace or
Agent contracts.

## Delivery sequence

The normative package contracts, exact slice acceptance, review budgets, and DAG
live in the #805 fleet plan. This product plan names the same executable slices;
it does not publish a second coarser graph.

- **F0a authority reset:** Decision/docs/historical banners and replacement Beads.
- **F0b grounded inventory:** refresh R0; enumerate every provider and base/upload/
  UI/automation/plugin/diagnostics/isolated-code tool schema/composition/file-exec
  dependency, including `execute_isolated_code`; enumerate file/bash/watch/search/
  provisioning/path/session/package consumers, the actual delegation executor/
  guard matrix, and trusted-local model source/precedence/model selection; finalize #844/#845
  dispositions. No implementation dispatch before F0b.
- **F1a native Environment contract:** one named rooted Environment with complete
  operations, bounds/errors, invalidation watch, separate operation cancellation,
  and required Environment name on base read/write/edit/find/grep/ls/bash;
  full tool ledger/dispositions, no new destructive base tools or ambient roots.
- **F1b access/lifecycle contract:** pure `AuthorizedInvocation`, governance-
  compiled `EnvironmentAccess`, trusted-only `open`, Agent/member authorization,
  operation-vs-lifetime cancellation, terminal cleanup/quarantine, and credential separation—without generic
  lease, token, refcount, or secret-broker machinery.
- **F2a neutral Sandbox backend:** provider facts, eligibility, source-of-truth,
  physical/advisory enforcement, old-export expansion bridge.
- **F2b-i local Environment service:** implement named Environment open/close,
  logical-source/subset resolution, physical exec equivalence, and provider
  lifecycle in `boring-bash/server` while retaining old consumer paths.
- **F2b-ii native consumer migration/conformance:** base Pi tools exact-map-
  select one required Environment; every other tool gets a reviewed disposition
  and file/exec binding, including `execute_isolated_code`; migrate consumers, remove
  active old-path use while retaining deletion candidates until F2c, and prove
  per-provider policy/coherence/cleanup negatives.
- **F3a Agent application/fleet:** dedicated Agent application entrypoint,
  frozen fleet and plugin roles, invocation-scoped opaque model client.
- **F4a hosted persistence correction:** nullable Workspace default column,
  atomic Workspace/member/default create, old-cohort tolerance, #844 audit/
  demotion and human-gated conditional remediation.
- **F4b CLI/session persistence:** host-neutral CLI registry locking/revision
  store plus acting-Agent metadata adapters for hosted/local durable sessions.
- **F3b-i Workspace single-Agent orchestrator:** authorized-context API, default
  resolution, sessions, governance, real Environment integration, streaming
  terminal cleanup and member handles whose owner-finally matrix covers one-shot
  success/error/cancel/disconnect, watch completion/error/unsubscribe, Agent start/
  result/lifetime, Pi-SSE-unsubscribe-only, and CLI success/error/shutdown.
- **F3b-ii application lifecycle:** generation-safe actor-neutral AgentApp
  registry, retry/drain/disposal, and an internal/conformance-only validated
  same-Workspace origin→target/task path that accepts no access policy; no public
  non-default selector or UX.
- **F5a Core/web consumer:** ordinary membership plus idempotent signup
  initialization; separate packed fixture proving no CLI dependency.
- **F5b sibling auth/#845:** recreate shared-cookie/Origin/CSRF/logout/browser
  proof from current main and close/supersede #845 with a salvage ledger.
- **F6 CLI consumer:** independent fleet/Workspace YAML adapter, registry lock,
  sole trusted-local per-invocation model-client issuer preserving current env-
  key/Pi-auth-settings/OAuth-subscription/model-selection precedence, regular
  `agent dev`, and packed proof of no Core dependency/bypass/credential leakage.
- **F7 multi-Agent/governance conformance:** two Agents plus delegated-task
  Environment policy, canonical no-copy source data, physical subset/shell
  enforcement, cross-actor environment/model/session negatives, ordinary write
  semantics, restart, and fleet-drift behavior.
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
6. Workspace bundles/orchestrates streaming/control in-process AgentApps and
   closes their Environments exactly once at the terminal fence.
7. Agent receives only a map of governance-approved named Environments, an
   opaque model client, and a Pi-backed session runtime—not policy, membership,
   raw roots, provider handles, or lifecycle administration.
8. `boring-bash` owns one native Environment contract/service; base
   read/write/edit/find/grep/ls/bash select one Environment, every other tool has
   reviewed disposition/no raw file-exec bypass, and member operations use
   their own authorization variant without ambient default/duplicate API/mode.
9. `boring-sandbox` implements hidden Agent/Workspace-neutral backends.
10. The `workspace` Environment gives files, bash, UI, CLI, and first-party
    Agents one canonical Workspace filesystem with no synchronization copy.
11. Governance can give a delegated Agent a separately named Environment over
    an exact approved subset; file operations and `exec` are physically confined
    to that one Environment and command access never spans Environment names.
12. Delegation uses Workspace-derived lineage/fresh edge authorization, F0b-
    verified Pi guards, and one Workspace completion of missing depth/cycle/fan-
    out/execution-timeout/cascade behavior without a second dispatcher.
13. Operation interrupt differs from Environment lifetime cancellation; cleanup
    failure cannot report success or release an unquarantined resource.
14. Existing sessions/history remain manageable when an Agent is unavailable;
    execution never silently falls back.
15. `workspaceTypeId` has no routing, membership, Agent, session, provisioning,
    or cache semantics.
16. PR #845's security work is selectively recreated without its typed-product
    architecture.
17. Full-app and Seneca prove the exact packaged cohort, restart, and rollback.

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
- ambient cross-Workspace membership/ACL grants; task-bound, governance-compiled
  named Environment views are in scope;
- durable external task/A2A state machine;
- custom tenant executable tools;
- billing and channels beyond the named-Environment policy needed for F7;
- physical removal of `workspaceTypeId` before consumer/data audit.

## Stop conditions

Stop and amend this plan if:

- Core or CLI becomes the Agent behavior composer;
- one consumer must start or call the other to use Workspace;
- domain, Agent ID, or named Environment access grants Workspace membership;
- Agent code evaluates policy, calls `EnvironmentService.open()`, requests an
  absent Environment name, or widens paths/operations/network access;
- file tools and bash within one named Environment operate on different roots,
  or one command can ambiently read another Environment;
- a copied/synchronized same-Workspace file tree is introduced;
- `boring-sandbox` retains Agent/Workspace-owned contracts as the final boundary;
- Workspace implements provider-specific Sandbox logic;
- a remote protocol is frozen without a real remote consumer;
- an unavailable persisted default silently falls back;
- a public Agent selector/default mutation is smuggled into the first delivery;
- AgentHost, controller/reconciler, deployment-publication CAS, mutable registry,
  or a second runtime composer reappears.
