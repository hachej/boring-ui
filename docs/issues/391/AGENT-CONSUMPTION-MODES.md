# Agent consumption modes

> Shared architectural contract. [`plan.md`](plan.md) controls delivery order.
> This document prevents Step 1A from blocking later MCP/A2A/delegation modes;
> it does not make those later modes dispatchable.

## Principle

Workspace membership is the only live authority for workspace contents. Agent identity, domain routing, protocol choice, and commercial relationships do not grant workspace membership.

All agent execution remains workspace-backed. The same high-level task concepts may eventually be projected across bindings—task, context, messages, `input-required`, artifacts, provenance, and terminal state—but each mode uses the binding natural to its trust boundary.

## Mode 0 — Human or client ingress to its own workspace

### Web/UI

An authenticated human opens an authorized workspace and uses its configured agent. Step 1A ships this mode through domain → workspace type → sole agent type.

### MCP

An authenticated external client reaches its own authorized workspace's tools/resources/agent. MCP is a door into the caller's workspace, not a way to distribute or contract another agent.

MCP must resolve the same persisted workspace type and server-selected agent behavior as the UI. Client-supplied workspace/agent identifiers never bypass authentication, membership, or type compatibility.

**Delivery:** Step 1B under #806.

## Mode 1 — Workspace-local agent delegation

```text
Agent A -> Agent B
same authorized workspace
same Workspace + Sandbox trust domain
```

Properties:

- target agent is configured for the same workspace type;
- caller and target share the workspace filesystem/process/runtime authority;
- different prompt/tool lists are behavior, not security isolation;
- originating user/workspace remains principal;
- target agent is recorded as acting agent;
- separate sessions/attribution may be used;
- use existing native Pi subagents/in-process calls;
- never serialize through MCP or external A2A loopback.

Step 1A preserves this extension seam but has only one agent per workspace. Step 2 introduces multiple allowed agent types and proves workspace-local delegation.

## Mode 2 — External agent ingress to our workspace

```text
external agent
-> external A2A endpoint
-> authenticated principal
-> one authorized Boring/Seneca workspace
-> configured target agent
```

Properties:

- external A2A is an edge protocol binding;
- external authentication and resource/audience validation occur at the edge;
- domain may identify the product, but authorization still resolves a principal and workspace membership;
- arbitrary workspace/agent identifiers are rejected;
- external `auth-required` maps at the adapter boundary rather than becoming an internal no-trust-boundary state;
- bounded task admission may start process-local, but public multi-turn/restart behavior requires durable receipts/events/replay.

**Delivery:** Step 3 after the durable task/event contract, jointly aligned with #807 and #809.

## Mode 3 — Contracted/service agent outside the caller workspace

```text
caller workspace Agent A
-> contracted Agent C
-> Agent C's own workspace and sandbox
```

This is the Seneca-internal contractor/service case even when both agents run in one Seneca deployment.

Properties:

- the contracted agent does not become a member of the caller workspace;
- the caller receives no membership in the contractor workspace;
- no live cross-workspace filesystem grant or mount is created;
- caller-selected input becomes a governed readonly snapshot/projection attached to the task;
- contractor writes only its own scratch and deliverables;
- additional context uses `input-required` plus fresh authorization;
- results return as artifacts/deliverables;
- originating user/workspace is principal and both acting agents are attributed;
- target workspace/sandbox lifecycle remains independent;
- budgets/metering may decorate the common invocation pipeline later;
- contractor data hygiene across customers must be settled before third-party contracting opens.

Within one Seneca process this may use a native binding over the common consumption contract. Across deployments it uses external A2A. The mode difference is workspace binding plus governed projection—not a forked task dispatcher.

**Delivery:** later demand-gated contracting work under #809, after durable task/artifact and governance projection requirements are approved.

## Optional future mode — Our workspace delegates to an external agent

This is the egress mirror of Mode 2. It requires explicit outbound target policy, disclosure approval, credential handling, artifact validation, budgets, and external A2A. It is not required by Steps 1–2 and becomes a separate consumer-backed plan.

## Shared invariants

1. Authenticate before workspace or agent execution.
2. Membership remains the only live workspace access boundary.
3. Workspace type and agent type are trusted server-derived identity, never client authority.
4. Workspace + Sandbox swap and dispose as one runtime-mode pair.
5. Same-workspace agents share runtime authority; cross-workspace agents do not.
6. No live cross-workspace grants for contracted execution.
7. UI, MCP, HTTP, CLI, and A2A are bindings, not alternate model loops.
8. Same-process calls remain native; external protocols stay at edges.
9. Sessions/tasks bind trusted workspace and acting-agent identity durably before session-ID-only transports are exposed.
10. Artifacts and input projections are bounded, authorized, and attributed.
11. Cycles, depth, cancellation, timeout, and budgets become mandatory when agent delegation is productized.
12. Public external access requires baseline auth, limits, stable errors, and revocation; durability may be phased but cannot be falsely promised.

## Relationship to delivery steps

| Delivery | Modes |
| --- | --- |
| Step 1A | Web/UI ingress to one typed workspace and one agent |
| Step 1B | Authenticated external MCP to that same workspace/agent |
| Step 2 | Multiple agents in one workspace and Mode 1 native delegation |
| Step 3 | Durable task/events, Mode 2 external A2A, hardened transports |
| Later | Mode 3 contracted/service agents, external egress, marketplace/billing |

## Explicit non-goals

- MCP loopback for internal delegation.
- A2A serialization between agents in the same process.
- A second ACL system for agent principals.
- Live cross-workspace mounts for contractor input.
- One writable contractor workspace shared across customers without a hygiene policy.
- A controller, broker, or durable task state machine in Step 1A.
