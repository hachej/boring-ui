# D2-shared-tenant-mesh - Plan

> Phase: Phase D2 - shared-deployment subdomain tenancy · Work order: [TODO.md](./TODO.md) · Handoff: [HANDOFF.md](./HANDOFF.md)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md) · PR plan: [PR-PLAN.md](../../PR-PLAN.md)

## Governing architecture

- [10-sandbox-deployment-eu.md](../../architecture/10-sandbox-deployment-eu.md) - EU host topologies: self-host, D1 dedicated/sovereign tenants, and D2 shared subdomain tenants.
- [P6-plugin-child-app](../P6-plugin-child-app/TODO.md) - BBP6-009 `WorkspaceAgentsDeclaration`, environment pool, and `AgentRegistry`.
- [P1-headless-core](../P1-headless-core/TODO.md) - optional `workspaceId` in `SessionCtx` and `sessionStorageRoot`.
- [P5-provisioning-secrets](../P5-provisioning-secrets/TODO.md) - provisioning/readiness/secret brokering.
- [P7-multi-agent-inspection](../P7-multi-agent-inspection/TODO.md) - `agentId` routing and `/info`.
- [T1-durable-events](../T1-durable-events/TODO.md) - per-`SessionCtx` durable stores and cross-context leakage tests.
- [M2-mcp-agent-surface](../M2-mcp-agent-surface/TODO.md) - `public-demo`, `demoPolicy`, and `exposureId`.

## Design context

**Amendment (2026-07-08):** D2 is the Shared Subdomain tier of the two-tier
tenancy model. D1 is the Sovereign / EU Tenant Factory tier: one dedicated
deployment per company. D2 is the shared tier: one shared EU deployment serves
many subdomain tenants. Both tiers consume the same `WorkspaceAgentsDeclaration`.

D2 is a sidecar factory-lane work package, sibling to D1, and independent of the
#376 child-app hostname resolver. It turns an agent-authored tenant YAML into a
live `company.senecapp.ai` tenant in the running shared deployment without
redeploying the app. Unknown refs and unknown hosts fail closed.

## Dependencies

D2 depends on P6a (BBP6-009 `WorkspaceAgentsDeclaration` + environment pool +
`AgentRegistry`), P1 (optional `workspaceId` in `SessionCtx` +
`sessionStorageRoot`), P5 (provisioning/readiness/secret brokering), P7
(`agentId` routing and `/info`), T1 (per-`SessionCtx` durable stores +
cross-context leakage test), and M2 (`public-demo`, `demoPolicy`,
`exposureId`). It is independent of #376 child-app hostname resolver.

## Deliverables

- Host-header tenant resolution for wildcard subdomains.
- Process-level live tenant registry over runtime bindings.
- Hot in-process provisioning/seeding for a new tenant.
- Shared-infra tenant isolation model and conformance suite.
- Tenant lifecycle operations and per-tenant demo gate.
- Agent authoring tool for dry-run, registration, and tenant status.
- Shared/dedicated tier reconciliation smoke against a fake provider.

## Exit criteria

From one running shared EU deployment, an agent-authored tenant YAML
(`WorkspaceAgentsDeclaration` + environment pool + seed refs) is validated
(dry-run, unknown refs fail closed) and hot-registered so
`company_a.senecapp.ai` - its own skills/files/context/env-pool - is reachable
by subdomain in seconds with no redeploy; a cross-tenant isolation conformance
suite proves tenant A never sees tenant B's sessions, files, pending-inputs,
search, artifacts, or governance; unknown subdomain fails closed and never
defaults to a tenant; suspend/archive/delete work; no broker secret crosses a
tenant boundary.

## Beads

### BBD2-001 - Host→tenant router (L)

Wildcard DNS + wildcard TLS + `Host:`-header->`workspaceId` resolver seated
beside the existing `x-boring-workspace-id` adapter (architecture/08:217);
fail-closed unknown-subdomain, mirroring P7's "absent id = 404, never silently
mapped to default".

### BBD2-002 - Live tenant registry + hot registration (L)

A process-level `LiveTenantRegistry` over the RuntimeBinding LRU:
`register(spec)` validates the `WorkspaceAgentsDeclaration` (BBP6-009 validator,
fail-closed), seeds `sessionStorageRoot` + workspace/env-pool roots +
files/skills/context, materializes secret refs (P5 broker), installs a binding +
`AgentRegistry` instance for the new `workspaceId` - idempotent, no redeploy.
Contrast: BBP6-009's `AgentRegistry` stays project-scoped; this is the
process-level tenant registry.

### BBD2-003 - Hot per-tenant provisioning/seeding (M/L)

Extend P5 `provisionWorkspaceRuntime()` with an in-process, new-tenant mode that
seeds a tenant's env-pool + skills + template/context into the running app
(today P5 seeds only existing workspaces at startup).

### BBD2-004 - Shared-infra tenant isolation model + conformance (M/L)

Fail-closed A-never-sees-B across sessions, `boring_pending_requests`, session
search (`state.db`), event store, artifacts, governance - all keyed on
`SessionCtx.workspaceId`; per-tenant governance via `governancePolicyRef`;
noisy-neighbor caps. Suite stands up two live subdomain tenants in one process,
generalizing T1's cross-context leakage test from the `agentId` axis to the
tenant axis, plus unknown-subdomain-fails-closed and
no-broker-secret-crosses-tenant canary.

### BBD2-005 - Tenant lifecycle + per-tenant demo gate (M)

Create/seed/suspend/archive/delete at the subdomain level; wire M2
`demoPolicy`/`exposureId` as the per-tenant subdomain trial gate.

### BBD2-006 - Outreach-agent authoring tool (M)

A boring `AgentTool` (`plan_tenant` dry-run -> `register_tenant` apply ->
`tenant_status`) letting an agent validate + hot-register a tenant YAML; the
only authoring surface. S4 stays read-only.

### BBD2-007 - Tier reconciliation + smoke (S/M)

One tenant spec chooses `tier: 'shared' | 'dedicated'`; shared -> D2 hot path,
dedicated -> D1 manifest path; end-to-end smoke against a fake provider.

## Key interfaces

- `HostTenantResolver(host)->SessionCtx|{rejected}`
- `LiveTenantRegistry {register/get/list/suspend/archive/delete}`
- `TenantSpec {workspaceId,host,tier,declaration:WorkspaceAgentsDeclaration,environments,seedRefs,secretRefs,demo?}`
- `TenantIsolationConformance` suite
