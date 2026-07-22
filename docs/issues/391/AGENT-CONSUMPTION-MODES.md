# Agent consumption modes

> Shared architecture contract under Decision 28. [`plan.md`](plan.md) owns
> product/release gates; the [#805 fleet plan](../805/runtime-refactor/work/A1-agent-authoring/WORKSPACE-AGENT-FLEET-PLAN.md)
> solely owns implementation dispatch/order/contracts/acceptance. Workspace bundles a static application fleet and persists its
> default Agent. Core/web and CLI are independent Workspace consumers.

## Principle

Consumer authorization is required before every Workspace operation:

- web: authentication plus current-app Workspace membership;
- CLI: explicit trusted-local Workspace/root policy.

Signup domain, Workspace type, Agent identity, named Environment access, protocol,
plugin, session metadata, and commercial relationship never grant Workspace
access.

Workspace owns fleet/default resolution, session authority/attribution,
governance, and orchestration; Pi retains session runtime mechanics. Agent
executes one service-shaped application. `boring-bash` opens governance-approved
named Environments over hidden `boring-sandbox` backends.

## Mode 0 — default Agent in the caller's Workspace

### Web/UI

```text
human
→ authenticate + verify ordinary Workspace membership
→ Workspace.defaultAgentTypeId
→ fleet AgentApplication
→ governance-approved named Environment map
```

An exact trusted signup hostname may choose the initial default only while a new
default Workspace is created. Later login/navigation through any sibling domain
shows the same authorized Workspace portfolio and does not change its default.

Initial human UX exposes only the persisted default. No public request supplies
arbitrary `agentTypeId`.

### CLI

```text
trusted CLI fleet YAML + local Workspace registry
→ trusted-local Workspace context
→ Workspace.defaultAgentTypeId
→ same Workspace/Agent/Environment contracts
```

CLI does not call Core or emulate web membership. It is an independent consumer
with the same semantic conformance.

### MCP

```text
external client
→ authenticated MCP principal
→ authorized Workspace
→ Workspace persisted default Agent
```

MCP is a door into the principal's Workspace, not distribution or internal
collaboration. Delivery remains after the default web/CLI product proof.

## Mode 1 — Workspace-local fleet collaboration

```text
Agent A → Workspace orchestrator + delegation purpose → Agent B
                                  └→ task-specific Environment policy
Agent B receives only named Environments/subsets approved for that task
```

Properties:

- both types belong to the deployment-static application fleet;
- Workspace resolves the target through a trusted internal operation;
- each Agent is service-shaped and initially invoked in process;
- Agent A may use the canonical `workspace` Environment while Agent B receives
  a differently named Environment view over only the approved subset;
- each Environment has one root and one command can access only that name;
- subset views reference canonical source data without copied/synchronized trees;
- backend reuse is optional/private and fresh per-open behavior is sufficient;
- acting Agent, originating actor/Workspace, session, invocation, and result are
  attributable;
- repeated uses of one type are sessions/runs, not duplicate logical fleet
  definitions;
- Workspace derives immutable lineage and freshly authorizes every edge; verified
  installed-Pi guards remain authoritative and Workspace supplies only missing
  depth/cycle/fan-out/execution-timeout/cascade once, without a second dispatcher;
- parent cancellation cascades and child cleanup completes before parent result;
- no MCP/A2A loopback.

Human selector/default editing and productized session forks remain separate UX
decisions. A future remote Agent adapter must implement the same AgentApplication
semantics; it does not change Workspace authorization.

## Mode 2 — external Agent ingress

```text
external Agent
→ A2A edge
→ authenticated principal
→ authorized Workspace
→ policy-approved fleet target
```

Properties:

- A2A is an external binding;
- audience/resource validation occurs at the edge;
- arbitrary Workspace/Agent identifiers are rejected;
- public multi-turn/restart promises require durable task/event admission,
  replay, cancellation, and recovery;
- domain is unrelated after signup.

Delivery remains after durable task/event contracts.

## Mode 3 — contracted/service Agent in another Workspace

```text
caller Workspace Agent
→ contracted Agent's Workspace
→ contracted Agent's governed Environment
```

This is the real cross-customer isolation model:

- neither side gains membership in the other's Workspace;
- no live cross-Workspace filesystem grant;
- caller-approved input is an explicit task-bound readonly named Environment;
- contractor works in its own canonical `workspace` Environment;
- additional context uses fresh authorization;
- results return as artifacts;
- both actors/Workspaces remain attributable;
- billing/data-hygiene policy is separately approved.

Contracted input policy is future scope. It must reuse the named-Environment
model without creating ambient cross-Workspace ACLs or pretending a copied tree
is the caller's live canonical Workspace.

## Environment consumption

Agent, Workspace UI, and CLI reach files/search/watch/exec through named
Environments opened by trusted Workspace composition. They do not hold the
service, lifecycle close functions, raw roots, or provider administration.

For each invocation/task, governance compiles zero or more Environment access
records containing:

- stable Environment name and authorized logical source;
- exact path subset;
- operation set and readonly/readwrite/absent effect;
- network requirements and expiry/audit facts.

The Environment service resolves sources; the Sandbox backend physically
materializes the exact root/subset. Base read/write/edit/find/grep/ls/bash calls
carry one required model-visible Environment name, exact-map-select it, and call
that Environment directly. Every other retained tool that touches files/exec
must do likewise; unrelated UI/plugin/diagnostic tools keep existing owners.
Agent-independent member operations use their own authorization variant. Agent
cannot request an absent name, mint another
Environment, or widen it. Current command-credential behavior is unchanged.

## Shared invariants

1. Consumer authorization precedes every Workspace effect.
2. Workspace membership is web authority; trusted-local registry/root policy is
   CLI authority.
3. Core/web and CLI independently consume Workspace and never route through one
   another.
4. Workspace validates one static application fleet and persists a default.
5. Signup hostname initializes a new default only and has no later authority.
6. Workspace type has no Agent, membership, routing, session, provisioning, or
   cache semantics.
7. AgentApplication is streaming/control service-shaped but initially in process;
   operation interrupt preserves follow-up; terminal result/stop/cancel/expiry/
   shutdown closes exactly once, and unconfirmed cleanup cannot report success.
8. Workspace owns session authority/identity/acting-Agent attribution/routing;
   Pi retains transcript/replay/follow-up-queue/model-loop mechanics.
9. `boring-bash` owns native named Environment operation/coherence semantics;
   `boring-sandbox` owns Agent/Workspace-neutral confinement providers.
10. Files and bash inside one Environment use one root; one command cannot
    access multiple Environment names, and no synchronization copy exists.
11. A delegated Agent receives a new task-bound policy and only the approved
    named source subset; backend reuse is optional and unobservable.
12. Governance policy is trusted Workspace composition; Agent receives only a
    readonly map of already-opened Environments.
13. Model/provider credentials remain separate from Environment access; current
    command-credential behavior is preserved and redesign deferred.
14. Sessions store acting Agent identity; missing fleet types fail execution
    without hiding authorized history.
15. UI/MCP/HTTP/CLI/A2A are bindings, not alternate model loops.
16. Contracted Agents use separate Workspaces and explicit projections/artifacts.
17. Public external access requires auth, limits, stable errors, revocation, and
    honest durability.

## Delivery map

| Delivery | Modes |
| --- | --- |
| F0–F6 | Mode 0 web + CLI default Agent and shared Environment foundation |
| F7 | Mode 1 backend conformance; public selector still absent |
| After product proof | Mode 0 authenticated MCP |
| Later durability/A2A | Mode 2 |
| Later contracting | Mode 3 |

## Explicit non-goals

- product membership or type-filtered Workspace portfolios;
- public hidden `agentTypeId` selector in initial delivery;
- domain-based Agent selection after Workspace initialization;
- MCP/A2A loopback for local collaboration;
- Agent-evaluated governance, direct EnvironmentService access, or self-opened/
  widened Environment names;
- copied/synchronized same-Workspace working trees;
- remote Agent/Environment protocol without a named consumer;
- mutable fleet registry/controller;
- live cross-Workspace mounts for contracted input;
- claiming tool/prompt differences provide isolation.
