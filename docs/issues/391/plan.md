---
github: https://github.com/hachej/boring-ui/issues/391
issue: 391
state: ready-for-agent
updated: 2026-07-20
flag: not-needed
track: owner
---

# gh-391 — domain-routed agent workspaces, then agent collaboration and external expansion

## Authority

This is the product roadmap and dispatch authority for #391.

- Durable decision: [`../../DECISIONS.md`](../../DECISIONS.md), Decision 26.
- Workspace ↔ Agent/A1 implementation: [`../805/runtime-refactor/work/A1-agent-authoring/PLAN.md`](../805/runtime-refactor/work/A1-agent-authoring/PLAN.md).
- Consumption modes: [`AGENT-CONSUMPTION-MODES.md`](AGENT-CONSUMPTION-MODES.md).
- Work-package alignment: [`ROADMAP-ALIGNMENT.md`](ROADMAP-ALIGNMENT.md).
- Ownership map: [`OWNERSHIP.md`](OWNERSHIP.md).

The AgentHost/controller/revision/deployment-publication content-addressed-
store plan and the old same-workspace-first Bead
graph are retired. The authored-catalog/Core-composer plan is also superseded.
Only work named by the current slices below is dispatchable.

## Goal

Seneca should host focused agent products through one ordinary application
deployment:

```text
exact product domain
→ persisted workspaceTypeId
→ authenticated principal + verified membership
→ authorized Workspace
→ Workspace-owned agent policy
→ default agent for human ingress
```

The backend is multi-agent-ready immediately:

```text
workspace type
→ defaultAgentTypeId
→ allowedAgentTypeIds[]
→ one shared WorkspaceRuntime
→ lazy AgentBinding singleton per allowed type
```

The first human product uses only the default. Backend readiness now avoids
rebuilding the Workspace/runtime boundary later; it does not prematurely ship a
selector or agent-to-agent product.

## Product sequence

### Step 1A — domain-routed web product

Deliver:

1. exact trusted domain → workspace type;
2. durable immutable `workspaceTypeId` on every Workspace;
3. authentication and membership before any Workspace/agent effect;
4. explicit typed-workspace creation and provisioning;
5. one Workspace-owned shared runtime with static default/allowed agent policy;
6. default-only human chat and compatible sessions;
7. full-app compatibility and Seneca two-product proof.

The host may define several allowed agents per workspace type, and conformance
must prove that two types share one Workspace + Sandbox. Public routes do not
accept arbitrary `agentTypeId`; collaboration remains inactive.

### Step 1B — authenticated external MCP

External MCP reaches the same authorized Workspace and server-selected default
agent. MCP is an ingress door, not an agent distribution mechanism. #806 is
recut only after Step 1A proof.

### Step 2 — activate several agents in one Workspace

Productize same-workspace collaboration on the Step 1A backend:

- Workspace resolves requested allowed types through a trusted internal seam;
- native subagents can target another allowed type while retaining the same
  WorkspaceRuntime/Sandbox;
- acting-agent and session attribution remain explicit;
- optional human selector/switch/fork UX requires a separate product decision.

The existing `pi-subagents` executor launches child processes and does not share
Boring's WorkspaceRuntime. Step 2 therefore needs a compatible executor/backend;
this is not falsely claimed by Step 1A.

### Step 3 — durable and external expansion

Add only with named consumers:

- durable task/event admission, receipts, replay, approvals, `input-required`,
  cancellation, and restart recovery;
- external/cross-deployment A2A;
- hardened public MCP/A2A identity and transport;
- runtime extraction and bounded custom sandbox tools;
- channels and transport adapters.

### Later — contracted agents

A contracted/service agent owns a separate Workspace + Sandbox. The caller
supplies a governed readonly projection and receives artifacts. No live
cross-workspace ACL or mount is introduced. Billing, budgets, identity,
customer-data hygiene, and marketplace UX are separately gated.

## Locked ownership

### Core

Core owns:

- authentication and current-app membership;
- Workspace persistence and `workspaceTypeId`;
- executing trusted hostname normalization/domain → expected-type resolution
  from host declarations, then typed list/select/create policy;
