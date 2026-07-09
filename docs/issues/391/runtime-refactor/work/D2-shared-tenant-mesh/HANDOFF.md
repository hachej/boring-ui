# D2-shared-tenant-mesh - Handoff checklist

Derived strictly from [TODO.md](./TODO.md) and [PLAN.md](./PLAN.md). Tick each
before calling D2 done. Invent nothing.

## Prerequisites

- [ ] P6a/BBP6-009 `WorkspaceAgentsDeclaration`, environment pool, validator, and project-scoped `AgentRegistry` merged.
- [ ] P1 optional `workspaceId` in `SessionCtx` and `sessionStorageRoot` merged.
- [ ] P5 provisioning/readiness/secret-brokering seams merged.
- [ ] P7 `agentId` routing and `/info` merged.
- [ ] T1 durable stores are keyed by `SessionCtx` and cross-context leakage tests exist.
- [ ] M2 `public-demo`, `demoPolicy`, and `exposureId` merged.
- [ ] Wildcard DNS/TLS available in the chosen shared EU host profile or represented by a fake provider in tests.

## Beads

- [ ] BBD2-001 - Host→tenant router.
- [ ] BBD2-002 - Live tenant registry + hot registration.
- [ ] BBD2-003 - Hot per-tenant provisioning/seeding.
- [ ] BBD2-004 - Shared-infra tenant isolation model + conformance.
- [ ] BBD2-005 - Tenant lifecycle + per-tenant demo gate.
- [ ] BBD2-006 - Outreach-agent authoring tool.
- [ ] BBD2-007 - Tier reconciliation + smoke.

## Key interfaces

- [ ] `HostTenantResolver(host)->SessionCtx|{rejected}` exists.
- [ ] `LiveTenantRegistry {register/get/list/suspend/archive/delete}` exists.
- [ ] `TenantSpec {workspaceId,host,tier,declaration:WorkspaceAgentsDeclaration,environments,seedRefs,secretRefs,demo?}` exists.
- [ ] `TenantIsolationConformance` suite exists.

## Verification commands

- [ ] Affected package build/typecheck/test commands.
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm audit:imports`
- [ ] D2 fake-provider smoke.
- [ ] `TenantIsolationConformance` suite.

## PR-PLAN reconciliation

- [ ] `pr1-host-tenant-router` completed BBD2-001.
- [ ] `pr2-live-tenant-registry` completed BBD2-002.
- [ ] `pr3-hot-tenant-seeding` completed BBD2-003.
- [ ] `pr4-isolation-conformance` completed BBD2-004.
- [ ] `pr5-lifecycle-demo-gate` completed BBD2-005.
- [ ] `pr6-authoring-tool` completed BBD2-006.
- [ ] `pr7-tier-reconciliation-smoke` completed BBD2-007.

## Review gates

- [ ] Unknown host/subdomain fails closed.
- [ ] No second agent-definition schema.
- [ ] No raw secrets in tenant YAML, logs, registry snapshots, provisioning output, files, transcripts, artifacts, or sandbox env.
- [ ] D2 adds process-level tenant registry only; project-scoped `AgentRegistry` remains project-scoped.
- [ ] Cross-tenant isolation conformance is green for two live tenants in one process.
- [ ] S4 remains read-only; D2 authoring lives only in BBD2-006.

## Exit criteria

- [ ] Agent-authored tenant YAML validates with unknown refs failing closed.
- [ ] `company_a.senecapp.ai` is hot-registered and reachable by subdomain in seconds with no redeploy.
- [ ] Tenant A cannot see tenant B's sessions, files, pending-inputs, search, artifacts, or governance.
- [ ] Unknown subdomain fails closed and never defaults to a tenant.
- [ ] Suspend/archive/delete work.
- [ ] No broker secret crosses a tenant boundary.

## Closeout

- [ ] Zero unowned `TODO(remove:*)` markers for this package.
- [ ] PRs merged per [PR-PLAN.md](../../PR-PLAN.md).
