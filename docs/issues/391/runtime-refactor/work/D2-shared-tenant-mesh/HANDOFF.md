> **Status: superseded AgentHost-era work order.** Decision 25 and PR #794
> retired this AgentHost/controller/revision/publication/CAS topology. Do not
> dispatch this work or restore removed assets. Retained as history only.

# D2-shared-tenant-mesh - Handoff checklist

Derived strictly from [TODO.md](./TODO.md) and [PLAN.md](./PLAN.md). Tick each
before calling D2 done. Invent nothing.

## Prerequisites

- [ ] D1 evidence covers two distinct tenants on one unchanged delivery
      contract, with the second requiring zero source/contract fork; owner has
      given written GO for shared tenancy. Otherwise STOP before BBD2-001.
- [ ] Trusted adapter-created `TenantContext` proof rejects unknown/foreign host
      and principal before workspace lookup; caller `SessionCtx` grants nothing.
- [ ] P6-D inputs and stateless P6-R merged; P7's one registry of P6-R outputs,
      D2's own `SharedTenantAgentDeclaration` validator, and E1 attachment
      contracts merged. P6 supplies no declaration, environment pool, or
      resolved registry.
- [ ] P1 optional `workspaceId` in `SessionCtx` and `sessionStorageRoot` merged.
- [ ] P5 provisioning/readiness/secret-brokering seams merged.
- [ ] P7 `agentId` routing and `/info` merged.
- [ ] T1 durable stores use authenticated structured `SessionKey`; cross-context
      and duplicate-public-id leakage tests exist.
- [ ] M2 `public-demo`, `demoPolicy`, and `exposureId` merged.
- [ ] Wildcard DNS/TLS available in the chosen shared EU host profile or represented by a fake provider in tests.

## Beads

- [ ] BBD2-001 - Authenticated host→tenant router.
- [ ] BBD2-002 - Live tenant registry + hot registration.
- [ ] BBD2-003 - Hot per-tenant provisioning/seeding.
- [ ] BBD2-004 - Shared-infra tenant isolation model + conformance.
- [ ] BBD2-005 - Tenant lifecycle + per-tenant demo gate.
- [ ] BBD2-006 - Outreach-agent authoring tool.
- [ ] BBD2-007 - Tier reconciliation + smoke.

## Key interfaces

- [ ] `HostTenantResolver.resolve(requestHost, authenticatedPrincipal): TenantContext | { rejected }` exists.
- [ ] `TenantContext { tenantId, workspaceId, principal }` is adapter-created only.
- [ ] `LiveTenantRegistry {register/get/list/suspend/archive/delete}` exists.
- [ ] D2-owned `SharedTenantAgentDeclaration {defaultAgentId,deploymentRefs}` exists.
- [ ] `TenantSpec {workspaceId,host,tier,agents:SharedTenantAgentDeclaration,attachmentRefs,seedRefs,secretRefs,demo?}` exists.
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

- [ ] Unknown host/subdomain and unauthorized principal fail closed; Host and
      workspace headers alone grant nothing.
- [ ] No second agent-definition schema.
- [ ] No raw secrets in tenant YAML, logs, registry snapshots, provisioning output, files, transcripts, artifacts, or sandbox env.
- [ ] D2 owns its declaration and process-level tenant registry; P7 owns the one
      agent registry of stateless P6-R outputs, and P6 owns neither.
- [ ] Cross-tenant isolation conformance is green for two live tenants in one process.
- [ ] S4 remains read-only; D2 authoring lives only in BBD2-006.

## Exit criteria

- [ ] Agent-authored tenant YAML validates with unknown refs failing closed.
- [ ] `company_a.senecapp.ai` is hot-registered and reachable by subdomain in seconds with no redeploy.
- [ ] Tenant A cannot see tenant B's sessions, files, pending-inputs, search, artifacts, or governance.
- [ ] Unknown subdomain fails closed and never defaults to a tenant.
- [ ] Cross-tenant stores/caches use structured keys derived from trusted
      `TenantContext`, not raw caller headers.
- [ ] Suspend/archive/delete work.
- [ ] No broker secret crosses a tenant boundary.

## Closeout

- [ ] Zero unowned `TODO(remove:*)` markers for this package.
- [ ] PRs merged per [PR-PLAN.md](../../PR-PLAN.md).
