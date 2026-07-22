# Agent consumption modes

> Shared architecture contract under Decision 28. [`plan.md`](plan.md) controls
> delivery order. Workspace bundles a static application fleet and persists its
> default Agent. Core/web and CLI are independent Workspace consumers.

## Principle

Consumer authorization is required before every Workspace operation:

- web: authentication plus current-app Workspace membership;
- CLI: explicit trusted-local Workspace/root policy.

Signup domain, Workspace type, Agent identity, Environment capability, protocol,
plugin, session metadata, and commercial relationship never grant Workspace
access.

Workspace owns fleet/default resolution, sessions, governance, and
orchestration. Agent executes one service-shaped application. `boring-bash`
provides governed Environment operations over `boring-sandbox` backends.

## Mode 0 — default Agent in the caller's Workspace

### Web/UI

```text
human
→ authenticate + verify ordinary Workspace membership
→ Workspace.defaultAgentTypeId
→ fleet AgentApplication
→ governed Environment lease
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
Agent A → Workspace orchestrator → Agent B
same authorized logical Workspace
same canonical Environment filesystem API
```

Properties:

- both types belong to the deployment-static application fleet;
- Workspace resolves the target through a trusted internal operation;
- each Agent is service-shaped and initially invoked in process;
- both consume governed Environment operations over the same canonical
  Workspace data, without copied/synchronized working trees;
- compatible environment grants may share a backend, but authority-bearing
  invocation leases are never shared across actors/invocations;
- a narrower grant receives a separately enforced execution view;
- acting Agent, originating actor/Workspace, session, invocation, and result are
  attributable;
- repeated uses of one type are sessions/runs, not duplicate logical fleet
  definitions;
- native Pi spawn/depth/timeout/cancellation limits remain authoritative;
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
- caller-approved input is an explicit readonly projection/filesystem;
- contractor works in its own canonical Workspace environment;
- additional context uses fresh authorization;
- results return as artifacts;
- both actors/Workspaces remain attributable;
- billing/data-hygiene policy is separately approved.

A projection is intentionally a distinct filesystem. It does not violate the
no-copy rule for ordinary same-Workspace collaboration because it does not
pretend to be the caller's live canonical Workspace.

## Environment consumption

Agent, Workspace UI, and CLI reach files/search/watch/exec through Workspace-
owned admissions to the same `boring-bash` Environment service. They do not hold
raw provider administration or host/remote roots.

Governance compiles:

- named filesystem bindings and readonly/readwrite/absent views;
- operation set;
- network/runtime requirements;
- one-exec secret grants;
- expiry/cancellation/audit facts.

The Environment service and Sandbox backend enforce the result. Agent cannot
mint or widen it.

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
7. AgentApplication is service-shaped but initially in process.
8. Workspace owns session persistence/routing/queue/cancellation and passes
   bounded session surfaces to Agent.
9. `boring-bash` owns Environment operation/coherence semantics;
   `boring-sandbox` owns Agent/Workspace-neutral confinement providers.
10. Files and bash use one canonical Workspace filesystem API; no host/Sandbox
    synchronization copy or per-Agent canonical copy exists.
11. Backend/storage reuse and invocation authority are separate: leases/views are
    actor/Agent/session/invocation scoped.
12. Governance policy is trusted Workspace composition; Agent receives only
    attenuated operations.
13. Model credentials and shell execution secrets are separate, invocation-
    scoped capabilities and never reusable Environment state.
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
- Agent-evaluated governance or self-issued Environment capability;
- copied/synchronized same-Workspace working trees;
- remote Agent/Environment protocol without a named consumer;
- mutable fleet registry/controller;
- live cross-Workspace mounts for contracted input;
- claiming tool/prompt differences provide isolation.
