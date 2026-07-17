> **Status: superseded AgentHost-era work order.** Decision 25 and PR #794
> retired this AgentHost/controller/revision/publication/CAS topology. Do not
> dispatch this work or restore removed assets. Retained as history only.

# TODO-D2 - Shared-deployment subdomain tenancy

Coordinator: never assign this whole file. Dispatch one bead/PR with this
file's context, dependencies, and non-negotiables included in the assignment.

## Context (read first)

- Plan: [`PLAN.md`](./PLAN.md)
- Ordering: [`../../INDEX.md`](../../INDEX.md) Phase D2.
- Deployment architecture: [`../../architecture/10-sandbox-deployment-eu.md`](../../architecture/10-sandbox-deployment-eu.md)
- Definitions: [`../P6-plugin-child-app/TODO.md`](../P6-plugin-child-app/TODO.md) BBP6-009
- Headless core / tenancy context: [`../P1-headless-core/TODO.md`](../P1-headless-core/TODO.md)
- Provisioning/secrets: [`../P5-provisioning-secrets/TODO.md`](../P5-provisioning-secrets/TODO.md)
- Registry/info: [`../P7-multi-agent-inspection/TODO.md`](../P7-multi-agent-inspection/TODO.md)
- Durable stores: [`../T1-durable-events/TODO.md`](../T1-durable-events/TODO.md)
- MCP/demo exposure: [`../M2-mcp-agent-surface/TODO.md`](../M2-mcp-agent-surface/TODO.md)
- Dedicated delivery maturity: [`../D1-tenant-provisioning/TODO.md`](../D1-tenant-provisioning/TODO.md)

## Prerequisites - stop if false

- D1's exact-host site journey is complete. Do not treat its one-host/one-
  workspace binding as evidence that wildcard shared-host tenant routing is
  safe.
- D1 has completed on at least two distinct tenant targets using the same
  contract with zero new platform-source edits/contract forks on the second;
  evidence records apply time, operational gaps, and rollback. The owner has
  given written GO for shared-tenancy risk. Without both repetition and GO,
  STOP; do not dispatch BBD2-001.
- A trusted adapter-created `TenantContext` prototype/proof rejects unknown and
  foreign hosts/principals before any workspace lookup. Caller `SessionCtx` is
  not accepted as authority.
- P6-D inputs and stateless P6-R exist. P7's one registry of P6-R outputs and
  D2's own post-v1 `SharedTenantAgentDeclaration` validator exist; E1 attachment
  contracts exist. P6 supplies no workspace declaration, environment pool, or
  resolved registry.
- P1 supports optional `workspaceId` in `SessionCtx` and `sessionStorageRoot`.
- P5 provisioning/readiness/secret-brokering seams exist.
- P7 `agentId` routing and `/info` exist.
- T1 durable stores use authenticated server-only structured `SessionKey` and
  have cross-context/duplicate-public-id leakage tests.
- M2 `public-demo`, `demoPolicy`, and `exposureId` exist.
- Wildcard DNS/TLS is available in the chosen shared EU host profile or is
  represented by a fake provider in tests.

## Goal / exit criteria

From one running shared EU deployment, an agent-authored tenant YAML
(`SharedTenantAgentDeclaration` + attachment refs + seed refs) is validated
(dry-run, unknown refs fail closed) and hot-registered so
`company_a.senecapp.ai` - its own skills/files/context/attachments - is reachable
by subdomain in seconds with no redeploy. A cross-tenant isolation conformance
suite proves tenant A never sees tenant B's sessions, files, pending-inputs,
search, artifacts, or governance. Unknown subdomain fails closed and never
defaults to a tenant. Suspend/archive/delete work. No broker secret crosses a
tenant boundary.

## Non-negotiables

- Unknown subdomain returns a stable rejection; it never falls back to a default
  tenant or workspace.
- `Host` and `x-boring-workspace-id` are caller-controlled routing inputs, not
  tenant authority. Only the authenticated host adapter may create
  `TenantContext { tenantId, workspaceId, principal }` after validating both
  binding and principal policy.
- Tenant YAML is requirements/config only. It never carries executable code or
  raw secrets.
