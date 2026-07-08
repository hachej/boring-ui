# S4-agent-onboarding - Plan

> Phase: Phase S4 - agent onboarding status · Work order: [TODO.md](./TODO.md) · Handoff: [HANDOFF.md](./HANDOFF.md)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md) · PR plan: [PR-PLAN.md](../../PR-PLAN.md)

## Governing architecture

- [S3-control-plane-ux](../S3-control-plane-ux/TODO.md) - observe/inspect/approve control-plane UX that S4 extends, not rewrites.
- [P6-plugin-child-app](../P6-plugin-child-app/TODO.md) - `AgentDefinitionDeclaration`.
- [M2-mcp-agent-surface](../M2-mcp-agent-surface/TODO.md) - demo endpoint status.
- [D1-tenant-provisioning](../D1-tenant-provisioning/TODO.md) - provisioning status.

## Design context

S4 is not an authoring UI. It is an onboarding/readiness status view layered on
top of S3's control-plane surfaces. It answers whether a declared agent is ready
to demo or provision: definition readiness, demo URL status, provisioning status,
and missing policy refs.

## Deliverables

- Read-only onboarding status for each declared agent.
- Definition readiness: missing/unknown instruction/persona/capability/
  environment/sandbox/governance/model/demo/pricing/exposure refs.
- Demo URL status from M2 exposure config.
- Provisioning status from D1.
- Links back to S3 Fleet/inspection without adding create/configure controls.

## Exit criteria

- Operators can see why an agent is not ready without reading logs.
- S3 remains observe/inspect/approve only; S4 does not become a definition editor.
