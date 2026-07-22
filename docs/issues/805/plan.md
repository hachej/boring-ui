---
github: https://github.com/hachej/boring-ui/issues/805
issue: 805
state: ready-for-agent
phase: plan
track: owner
flag: not-needed
updated: 2026-07-21
---

# #805 — Agent applications, Workspace orchestration, and execution environments

## Canonical entry

#805 owns reusable package implementation under Decision 28. Product sequence
and final rollout remain in [`../391/plan.md`](../391/plan.md).

Active package plan:

- [`WORKSPACE-AGENT-FLEET-PLAN.md`](runtime-refactor/work/A1-agent-authoring/WORKSPACE-AGENT-FLEET-PLAN.md)

Historical Decision 26 snapshot:

- [`PLAN.md`](runtime-refactor/work/A1-agent-authoring/PLAN.md)
- [`HANDOFF.md`](runtime-refactor/work/A1-agent-authoring/HANDOFF.md)
- [`TODO.md`](runtime-refactor/work/A1-agent-authoring/TODO.md)

Unchecked items in the historical snapshot do not dispatch work. Closed R0
publication evidence and R4 declarative-authoring proof remain retained inputs.

## Active outcome

```text
Core/web adapter ─┐
                  ├→ Workspace orchestrator → AgentApplication
CLI adapter ──────┘             │
                                └→ boring-bash EnvironmentService
                                      └→ boring-sandbox backend
```

- one deployment-static application Agent fleet, with every configured member
  available to every authorized Workspace in v1 and no per-Workspace allowlist;
- one durable `defaultAgentTypeId` per initialized Workspace;
- Core/web and CLI as independent Workspace consumers;
- Workspace-owned fleet/default/session authority, named-Environment governance,
  and orchestration; Pi retains transcript/replay/queue mechanics;
- service-shaped streaming/control Agent applications, initially in process,
  with Workspace-owned terminal cleanup;
- `boring-bash`-owned native named Environment API for coherent files/search/
  watch/exec; every retained Environment-backed tool names and directly uses one opened Environment;
- Agent/Workspace-neutral `boring-sandbox` providers;
- one canonical Workspace filesystem/API with no host/Sandbox sync copy;
- governance-compiled per-Agent/per-task Environment source/subset/operation/
  network access, physically enforced for file and one-Environment-only exec;
- current command-credential behavior, separate from consumer-issued opaque
  model clients and host-only provider credentials;
- regular `agent dev`, package, full-app, and Seneca conformance.

## Package ownership

- **Core/web:** web auth/membership and persistence adapter; independent
  Workspace consumer; no Agent composition or product/type portfolio.
- **CLI:** fleet YAML/local registry/trusted-local adapter; independent Workspace
  consumer; no Core dependency.
- **Workspace:** normalized fleet, durable default semantics, session authority/
  attribution, governance policy compilation, AgentApplication lifecycle/
  orchestration, and owner-only Environment open/close.
- **Agent:** dedicated streaming/control application API and model behavior;
  consumes only named Environments, opaque model client, and Pi session runtime.
- **`boring-bash`:** native named Environment operations, logical-source/subset
  resolution, canonical file/bash coherence, local service implementation.
- **`boring-sandbox`:** neutral backend providers and physical confinement.
- **Host roots:** select providers, construct Environment service, supply trusted
  plugins/fleet/signup map, pins, and rollback.

## Corrections

- PR #844 `workspaceTypeId` is compatibility-only; the active plan audits/demotes
  it and adds default-Agent persistence.
- PR #845 typed-product code must not merge; exact-host/shared-auth security is
  recreated under signup-only semantics.
- Merged #814 is historical corrective input; closed R4 has removed authored
  executable catalog semantics.
- PRs #816/#817 and Seneca #16 remain superseded.

## Deferred work packages

E1/P1/P3–P8 documents are retained research. They regain authority only when
Decision 28's active fleet plan explicitly adopts a requirement and the Bead DAG
names it. In particular, old runtime-free, route/tool, environment-attachment,
Workspace-type policy, multi-agent inspection, and verification ordering cannot
self-dispatch.

## Current documents

- [`A1-agent-authoring`](runtime-refactor/work/A1-agent-authoring)
- [`E1-environment-attachments`](runtime-refactor/work/E1-environment-attachments)
- [`P1-headless-core`](runtime-refactor/work/P1-headless-core)
- [`P3-routes-tools`](runtime-refactor/work/P3-routes-tools)
- [`P4-file-ui`](runtime-refactor/work/P4-file-ui)
- [`P5-provisioning-secrets`](runtime-refactor/work/P5-provisioning-secrets)
- [`P6-plugin-child-app`](runtime-refactor/work/P6-plugin-child-app)
- [`P7-multi-agent-inspection`](runtime-refactor/work/P7-multi-agent-inspection)
- [`P8-verification`](runtime-refactor/work/P8-verification)

A retained document is not dispatch authority unless the active fleet plan and
Bead graph explicitly adopt it.
