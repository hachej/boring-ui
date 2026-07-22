# #391 vision — application agent fleet over governed Workspace environments

> Strategic summary under Decision 28. [`../plan.md`](../plan.md) owns product/
> release gates; the [#805 fleet plan](../../805/runtime-refactor/work/A1-agent-authoring/WORKSPACE-AGENT-FLEET-PLAN.md)
> solely owns implementation dispatch/order/contracts/acceptance.
> [`../AGENT-CONSUMPTION-MODES.md`](../AGENT-CONSUMPTION-MODES.md)
> defines ingress, collaboration, external, and contracted modes.

## North star

A developer defines service-shaped Agent applications, installs a trusted static
fleet in an app or CLI configuration, and lets Workspace orchestrate them over a
single governed Environment API. Core/web and CLI remain independent Workspace
consumers. A future remote adapter changes transport, not semantic contracts.

## Product principles

1. **One app fleet.** Stable Agent types, declarative source, and trusted plugins
   validate before serving; no runtime registry/controller.
2. **Workspace owns composition.** Workspace persists the default Agent,
   owns session authority/acting-Agent attribution, compiles per-invocation/task
   named Environment access, orchestrates AgentApplications, and owns Environment
   lifecycle; Pi retains transcript/replay/queue/model-loop mechanics.
3. **Consumers remain independent.** Core/web supplies auth/member context; CLI
   supplies trusted-local context. Neither runs through the other.
4. **Domain is onboarding only.** Exact signup hostname may initialize a new
   default Workspace's Agent and then disappears from routing/authorization.
5. **Agent is service-shaped.** V1 exposes streaming events/result and follow-up/
   interrupt/stop control in process; Workspace retains Environments until the
   terminal fence, distinguishes operation interrupt from lifetime cancellation,
   and closes/quarantines before outward result; future remote adapters preserve semantics
   without serializing local objects.
6. **Environment is one coherent service.** `boring-bash` owns file/search/watch/
   exec semantics; `boring-sandbox` owns neutral provider/confinement mechanics.
7. **Named Environment is the access unit.** Each name has one root, operation
   set, network policy, and one-Environment-only exec. `workspace` is canonical;
   delegated names expose approved source subsets without copy/sync.
8. **Governance precedes access.** Agent receives only an already-opened readonly
   Environment map, opaque model client, and Pi session runtime—not policy,
   membership, service/lifecycle, raw roots, or provider administration.
9. **Membership remains authority.** Web membership and CLI trusted-local policy
   are consumer authorization; Agent/domain/type/capability are not.
10. **Identity remains durable.** Workspace default and session acting type are
    persisted; fleet drift fails without silent fallback or hidden history.
11. **Protocols stay at edges.** Local orchestration is semantic/in-process;
    remote/A2A/Environment wire protocols require named consumers.
12. **Cross-Workspace work is explicit.** Contracted Agents use separate
    Workspaces and projections/artifacts.
13. **EU/self-host operation remains possible.** Providers and remote execution
    remain replaceable behind neutral contracts.

## Delivery horizons

### Horizon 1 — fleet/default foundation

- native named Environment operations/access compiler and neutral Sandbox backend;
- AgentApplication/fleet and Workspace orchestrator;
- Workspace default/session persistence;
- independent Core/web and CLI consumers;
- signup-domain initial default and shared sibling auth;
- two-Agent plus delegated-task subset/governance proof;
- packed/full-app/Seneca rollout and rollback.

### Horizon 2 — authenticated MCP and local collaboration UX

MCP reaches the authorized Workspace's persisted default. Trusted non-default
Agent invocation, human selector/default editing, and session forks require
separate product/authorization decisions.

### Horizon 3 — remote/durable expansion

Remote Agent and Environment adapters, durable tasks/events, external A2A,
channels, custom sandbox tools, and provider extraction follow named consumers.

### Later — contracted Agent platform

Contracted Agents operate in their own Workspace/Environment with governed
readonly input and returned artifacts. Billing, identity, customer-data hygiene,
and marketplace UX are separately gated.

## Current corrections

- PR #844's `workspaceTypeId` is compatibility-only and receives no behavior.
- PR #845's typed-product graph is superseded; exact-host/shared-auth security is
  recreated under signup-only semantics.
- Closed R0 audit and R4 declarative-authoring work remain evidence.
- Old Decision 26 typed-product and R1–R6 plans are historical.

## Explicitly retired

- Workspace-type Agent policy and type-filtered membership;
- product membership;
- Core Agent composition and CLI-through-Core hosting;
- universal combined WorkspaceAgentHost shell;
- exact shared Sandbox object as the only multi-Agent composition model;
- copied/synchronized same-Workspace or delegated-subset Environments;
- permanent RuntimeBundle, named-filesystem adapters, and local/remote Agent branches;
- generic Environment lease/view/token/refcount/secret-broker machinery;
- Workspace replacement of Pi session-runtime mechanics;
- AgentHost/controller/reconciler/deployment-publication CAS;
- mutable fleet registry and authored executable catalogs.
