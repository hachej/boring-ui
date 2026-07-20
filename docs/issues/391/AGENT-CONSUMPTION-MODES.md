# Agent consumption modes

> Shared architecture contract. [`plan.md`](plan.md) controls delivery order.
> This document prevents the default-agent first product from blocking later
> MCP, native collaboration, A2A, and contracted-agent modes.

## Principle

Workspace membership is the only live authority for Workspace contents. Domain,
Workspace type, agent type, protocol, plugin assignment, and commercial
relationship never grant membership.

Core authorizes the Workspace. Workspace owns its shared runtime and selects an
allowed agent type. Agent executes that type. Protocols bind at the edge.

## Mode 0 — human or client ingress to its own Workspace

### Web/UI

```text
human
→ exact product domain
→ authenticated membership
→ typed Workspace
→ Workspace default agent
```

Step 1A ships this mode. The backend already carries a default plus allowed set
and proves typed singletons share one runtime, but public HTTP/UI requests do not
supply arbitrary `agentTypeId`. New sessions use the default; an existing session
may resolve trusted persisted type internally.

### MCP

```text
external client
→ authenticated MCP
→ its authorized typed Workspace
→ server-selected default agent
```

MCP is a door into the caller's own Workspace, not an agent distribution or
internal delegation mechanism. Client-supplied Workspace/agent identifiers
cannot bypass auth/membership/type checks.

**Delivery:** Step 1B under #806 after Step 1A proof.

## Mode 1 — Workspace-local agent collaboration

```text
Agent A → Agent B
same authorized Workspace
same WorkspaceRuntime + Sandbox
```

Properties:

- Workspace policy must allow both types;
- Workspace resolves the target through a trusted internal seam;
- both receive the exact same Workspace/Sandbox trust domain;
- prompts/tools/plugins differ as behavior, not isolation;
- originating user/Workspace remains principal;
- acting agent and target session are attributed;
- repeated instances of one type are sessions/runs, not duplicate
  AgentBindings;
- native Pi limits for spawn/depth/timeout/cancellation remain authoritative;
- no MCP/A2A loopback and no second Workspace recursion policy.

Step 1A builds and proves the backend singleton/runtime substrate but does not
activate cross-agent calls. The current `pi-subagents` implementation launches
child processes and does not share Boring's WorkspaceRuntime. Step 2 requires a
compatible executor/backend before claiming this mode.

Human selector, direct non-default chat, agent switching, and productized session
forks are independent UX decisions, not prerequisites for native collaboration.

## Mode 2 — external agent ingress to our Workspace

```text
external agent
→ A2A edge
→ authenticated principal
→ authorized typed Workspace
→ policy-approved target
```

Properties:

- A2A is an external edge binding;
- resource/audience validation happens at the edge;
- domain may identify product but not authorize Workspace access;
- arbitrary target IDs are rejected;
- external `auth-required` maps at the adapter boundary;
- public multi-turn/restart promises require durable admission/events/replay.

**Delivery:** Step 3 after the durable task/event contract.

## Mode 3 — contracted/service agent in another Workspace

```text
caller Workspace Agent A
→ contracted Agent C
→ Agent C's explicit Workspace + Sandbox
```

This mode provides real isolation because the agent owns another Workspace.
Loading or delegating to an agent type never creates that Workspace implicitly.

Properties:

- neither side gains membership in the other's Workspace;
- no live cross-workspace filesystem grant or mount;
- caller-approved input becomes a governed bounded readonly snapshot;
- contractor works in its own scratch/data boundary;
- additional context uses `input-required` and fresh authorization;
- results return as artifacts/deliverables;
- originating user/Workspace and both acting agents remain attributable;
- target lifecycle is independent;
- billing/budgets may decorate the shared invocation contract later;
- customer-data hygiene must be settled before third-party contracting.

A trusted host may explicitly create and seed a dedicated company/customer
Workspace once. After seeding, files are ordinary Workspace data; no hidden
reconciler continuously overwrites them.

**Delivery:** later demand-gated work under #809 after durable tasks/artifacts and
governed projections are approved.

## Optional future mode — outbound external agent

Our Workspace may eventually call an external agent. It requires explicit target
policy, disclosure approval, credential handling, artifact validation, budgets,
and external A2A. It is not implied by Steps 1–2.

## Shared invariants

1. Authenticate and verify membership before Workspace/agent execution.
2. Core persists/authorizes; Workspace orchestrates; Agent executes one type.
3. Workspace type and agent type are trusted server-derived identity, never
   client authority.
4. One WorkspaceRuntime/Sandbox lifecycle is shared by all agents in one
   Workspace.
5. One actor-neutral singleton exists per `(workspaceId, agentTypeId)`.
6. Same-Workspace agents share runtime authority; cross-Workspace agents do not.
7. No live cross-Workspace grants for contracted execution.
8. UI/MCP/HTTP/CLI/A2A are bindings, not alternate model loops.
9. Same-process collaboration remains native; external protocols stay at edges.
10. Sessions/tasks bind trusted Workspace and acting-agent identity before
    session-ID-only transports are exposed.
11. Legacy sessions without type use current Workspace default; reviewed history
    is not force-rewritten.
12. Artifacts and projections are bounded, authorized, and attributed.
13. Existing Pi depth/spawn/timeout/cancellation limits remain authoritative.
14. Public external access requires auth, limits, stable errors, revocation, and
    honest durability claims.

## Delivery map

| Delivery | Modes |
| --- | --- |
| Step 1A | Mode 0 Web/UI default agent; multi-agent-ready backend only |
| Step 1B | Mode 0 authenticated external MCP |
| Step 2 | Mode 1 native Workspace-local collaboration |
| Step 3 | Durable tasks/events and Mode 2 external A2A |
| Later | Mode 3 contracted agents, external egress, marketplace/billing |

## Explicit non-goals

- public hidden `agentTypeId` selector in Step 1A;
- MCP/A2A loopback for internal collaboration;
- treating different tool lists as isolation;
- implicit Workspace creation during agent delegation;
- a second ACL system for agent principals;
- live cross-Workspace mounts for contractor input;
- a controller, broker, or durable task state machine in Step 1A;
- claiming current child-process `pi-subagents` shares WorkspaceRuntime.