- stable authorization errors and safe browser projection.

Core may hand Workspace an authorized context containing workspace ID, persisted
workspace type, and actor snapshot. It does not load authored definitions,
resolve default/allowed agents, inspect plugins/prompts/tools/skills/Pi
resources, create harnesses, or own agent sessions.

### Workspace

Workspace owns:

- deployment-static workspace-type → default/allowed-agent policy;
- global agent-definition references and plugin views supplied by the host;
- one shared WorkspaceRuntime/Workspace/Sandbox lifecycle;
- the effective workspace provisioning-plugin union;
- lazy typed AgentBinding singleton maps;
- default and persisted-session agent resolution;
- multi-agent orchestration.

### Agent

Agent owns:

- loading and executing one requested `agentTypeId`;
- composing one authored source with its trusted plugin subset;
- harness/tools/readiness/session integration against a supplied
  WorkspaceRuntime;
- no workspace policy or second Workspace/Sandbox lifecycle.

### Host applications

Full-app and Seneca own:

- exact domain declarations supplied to Core;
- Workspace product/agent policy supplied to Workspace;
- startup cross-validation that every Core product type has a Workspace policy;
- global agent definitions;
- installed trusted plugins;
- deployment secrets, package pins, and rollback.

Plugins implement executable behavior. They do not decide which workspace types
or agents enable them.

## Static host model

The host supplies two explicit graphs plus a cross-validator; Core never sees
agent behavior:

```ts
type CoreProductRoutingConfig = {
  domains: readonly {
    hostname: string
    workspaceTypeId: string
  }[]
  workspaceProducts: readonly {
    workspaceTypeId: string
    label: string
    allowWorkspaceCreation: boolean
  }[]
}

type WorkspaceAgentHostPolicy = {
  workspaceTypes: readonly {
    workspaceTypeId: string
    defaultAgentTypeId: string
    allowedAgentTypeIds: readonly string[]
    workspacePluginIds?: readonly string[]
  }[]
  agentTypes: readonly {
    agentTypeId: string
    source?: AuthoredAgentSourceV1
    pluginIds: readonly string[]
  }[]
}
```

Semantics:

- authentication sessions are intentionally shared across trusted product
  subdomains using Better Auth `advanced.crossSubDomainCookies` and one explicit
  narrow DNS parent-domain cookie scope supplied by the host;
- the host supplies the narrowest registrable common parent for all product
  hostnames, the auth URL uses one declared product hostname, and the trusted
  auth/CORS origins exactly equal the declared HTTPS product origins;
- shared cookies require HTTPS/Secure, and neither cookie scope nor trusted
  origins may be inferred from request headers or configured with a wildcard;
- copied/frozen and fully validated before serving;
- one global definition per agent type;
- one unique non-empty allowed set per workspace type;
- default belongs to allowed;
- authored `definitionId` equals host `agentTypeId`;
- only trusted host config references plugin IDs;
- no mutation endpoint, registry, active pointer, or controller;
- model/provider policy remains in existing host/session configuration.

A host omitting explicit policy is normalized internally to:

```text
workspace type default
→ default primary
→ allowed [primary]
```

That compatibility input uses the same Workspace orchestrator, not a second
runtime path or adapter class.

## Authorization order

```text
normalize/resolve domain without workspace disclosure
→ authenticate principal
→ list/load current-app memberships
→ verify persisted workspaceTypeId
→ pass authorized context to Workspace
→ Workspace resolves default or trusted stored session type
→ verify type is allowed
→ lazily create/lease runtime and AgentBinding
→ execute
```

Domain, workspace type, agent type, plugin ID, session metadata, authored data,
model output, and tool calls never grant membership.

Unknown domains fail closed only for hosts that enable typed-domain routing.
Full-app's ordinary localhost/preview/deployment hosts retain compatibility
behavior.

### Retire the old deployment request scope

Current `CoreRequestScope` still carries retired AgentHost fields such as
`defaultDeploymentId`, `activeRevision`, and `resolvedDigest`, and can preselect
a Workspace. Typed products replace that with a host-derived expected-type scope:

