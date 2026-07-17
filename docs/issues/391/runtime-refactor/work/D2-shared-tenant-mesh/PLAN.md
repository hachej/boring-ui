> **#391 status (2026-07-17): historical reference / non-dispatchable.**
>
> Active authority: `docs/issues/391/plan.md` and Decision 25 in
> `docs/DECISIONS.md`. Where this file conflicts, the active authority wins.

# D2-shared-tenant-mesh — Plan

Status: post-v1; not a #391 v1 exit gate. Start only after repeated D1 delivery
and a trusted adapter-created tenant authority are proven.

> Phase: Phase D2 - shared-deployment subdomain tenancy · Work order: [TODO.md](./TODO.md) · Handoff: [HANDOFF.md](./HANDOFF.md)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md) · PR plan: [PR-PLAN.md](../../PR-PLAN.md)

## Governing architecture

- [10-sandbox-deployment-eu.md](../../architecture/10-sandbox-deployment-eu.md) - EU host topologies: self-host, D1 dedicated/sovereign tenants, and D2 shared subdomain tenants.
- [P6-plugin-child-app](../P6-plugin-child-app/TODO.md) - minimal P6-D contracts
  plus stateless P6-R resolved values; P7/D2 own later registry/declaration work.
- [P1-headless-core](../P1-headless-core/TODO.md) - optional `workspaceId` in `SessionCtx` and `sessionStorageRoot`.
- [P5-provisioning-secrets](../P5-provisioning-secrets/TODO.md) - provisioning/readiness/secret brokering.
- [P7-multi-agent-inspection](../P7-multi-agent-inspection/TODO.md) - `agentId` routing and `/info`.
- [T1-durable-events](../T1-durable-events/TODO.md) - per-`SessionCtx` durable stores and cross-context leakage tests.
- [M2-mcp-agent-surface](../M2-mcp-agent-surface/TODO.md) - `public-demo`, `demoPolicy`, and `exposureId`.

## Design context

**Amendment (2026-07-08):** D2 is the Shared Subdomain tier of the two-tier
tenancy model. D1 is the Sovereign / EU Tenant Factory tier: one dedicated
deployment per company. D2 is the shared tier: one shared EU deployment serves
many subdomain tenants. Both tiers consume the same definition/deployment
contracts; only post-v1 P7/D2 may add a multi-agent/tenant declaration. D1 now
proves an exact dedicated hostname plus landing/auth/workspace/default-
agent journey, but it still has no wildcard application router or live
multi-tenant registry; those remain D2's distinct security boundary.

D2 is a sidecar factory-lane work package, sibling to D1, and independent of the
#376 child-app hostname resolver. It turns an agent-authored tenant YAML into a
live `company.senecapp.ai` tenant in the running shared deployment without
redeploying the app. Unknown refs and unknown hosts fail closed.

## Dependencies

D2 depends on P6-D inputs plus stateless P6-R, P1 (optional `workspaceId` in
`SessionCtx` + `sessionStorageRoot`), P5 (provisioning/readiness/secret
brokering), P7 (`agentId` routing, `/info`, and the one P7-owned registry of
P6-R outputs), E1 attachment contracts, T1 (per-`SessionCtx` durable stores +
cross-context leakage test), and M2 (`public-demo`, `demoPolicy`,
`exposureId`). It is independent of #376 child-app hostname resolver.
D2 owns its post-v1 `SharedTenantAgentDeclaration` and process-level
`LiveTenantRegistry`; neither contract comes from P6.

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
(`SharedTenantAgentDeclaration` + attachment refs + seed refs) is validated
(dry-run, unknown refs fail closed) and hot-registered so
`company_a.senecapp.ai` - its own skills/files/context/attachments - is reachable
by subdomain in seconds with no redeploy; a cross-tenant isolation conformance
suite proves tenant A never sees tenant B's sessions, files, pending-inputs,
search, artifacts, or governance; unknown subdomain fails closed and never
defaults to a tenant; suspend/archive/delete work; no broker secret crosses a
tenant boundary.

## Beads

### BBD2-001 - Authenticated host→tenant router (L)

Wildcard DNS + wildcard TLS plus an adapter that canonicalizes the request host,
authenticates the principal, verifies host-to-tenant binding and principal
policy, then creates `TenantContext`. `Host` is routing input, not authority.
Unknown/malformed/foreign hosts and unauthorized principals fail closed; no
default tenant and no raw `x-boring-workspace-id` authority.

### BBD2-002 - Live tenant registry + hot registration (L)

A process-level D2-owned `LiveTenantRegistry` over the RuntimeBinding LRU:
`register(spec)` validates D2's `SharedTenantAgentDeclaration`, resolves each
declared deployment through stateless P6-R, seeds session/workspace roots plus
files/skills/context and E1 attachment refs, materializes secret refs through
P5, installs the tenant binding, and registers the resolved entries in the
single P7-owned agent registry for the new `workspaceId`. Idempotent, no
redeploy; P6 owns no declaration or resolved registry.

### BBD2-003 - Hot per-tenant provisioning/seeding (M/L)

Extend P5 `provisionWorkspaceRuntime()` with an in-process, new-tenant mode that
seeds a tenant's attachment refs + skills + template/context into the running app
(today P5 seeds only existing workspaces at startup).

### BBD2-004 - Shared-infra tenant isolation model + conformance (M/L)

Fail-closed A-never-sees-B across sessions, `boring_pending_requests`, session
search (`agent.db`), event store, artifacts, governance - all keyed from trusted
`TenantContext` into structured session scope; per-tenant governance via `governancePolicyRef`;
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

- `HostTenantResolver.resolve(requestHost, authenticatedPrincipal): TenantContext | { rejected }`
- `TenantContext { tenantId, workspaceId, principal }`
- `LiveTenantRegistry {register/get/list/suspend/archive/delete}`
- `SharedTenantAgentDeclaration { defaultAgentId, deploymentRefs }` (D2-owned)
- `TenantSpec {workspaceId,host,tier,agents:SharedTenantAgentDeclaration,attachmentRefs,seedRefs,secretRefs,demo?}`
- `TenantIsolationConformance` suite
