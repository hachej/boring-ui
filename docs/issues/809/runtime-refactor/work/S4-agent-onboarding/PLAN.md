> **Work-package status:** retained research and non-dispatchable until this
> child issue’s canonical plan and Bead graph are recut under Decision 26.
> Stale readiness, Decision 25 P0→N1, and AgentHost/D1 passages have no authority.

# S4-agent-onboarding — Plan

Status: post-v1; not a #391 v1 exit gate.

> Phase: Phase S4 - agent onboarding status · Work order: [TODO.md](TODO.md) · Handoff: [HANDOFF.md](HANDOFF.md)
> Ordering authority: [INDEX.md](../../../../391/runtime-refactor/INDEX.md) · Vision: [VISION.md](../../../../391/runtime-refactor/VISION.md) · PR plan: [PR-PLAN.md](../../../../391/runtime-refactor/PR-PLAN.md)

## Governing architecture

- [S3-control-plane-ux](../S3-control-plane-ux/TODO.md) - observe/inspect/approve control-plane UX that S4 extends, not rewrites.
- [P6-plugin-child-app](../../../../805/runtime-refactor/work/P6-plugin-child-app/TODO.md) - canonical
  `AgentDefinition`/`AgentDeployment` and P6-R resolution.
- [M2-mcp-agent-surface](../../../../806/runtime-refactor/work/M2-mcp-agent-surface/TODO.md) - demo endpoint status.
- [D1-tenant-provisioning](../../../../391/runtime-refactor/work/D1-tenant-provisioning/TODO.md) - provisioning status.
- [D2-shared-tenant-mesh](../../../../391/runtime-refactor/work/D2-shared-tenant-mesh/TODO.md) - shared-tier tenant readiness status.

## Design context

S4 is not an authoring UI. It is an onboarding/readiness status view layered on
top of S3's control-plane surfaces. It answers whether a declared agent is ready
to demo or provision: definition readiness, demo URL status, provisioning status,
and missing policy refs.

**Amendment (2026-07-08):** S4 also shows shared-tier tenant readiness from D2:
subdomain live, isolation-conformance green, and tenant lifecycle/demo gate
status. It remains read-only; D2 BBD2-006 owns authoring controls.

## Deliverables

- Read-only onboarding status for each declared agent.
- Definition readiness: missing/unknown instruction/persona/capability/
  environment/sandbox/governance/model/demo/pricing/exposure refs.
- Demo URL status from M2 exposure config.
- Dedicated provisioning status from D1.
- Shared subdomain tenant readiness from D2.
- Links back to S3 Fleet/inspection without adding create/configure controls.

## Exit criteria

- Operators can see why an agent is not ready without reading logs.
- S3 remains observe/inspect/approve only; S4 does not become a definition editor.