```ts
type CoreProductRequestScope = Readonly<{
  workspaceTypeId: string
  allowWorkspaceCreation: boolean
  normalizedHostname: string
}>
```

Typed and legacy deployment request scopes are startup-mutually-exclusive. The
new scope never contains agent/deployment identity and never authorizes a
Workspace ID. After authentication, Core loads under the current app, checks
membership, reads the Workspace row, and verifies persisted type equality before
issuing the opaque Workspace invocation. The old deployment fields/resolver are
removed or isolated to compatibility hosts; they cannot enter the typed path.

## Workspace selection and creation

### Existing Workspace

- one matching membership opens automatically;
- several matching memberships show a Workspace chooser;
- chooser selects a Workspace, not an agent;
- every selection revalidates app, membership, and persisted type.

### No eligible Workspace

- show an explicit empty state;
- when creation is disabled, explain that product access must be granted;
- when enabled, the authenticated user invokes explicit Create;
- the server stamps type from the trusted domain declaration;
- current Core create authorization remains authoritative;
- provisioning failure is visible and retryable.

Typed create requires a client-generated opaque `Idempotency-Key`, but never a
client type. Core persists a unique operation under `(appId, actorId,
workspaceTypeId, key)` with a fingerprint of the normalized create payload. In
one transaction, the first admission creates the Workspace stamped with the
expected type, owner membership, and operation result; replay of the same
fingerprint returns the same Workspace, while key reuse with a different
fingerprint fails stably. Provisioning receives the durable operation ID as its
provider idempotency key and records pending/ready/error. If a provider cannot
deduplicate across crash windows, the product must narrow its guarantee rather
than claim exactly-once external resources.

Login, signup, list refresh, invite acceptance, MCP, and agent resolution never
implicitly create a typed Workspace. Full-app may retain its current implicit
`default` compatibility flow.

## Shared runtime and agent policy

For one authorized Workspace:

```text
WorkspaceAgentScope
├─ Promise<WorkspaceRuntime>
└─ Map<agentTypeId, Promise<AgentBinding>>
```

Rules:

- all resources load lazily;
- concurrent creation deduplicates;
- all agent types receive exact same Workspace/Sandbox object identity;
- all receive standard Boring Workspace tools;
- per-agent plugins filter prompt/tools/skills/Pi resources only;
- effective workspace plugin union is explicit workspace plugins plus every
  allowed agent's plugin set;
- provision that union once before agents depend on it;
- loaded agents live until WorkspaceRuntime retirement;
- Workspace/Sandbox creation failure affects the Workspace; background
  provisioning failure produces one shared degraded readiness state while
  preserving current non-runtime chat behavior;
- agent-specific load failure is isolated, cleaned up, and retryable;
- authorized reload reprovisions shared readiness, refreshes loaded binding
  resources, and reloads only the requesting actor's selected live session;
- static policy/plugin changes require restart.

Agents sharing a Workspace share filesystem/process/runtime authority. Different
tools or prompts are behavior, not isolation. A dedicated pre-provisioned
company/customer agent requires a dedicated explicitly created Workspace. A
trusted one-shot host script may seed context once; later edits are ordinary
Workspace data and are not continuously reconciled.

## Plugin boundary

Trusted plugins load once at startup and remain grouped by canonical ID.

- Agent view: source instructions + standard tools + assigned plugin
  prompt/tools/skills/Pi resources.
- Workspace provisioning view: union across all allowed agents plus explicit
  workspace plugins.
- Host view: routes, bridge handlers, preserved UI state, and packaged assets
  remain boot-time host-global surfaces for this shipment.

Agent assignment does not authorize or hide a plugin route. Routes and handlers
continue to enforce their own authentication/resource authorization.

Tool collisions remain deterministic and non-fatal with diagnostics. Do not add
a new fatal policy during Step 1A.

## Sessions

Reuse `SessionStore`/`PiSessionStore`; Core gets no session table. Workspace
constructs an actor-multiplexing session router before AgentBinding selection so
it can read trusted type metadata without circularly loading an agent. Existing
per-workspace/per-user session directories remain in place.

