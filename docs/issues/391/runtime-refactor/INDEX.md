# #391 runtime-refactor index

> Decision 28 and [`../plan.md`](../plan.md) are current. Decision 26's typed
> Workspace product topology and the old #805 R1–R6 graph are historical.

## Current sequence

```text
F0a authority + replacement Beads
→ F0b grounded consumer/provider/publication inventory
→ F1 Environment operation/admission contracts
→ F2a neutral Sandbox backend + F2b-i service + F2b-ii consumer migration
→ F3 AgentApplication fleet + Workspace orchestrator
→ F4a hosted default/#844 correction + F4b CLI/session persistence
→ F5 Core/web signup initializer + shared auth + #845 closure
→ F6 independent CLI consumer
→ F7 two-Agent/governance/canonical-data conformance
→ H2c approval → F2c contraction → F8a qualification → H8 approval → F8b publication proof
```

Exact split slices and dependencies live in the #805 fleet plan referenced by the
canonical #391 plan.

## Current facts

- R0 publication/consumer audit is merged evidence and is refreshed in F0b.
- R4 declarative authored-source correction is merged and remains closed.
- PR #844 landed `workspaceTypeId`; F4a demotes it to inert compatibility and
  adds hosted Workspace default-Agent persistence.
- PR #845 is open but no longer mergeable semantically; F5 recreates only
  hostname/shared-auth security and closes/supersedes it.
- Existing direct/bwrap/Vercel providers are migration inputs, not the final
  Agent/Workspace-neutral Environment backend.
- Existing `boring-bash` filesystem-binding/governance work is prior art for the
  Environment service.

## Hard boundaries

- Core/web and CLI independently consume Workspace.
- Workspace owns fleet/default/session/governance/orchestration.
- Agent owns one service-shaped model application.
- `boring-bash` owns Environment operations/coherence.
- `boring-sandbox` owns neutral provider/confinement mechanics.
- Domain initializes a new Workspace default only.
- Web membership or CLI trusted-local policy authorizes every Workspace
  operation.
- One canonical filesystem/API serves file tools, bash, UI, CLI, and Agents.
- Agent receives capability-bound operations, not policy or provider admin.
- Fleet is static; no registry/controller.
- Remote protocols wait for real consumers.

## Package plan

Active: [`../../805/runtime-refactor/work/A1-agent-authoring/WORKSPACE-AGENT-FLEET-PLAN.md`](../../805/runtime-refactor/work/A1-agent-authoring/WORKSPACE-AGENT-FLEET-PLAN.md).

Historical evidence: the old A1 `PLAN.md`, `HANDOFF.md`, `TODO.md`, R0 audit, and
R4 proof. Their unchecked Decision 26 items do not dispatch work.

## Later horizons

- authenticated MCP to persisted default;
- public/local Agent selection and delegation;
- remote Agent/Environment adapters;
- durable tasks/events and external A2A;
- contracted Agents with separate Workspace/projections/artifacts;
- billing, channels, custom tools, mounts, marketplace.