- D2 owns one post-v1 `SharedTenantAgentDeclaration`; D1 keeps its minimal
  dedicated-site input. Do not place either declaration in P6.
- P7 owns the single agent registry of stateless P6-R outputs.
  `LiveTenantRegistry` is D2-owned process-level tenant binding state.
- Path validation remains in adapters. Tenant roots and session roots must not
  collide.
- S4 is read-only status. BBD2-006 is the only D2 authoring surface.
- D2 is independent of the #376 child-app hostname resolver.

## Beads

### BBD2-001 - Authenticated host→tenant router (L)

- **Files touch/create:** authenticated host routing adapter, canonical wildcard
  host parser, `TenantContext` and `HostTenantResolver`, tests for routing,
  authentication, authorization, and rejection.
- **Notes:** Define
  `HostTenantResolver.resolve(requestHost, authenticatedPrincipal): TenantContext | { rejected }`.
  Canonicalize host/port and IDNA form, find a live host binding, authenticate
  the principal, then verify the principal may enter that tenant before
  returning `{ tenantId, workspaceId, principal }`. A raw Host header or
  `x-boring-workspace-id` never creates authority. Mirror P7's absent-id rule:
  absent/unknown id is a stable rejection, never a default mapping.
- **Tests:** known host plus authorized principal resolves; the same host plus a
  foreign/anonymous principal rejects; unknown, malformed, spoofed-forwarded,
  or foreign host rejects; a caller-supplied workspace header cannot override
  the host binding.
- **Acceptance:** only a trusted authenticated adapter creates tenant context;
  routing data alone grants nothing.

### BBD2-002 - Live tenant registry + hot registration (L)

- **Files touch/create:** `LiveTenantRegistry`, `TenantSpec` validation entry,
  runtime binding installation path, registry lifecycle tests.
- **Notes:** `register(spec)` validates D2's `SharedTenantAgentDeclaration`,
  resolves each deployment through stateless P6-R, seeds `sessionStorageRoot` +
  workspace roots + files/skills/context and E1 attachment refs, resolves
  `runtimeProfileRef` or the provider-default
  image, runs the provider-image-support check, materializes secret refs through
  P5 broker, installs a runtime binding, and registers the resolved entries in
  the single P7-owned agent registry for the new `workspaceId`.
  Registration is idempotent and does not require redeploy.
- **Tests:** valid tenant spec installs one binding; rerun is idempotent;
  duplicate host/workspace conflicts fail closed; unknown declaration refs and
  unsupported/unknown runtime-image support fail closed before binding; no raw
  secret appears in registry snapshots/logs.
- **Acceptance:** a running process can add a tenant binding safely without
  restart or redeploy.

### BBD2-003 - Hot per-tenant provisioning/seeding (M/L)

- **Files touch/create:** P5 provisioning entry or adapter mode for in-process
  new-tenant seeding, seed-ref resolver, tests.
- **Notes:** Extend `provisionWorkspaceRuntime()` with a hot new-tenant mode
  that seeds a tenant's attachment refs, skills, templates, plugins, and
  context into the running app. **Amendment (2026-07-08):** hot registration
  resolves and installs the declared agents' plugin refs as part of seeding,
  with unknown refs and unsatisfied plugin requirements failing closed. Do not
  create a second provisioning engine.
- **Tests:** new tenant roots/skills/plugins/context are created while the app
  is running; missing seed ref or plugin ref fails closed; rerun applies a safe
  delta; no raw broker secret enters tenant files or sandbox env.
- **Acceptance:** D2 can provision a new tenant inside the running shared
  deployment.

### BBD2-004 - Shared-infra tenant isolation model + conformance (M/L)

- **Files touch/create:** `TenantIsolationConformance` suite, fixtures for two
  live subdomain tenants in one process, tenant-keyed search/events/artifact/
  governance checks.
- **Notes:** Prove A-never-sees-B across sessions, `boring_pending_requests`,
  session search (`agent.db`), event store, artifacts, and governance, all keyed
  on a structured session key derived from trusted `TenantContext`. Include per-tenant governance via
  `governancePolicyRef` and noisy-neighbor caps.