- New session: persist the Workspace-selected default `agentTypeId`.
- Typed execution/resume: use stored type only if still allowed.
- Disallowed/malformed stored type: stable execution error, never silent
  fallback; ownership-authorized list/state/attachment/changes/delete remains
  available without loading that agent.
- Legacy record without type: use current Workspace default.
- Deployment changes: resume with current definition for the same type.
- No forced rewrite of reviewed JSONL/history.
- No public arbitrary type selector.

One actor-neutral AgentBinding serves all members. Actor authorization,
credentials, and request context are supplied per execution and cannot be
captured in singleton tools/caches.

## Authored source and Pi direction

A1 source is declarative identity, version/label/description metadata, and
instructions only. Trusted host plugins own executable behavior. Authored data
cannot select tools/packages/credentials/MCP/model/runtime policy.

`agent dev` launches the regular Workspace server. There is no dev app or second
composer.

The desired follow-up is a Boring Pi package/extension seam capable of adding
Boring runtime context to any Pi agent. Workspace still owns auth-independent
orchestration and the shared runtime. The exact Pi API and Workspace-native
`pi-subagents` backend remain explicit follow-up issues.

## Step 1A implementation tracks

### C1 — Core product scope and two-domain auth

**Delivers:** `CoreProductRequestScope`, exact hostname normalization, static
Core product declarations, retirement/mutual exclusion of deployment-scope
fields, trusted proxy/cookie/origin/CSRF/logout proof on two domains. No agent
policy enters Core. Until C2 installs the post-authenticated membership/type
guard, typed mode keeps every non-public `/api/v1/*` surface dark with a stable
503 rather than exposing legacy untyped Workspace routes.

**Blocked by:** PR #846 authority. **Proof:** startup graph/type cross-check,
host spoof negatives, two-domain auth browser/server proof, full-app
compatibility.

### C2 — route-wide typed authorization and selection

**Delivers:** one post-auth Core guard that loads under current app, verifies
membership and persisted type, then issues the opaque Workspace invocation;
empty/one/several Workspace selection; route inventory covering every
Workspace-backed HTTP/stream/bridge/session surface; no implicit typed creation.

**Blocked by:** C1. **Proof:** before-effect counters for unauthenticated,
foreign-app, non-member, type mismatch, stale membership, and every inventoried
route family.

### C3 — durable explicit create and provisioning admission

**Delivers:** server-stamped type; durable idempotency operation/fingerprint;
atomic Workspace + owner membership; replay/conflict behavior; provider
operation ID; pending/ready/error and retry semantics; honest narrowing when a
provider cannot deduplicate crash windows.

**Blocked by:** C2. **Proof:** concurrent/restart/response-loss replay,
same-key/different-input conflict, no client type override, exact row/membership/
provider-resource counts, full-app default provisioning.

### C4 — typed Workspace frontend and rollback floor

**Delivers:** empty disabled/enabled, one, several, create/retry, switch, deep
link, logout/domain-reset UX; no agent selector; typed-aware compatibility
artifact exercised against migrated/non-default rows and histories.

**Blocked by:** C3 and #805 R3. **Proof:** component/E2E/visual product review,
foreign/mismatch negatives, restart/history, rollback/restore without hiding
non-default data.

### A1/Workspace-Agent track

#805 R0–R5 owns the embeddable Workspace host, shared runtime, typed bindings,
sessions, declarative source, regular dev launcher, and package conformance.
Its package foundation may complete independently of C1–C4.

### I1 — Seneca integration

#805 R6/#391 integration depends on **C4 + #805 R5**. It proves exact package
pins, two real domain/type/default-agent products, production restart, and
executed typed-aware rollback. R6 is not dispatchable from R5 alone.

```text
PR #846 → C1 → C2 → C3 → C4 ─┐
PR #846 → #805 R0→R1→R2a→R2b→R3→R4→R5 ─┼→ I1/R6
                                    └→ exact release/product proof
```

## Delivery status

