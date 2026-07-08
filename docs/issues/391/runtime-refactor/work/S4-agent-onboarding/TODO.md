# TODO-S4 - Agent onboarding status

Handoff: self-contained work order for one autonomous coding agent. Cite plan
files by relative path. No prior conversation assumed.

## Context (read first)

- Plan: [`PLAN.md`](./PLAN.md)
- Ordering: [`../../INDEX.md`](../../INDEX.md) Phase S4.
- S3 control plane: [`../S3-control-plane-ux/TODO.md`](../S3-control-plane-ux/TODO.md)
- Definitions: [`../P6-plugin-child-app/TODO.md`](../P6-plugin-child-app/TODO.md) BBP6-009
- MCP/demo exposure: [`../M2-mcp-agent-surface/TODO.md`](../M2-mcp-agent-surface/TODO.md)
- Tenant provisioning: [`../D1-tenant-provisioning/TODO.md`](../D1-tenant-provisioning/TODO.md)

## Prerequisites - stop if false

- S3 Fleet/inspection page exists.
- `AgentDefinitionDeclaration` validation exists.
- M2 exposes demo endpoint status.
- D1 exposes provisioning status.

## Goal / exit criteria

Add read-only onboarding status so an operator can see definition readiness,
demo URL status, provisioning status, and missing policy refs for each declared
agent. Do not add authoring/configuration controls.

## Non-negotiables

- S4 extends S3; it does not rebuild Fleet, session browsing, transcript viewing,
  or approval inbox.
- No create/edit/delete agent controls.
- Unknown refs are shown as blocking readiness, matching BBP6-009 fail-closed
  semantics.
- No secret values, raw policy docs, model keys, or deployment internals rendered.

## Beads

### BBS4-001 - Readiness data model and status client (M)

- **Files touch/create:** shared/front status types and clients for definition
  validation, M2 demo exposure status, and D1 provisioning status.
- **Notes:** Status is read-only and may be a lossless projection of server
  validation results. Stable codes are required for missing refs.
- **Tests:** missing instruction/persona/capability/environment/sandbox/
  governance/model/demo/pricing/exposure refs render stable blocking codes;
  secret canary absent.
- **Acceptance:** front can fetch one normalized onboarding status per agent.

### BBS4-002 - Onboarding status panel on Fleet drill-down (M)

- **Files touch/create:** S3 Fleet drill-down extension or adjacent panel.
- **Notes:** Show definition readiness, demo URL status, provisioning status,
  and missing policy refs. Link to existing inspect/provisioning/demo docs or
  statuses; do not add edit controls.
- **Tests:** ready, blocked, and partial states render; no create/configure
  buttons exist; keyboard/accessibility follows existing panel patterns.
- **Acceptance:** an operator can diagnose why an agent is not demo-ready.

### BBS4-003 - Demo/provisioning status integration (S/M)

- **Files touch/create:** adapters for M2/D1 status endpoints or projections.
- **Notes:** Demo URL status includes exposure id, auth mode, URL present/missing,
  and policy validity. Provisioning status includes not-started/planning/applying/
  ready/failed plus redacted error codes.
- **Tests:** public-demo missing policy blocks readiness; failed provisioning
  shows redacted code; ready state links to safe demo URL.
- **Acceptance:** demo/provisioning readiness is visible without logs.

### BBS4-004 - Onboarding integration test (S)

- **Files create:** workspace/front integration test in the nearest S3 test
  harness.
- **Notes:** Mock two agents: one ready, one missing policy refs and provisioning.
- **Tests:** Fleet shows both, drill-down status explains blockers, no authoring
  controls appear.
- **Acceptance:** S4's read-only onboarding story is executable.

## Verification

```bash
pnpm --filter @hachej/boring-workspace run typecheck
pnpm --filter @hachej/boring-workspace run test
pnpm --filter @hachej/boring-workspace run lint:plugin-invariants
pnpm audit:imports
pnpm typecheck
```

Add affected package tests if the status endpoints live outside workspace.

## PR-PLAN reconciliation

- `pr1-status-model-client` -> BBS4-001.
- `pr2-onboarding-panel` -> BBS4-002 + BBS4-003.
- `pr3-onboarding-integration` -> BBS4-004.

## Review gates

- S3 remains observe/inspect/approve only.
- No authoring/configuration controls.
- Missing refs fail closed and render as blockers.
- Demo/provisioning status is redacted and stable.
- No new UI framework or registry.