- **Tests:** two tenants cannot cross-read sessions, files, pending inputs,
  search, artifacts, or governance; unknown subdomain fails closed; no broker
  secret crosses tenant boundary canary passes.
- **Acceptance:** shared infra tenancy has conformance proof, not only routing
  code.

### BBD2-005 - Tenant lifecycle + per-tenant demo gate (M)

- **Files touch/create:** lifecycle API/tooling for create/seed/suspend/archive/
  delete, per-tenant demo gate resolver, tests.
- **Notes:** Tenant lifecycle is at the subdomain level. Wire M2
  `demoPolicy`/`exposureId` as the per-tenant subdomain trial gate.
- **Tests:** suspended tenant rejects traffic; archived tenant is read-only or
  unavailable per policy; delete removes active binding safely; public-demo
  obeys tenant-level demo policy and never widens data scope.
- **Acceptance:** tenant lifecycle and trial/demo exposure are policy-bound.

### BBD2-006 - Outreach-agent authoring tool (M)

- **Files touch/create:** boring `AgentTool` definitions for `plan_tenant`,
  `register_tenant`, and `tenant_status`; dry-run/apply/status tests.
- **Notes:** The tool validates and hot-registers tenant YAML. `plan_tenant`
  performs dry-run only. `register_tenant` applies only after validation.
  `tenant_status` reports readiness without raw secrets. This is the only D2
  authoring surface; S4 stays read-only.
- **Tests:** dry-run has no side effects; apply registers a tenant; invalid
  YAML/unknown refs fail closed; status reports host, lifecycle, demo gate, and
  isolation-conformance state.
- **Acceptance:** an outreach agent can plan and register a shared-tier tenant
  without a redeploy.

### BBD2-007 - Tier reconciliation + smoke (S/M)

- **Files touch/create:** tier-dispatch resolver, fake-provider smoke,
  reconciliation tests/docs.
- **Notes:** One tenant spec chooses `tier: 'shared' | 'dedicated'`. Shared
  dispatches to the D2 hot path. Dedicated dispatches to the D1 manifest path.
- **Tests:** shared spec uses D2 registration; dedicated spec uses D1 manifest
  generation; fake-provider end-to-end smoke covers both paths.
- **Acceptance:** the two-tier model is one spec surface with two deployment
  paths.

## Key interfaces

- `HostTenantResolver.resolve(requestHost, authenticatedPrincipal): TenantContext | { rejected }`
- `TenantContext { tenantId, workspaceId, principal }`
- `LiveTenantRegistry {register/get/list/suspend/archive/delete}`
- `SharedTenantAgentDeclaration { defaultAgentId, deploymentRefs }` (D2-owned)
- `TenantSpec {workspaceId,host,tier,agents:SharedTenantAgentDeclaration,attachmentRefs,seedRefs,secretRefs,demo?}`
- `TenantIsolationConformance` suite

## Verification

Commands depend on the implementation package; re-verify in the PR. Minimum:

```bash
pnpm typecheck
pnpm test
pnpm audit:imports
```

Run affected host/package build/typecheck/test, plus the D2 fake-provider smoke
and `TenantIsolationConformance` suite added by this package.

## PR-PLAN reconciliation

- `pr1-host-tenant-router` -> BBD2-001.
- `pr2-live-tenant-registry` -> BBD2-002.
- `pr3-hot-tenant-seeding` -> BBD2-003.
- `pr4-isolation-conformance` -> BBD2-004.
- `pr5-lifecycle-demo-gate` -> BBD2-005.
- `pr6-authoring-tool` -> BBD2-006.
- `pr7-tier-reconciliation-smoke` -> BBD2-007.

## Review gates

- Unknown host/subdomain and unauthorized principal fail closed; caller routing
  fields cannot create or override `TenantContext`.
- No second agent-definition schema.
- No raw secrets in tenant YAML, logs, registry snapshots, provisioning output,
  files, transcripts, artifacts, or sandbox env.
- D2 owns only its declaration and process-level tenant registry; P7 owns the
  one agent registry and P6-R remains stateless.
- Cross-tenant isolation conformance is green for two live tenants in one
  process.
- S4 remains read-only; D2 authoring lives only in BBD2-006.