- [x] 1A.0 Decision 26 and product-first reset merged.
- [x] 1A.1 persisted `workspaceTypeId` merged via #844.
- [x] 1A.2 PR #846 authority/A1/Workspace-agent recut approved; replacement
  graph merged via #864 and R0 audit recorded.
- [ ] 1A.3 WorkspaceRuntime/AgentBinding split and compatibility.
- [ ] 1A.4 actor-neutral session/ingress migration, static multi-agent backend, Core handoff, authored source,
  and regular dev launcher through #805 R1–R5.
- [ ] 1A.5 domain/auth/typed list-select-create and frontend flow.
- [ ] 1A.6 full-app package compatibility and Seneca two-product integration.
- [ ] 1A.7 production/rollback proof and exact release cohort.

Detailed A1/Workspace-agent slice boundaries and proof live in the #805 plan.
Domain/auth/create work may proceed independently where package ownership does
not overlap, but product enablement waits for both tracks.

## Acceptance for Step 1A

Step 1A is complete when:

1. every Workspace has stable persisted `workspaceTypeId` and existing rows are
   compatible;
2. exact domain/type routing is deployment-static and cannot grant membership;
3. auth, current-app membership, and type checks precede every Workspace/agent
   side effect;
4. typed listing never creates implicitly; explicit create stamps trusted type
   and is idempotent;
5. Core remains agent-agnostic;
6. Workspace owns one runtime and a lazy default/allowed AgentBinding map;
7. two different agents share exact Workspace/Sandbox identity with separate
   behavior and no plugin cross-leak;
8. initial human ingress starts new sessions with the default and exposes no
   arbitrary agent selector;
9. typed/legacy session behavior preserves history across restart;
10. full-app remains `default → primary` through the same orchestrator;
11. Seneca proves two real domain/workspace-type/default-agent products through
    normal packages/deployment;
12. no AgentHost, controller, deployment/publication content-addressed store,
    mutable registry, authored executable catalog,
    second composer, or second Workspace/Sandbox authority is introduced;
13. exact proof and independent architecture/auth/session/security review pass.

## Proof gates

Applicable slices run exact focused tests plus:

```bash
pnpm lint:invariants
pnpm typecheck
pnpm test
pnpm e2e
pnpm check:golden-path
git diff --check
```

Package and Seneca proof uses clean checkouts and packed/exact registry artifacts,
not workspace links. Deployment and rollback claims require executed evidence.

## Rollout and rollback

1. Land the one-runtime compatibility path first.
2. Prove full-app unchanged with omitted policy normalized to `primary`.
3. Land static multi-agent backend dark to human selection.
4. Qualify typed-aware session and rollback behavior.
5. Complete domain/auth/create/frontend flow.
6. Pack/test/publish one exact package cohort.
7. Integrate Seneca with one product dark, then two products.
8. Explicitly create typed Workspaces; do not retype existing history.
9. Execute restart, cross-product negative, rollback, and restore proof.

After typed/non-default sessions exist, rollback must use a typed-aware
compatibility cohort. Removing explicit policy is safe only before it would hide
or reinterpret stored non-default type identity.

## Out of scope for Step 1A

- public agent selector, switching, or arbitrary non-default direct chat;
- productized session forks;
- Workspace-native named-agent delegation;
- Boring Pi package/extension implementation;
- external MCP/A2A;
- durable tasks/events;
- contracted agents/governed projections;
- per-agent sandbox isolation;
- plugin route gating by workspace type;
- fatal tool-collision policy;
- dynamic policy registry/control plane;
- AgentHost, deployment/publication content-addressed storage, or revision
  machinery;
- marketplace, billing, mounts, channels, or fleet UX.

## Stop conditions

Stop and amend this plan if:

- behavior selection would occur before authorization;
- Core must inspect agent behavior;
- multiple agent types create multiple Workspace/Sandbox owners;
- actor-neutral singleton execution cannot preserve auth;
- session migration hides or rewrites history;
- a plugin list is treated as route authorization;
- a public selector or deferred Pi/subagent implementation is being smuggled
  into Step 1A;
- a registry/controller, AgentHost deployment/publication content-addressed
  store, or authored executable catalog reappears.
