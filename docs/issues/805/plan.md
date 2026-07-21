---
github: https://github.com/hachej/boring-ui/issues/805
issue: 805
state: ready-for-agent
phase: plan
track: owner
flag: not-needed
updated: 2026-07-20
---

# #805 — runtime package extraction and attachable environments

## Canonical entry

This issue owns runtime package extraction, attachable environments, and the
A1/E1/P1/P3–P8 work packages.

**A1 and the Workspace ↔ Agent foundation are the only active work.** Their
canonical plan is:

- [`A1-agent-authoring/PLAN.md`](runtime-refactor/work/A1-agent-authoring/PLAN.md)

The recut delivers:

- declarative authored identity/safe metadata/instructions only;
- trusted host plugins for executable behavior;
- one Workspace-owned WorkspaceRuntime and lazy typed AgentBindings;
- Core authorization/persistence without agent composition;
- default-only human ingress over a multi-agent-ready backend;
- regular-server `agent dev`;
- full-app and Seneca package proof.

Merged #814 is corrective input. The owner confirmed its published catalog
surface has no consumers and approved one separately reviewed corrective R4
follow-up without a compatibility window or dedicated `0.2.0` boundary. Open
#816/#817 and Seneca #16 must not merge in their superseded catalog/dev-app
form.

P3's retained
[`Decision 26 remaining-work plan`](runtime-refactor/work/P3-routes-tools/DECISION-26-PLAN.md)
is **non-dispatchable pending a post-#846 recut**. Its former test-freeze/v1 gate,
authored `toolCatalog` taxonomy, and custom-tool slices conflict with this
ownership/runtime plan. No P3 preparation or product code runs until its owner
removes those assumptions and re-establishes consumer/#808/Step 3 gates.

E1/P1/P4–P8 remain retained and non-dispatchable until separately recut against
[`../391/ROADMAP-ALIGNMENT.md`](../391/ROADMAP-ALIGNMENT.md).

## Package ownership fixed by A1

- **Core:** auth, membership, Workspace persistence, `workspaceTypeId`.
- **Workspace:** static default/allowed-agent policy, plugin views, shared runtime,
  provisioning union, typed singleton map, orchestration.
- **Agent:** load/execute one requested type against a supplied runtime.
- **CLI:** validate declarative source and launch the regular server.
- **Host apps:** domains, Workspace product policy, global agent definitions,
  installed trusted plugins, pins/rollback.

The exact Boring Pi package/extension seam and Workspace-native `pi-subagents`
executor are follow-up plans, not hidden A1 implementation scope.

## Canonical work-package documents

- [`A1-agent-authoring`](runtime-refactor/work/A1-agent-authoring)
- [`E1-environment-attachments`](runtime-refactor/work/E1-environment-attachments)
- [`P1-headless-core`](runtime-refactor/work/P1-headless-core)
- [`P3-routes-tools`](runtime-refactor/work/P3-routes-tools)
- [`P4-file-ui`](runtime-refactor/work/P4-file-ui)
- [`P5-provisioning-secrets`](runtime-refactor/work/P5-provisioning-secrets)
- [`P6-plugin-child-app`](runtime-refactor/work/P6-plugin-child-app)
- [`P7-multi-agent-inspection`](runtime-refactor/work/P7-multi-agent-inspection)
- [`P8-verification`](runtime-refactor/work/P8-verification)

#391 remains product sequencing authority through
[`../391/plan.md`](../391/plan.md). A retained work package regains dispatch
authority only through its own Decision 26 recut and explicit trigger.
