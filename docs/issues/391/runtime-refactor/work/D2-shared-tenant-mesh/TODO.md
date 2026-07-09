# TODO-D2 - Shared-deployment subdomain tenancy

Handoff: self-contained work order for one autonomous coding agent. Cite plan
files by relative path. No prior conversation assumed.

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

## Prerequisites - stop if false

- P6a/BBP6-009 `WorkspaceAgentsDeclaration`, environment pool, validator, and
  project-scoped `AgentRegistry` exist.
- P1 supports optional `workspaceId` in `SessionCtx` and `sessionStorageRoot`.
- P5 provisioning/readiness/secret-brokering seams exist.
- P7 `agentId` routing and `/info` exist.
- T1 durable stores are keyed by `SessionCtx` and have cross-context leakage
  tests.
- M2 `public-demo`, `demoPolicy`, and `exposureId` exist.
- Wildcard DNS/TLS is available in the chosen shared EU host profile or is
  represented by a fake provider in tests.

## Goal / exit criteria

From one running shared EU deployment, an agent-authored tenant YAML
(`WorkspaceAgentsDeclaration` + environment pool + seed refs) is validated
(dry-run, unknown refs fail closed) and hot-registered so
`company_a.senecapp.ai` - its own skills/files/context/env-pool - is reachable
by subdomain in seconds with no redeploy. A cross-tenant isolation conformance
suite proves tenant A never sees tenant B's sessions, files, pending-inputs,
search, artifacts, or governance. Unknown subdomain fails closed and never
defaults to a tenant. Suspend/archive/delete work. No broker secret crosses a
tenant boundary.

## Non-negotiables

- Unknown subdomain returns a stable rejection; it never falls back to a default
  tenant or workspace.
- Tenant YAML is requirements/config only. It never carries executable code or
  raw secrets.
- One `WorkspaceAgentsDeclaration` definition model feeds D1 and D2; do not
  fork a shared-tier schema.
- `AgentRegistry` remains project-scoped. `LiveTenantRegistry` is
  process-level tenant binding state.
- Path validation remains in adapters. Tenant roots and session roots must not
  collide.
- S4 is read-only status. BBD2-006 is the only D2 authoring surface.
- D2 is independent of the #376 child-app hostname resolver.

## Beads

### BBD2-001 - Host→tenant router (L)

- **Files touch/create:** host routing adapter, wildcard host parser,
  `HostTenantResolver`, tests for Host header resolution and rejection.
- **Notes:** Seat the resolver beside the existing `x-boring-workspace-id`
  adapter. Resolve `Host:` to `workspaceId` only when a live tenant binding
  exists. Mirror P7's absent-id rule: absent/unknown id is a 404-style stable
  rejection, never a default mapping.
- **Tests:** known `company_a.senecapp.ai` resolves to its tenant `SessionCtx`;
  unknown subdomain rejects; malformed/foreign host rejects; explicit
  `x-boring-workspace-id` behavior remains unchanged where still supported.
- **Acceptance:** wildcard subdomain routing is fail-closed and does not widen
  existing workspace-id adapter authority.

### BBD2-002 - Live tenant registry + hot registration (L)

- **Files touch/create:** `LiveTenantRegistry`, `TenantSpec` validation entry,
  runtime binding installation path, registry lifecycle tests.
- **Notes:** `register(spec)` validates the `WorkspaceAgentsDeclaration`
  through BBP6-009, seeds `sessionStorageRoot` + workspace/env-pool roots +
  files/skills/context, resolves `runtimeProfileRef` or the provider-default
  image, runs the provider-image-support check, materializes secret refs through
  P5 broker, and installs a runtime binding plus `AgentRegistry` instance for
  the new `workspaceId`.
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
  that seeds a tenant's environment pool, skills, templates, plugins, and
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
  session search (`state.db`), event store, artifacts, and governance, all keyed
  on `SessionCtx.workspaceId`. Include per-tenant governance via
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

- `HostTenantResolver(host)->SessionCtx|{rejected}`
- `LiveTenantRegistry {register/get/list/suspend/archive/delete}`
- `TenantSpec {workspaceId,host,tier,declaration:WorkspaceAgentsDeclaration,environments,seedRefs,secretRefs,demo?}`
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

- Unknown host/subdomain fails closed.
- No second agent-definition schema.
- No raw secrets in tenant YAML, logs, registry snapshots, provisioning output,
  files, transcripts, artifacts, or sandbox env.
- D2 adds process-level tenant registry only; project-scoped `AgentRegistry`
  remains project-scoped.
- Cross-tenant isolation conformance is green for two live tenants in one
  process.
- S4 remains read-only; D2 authoring lives only in BBD2-006.
