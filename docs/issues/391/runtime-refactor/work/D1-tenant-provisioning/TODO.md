# TODO-D1 - Tenant provisioning command/API

Handoff: self-contained work order for one autonomous coding agent. Cite plan
files by relative path. No prior conversation assumed.

## Context (read first)

- Plan: [`PLAN.md`](./PLAN.md)
- Ordering: [`../../INDEX.md`](../../INDEX.md) Phase D1.
- Deployment architecture: [`../../architecture/10-sandbox-deployment-eu.md`](../../architecture/10-sandbox-deployment-eu.md)
- Provisioning/secrets: [`../P5-provisioning-secrets/TODO.md`](../P5-provisioning-secrets/TODO.md)
- Definitions: [`../P6-plugin-child-app/TODO.md`](../P6-plugin-child-app/TODO.md) BBP6-009
- MCP/demo exposure: [`../M2-mcp-agent-surface/TODO.md`](../M2-mcp-agent-surface/TODO.md)

## Prerequisites - stop if false

- P5 provisioning/secrets seams exist.
- P6a `AgentDefinitionDeclaration` exists.
- M2 exposure config exists; demo endpoint config is part of D1 exit, not optional.
- The chosen EU host profile is one of the architecture 10 supported tiers or is explicitly owner-approved.

## Goal / exit criteria

One command/API creates the tenant/workspace, runtime config, DB/storage/session
roots, secrets, demo endpoint config, and deployment manifest for the chosen EU
host. Without this, T0/T1 factory claims remain manual-infra claims.

## Non-negotiables

- No raw secrets in logs, manifests, comments, or generated docs.
- No US-hosted service as default or hard dependency.
- Session roots follow `BORING_AGENT_SESSION_ROOT` / durable host-volume rules;
  they are not inside container home/root by default.
- LP/GTM/pricing/CTA generation is out of scope and belongs to
  `boring-ui-factory`.
- Provisioning is idempotent: re-running reports existing resources or applies a
  safe delta, never silently creates a second tenant.

## Beads

### BBD1-001 - Provisioning plan schema + CLI/API entry (M)

- **Files touch/create:** command/API entry point, plan schema, dry-run output,
  stable error codes.
- **Notes:** Plan input references tenant id/name, workspace seed, agent
  definition id, EU host profile, runtime tier, `runtimeProfileRef`-derived
  selected image, storage/session root policy, secrets refs, and optional demo
  exposure id.
- **Tests:** dry-run emits deterministic plan; unknown definition/host/secret ref
  fails closed; no apply side effects in dry-run.
- **Acceptance:** operators can review a complete plan before apply.

### BBD1-002 - Tenant/workspace + DB/storage/session roots (M)

- **Files touch/create:** provisioning adapters for tenant/workspace records and
  root allocation.
- **Notes:** Session history root is a host durable volume sibling to workspace
  roots by default (`/data/pi-sessions` beside `/data/workspaces` when applicable).
- **Tests:** creates tenant + workspace once; rerun is idempotent; roots are
  outside container home/root; cross-tenant roots cannot collide.
- **Acceptance:** tenant/workspace and root layout are repeatable and inspectable.

### BBD1-003 - Secrets and runtime config materialization (M)

- **Files touch/create:** secret-ref resolver, runtime config writer, redacted
  manifest projection.
- **Notes:** Consume P5 brokering. Store secret refs/handles, never raw secret
  values. Runtime config records provider facts and selected image/tier; the
  image is derived from `AgentDefinitionDeclaration.runtimeProfileRef` when
  present, else the validated provider-default image, while tier stays the
  host/EU deployment choice.
- **Tests:** raw secret canary absent from logs/manifests; missing secret ref
  fails closed; runtime config includes the selected runtime image plus EU
  host/tier facts.
- **Acceptance:** deployed runtime can start without leaking secrets.

### BBD1-004 - Demo endpoint config + deployment manifest (L)

- **Files touch/create:** M2 exposure config writer and deployment manifest
  generator for the chosen EU host.
- **Notes:** Demo endpoint config includes `exposureId`, auth mode, demo policy,
  result/share URL base, CORS/embedding rules, and telemetry hooks. The
  deployment manifest captures the resolved image digest, host tier, storage
  roots, network policy, and service commands.
- **Tests:** public-demo and bearer endpoint configs generated from definitions;
  manifest contains no raw secrets; unsupported image/host/tier combinations
  reject.
- **Acceptance:** operator receives a deployable, reviewable manifest.

### BBD1-005 - Apply smoke + rollback notes (M)

- **Files touch/create:** smoke script or integration test, rollback/runbook docs.
- **Notes:** Smoke validates tenant reachable, workspace exists, runtime config
  loads, demo endpoint config resolves, and telemetry emits non-secret status.
- **Tests:** local/fake-provider apply smoke; rollback docs link every created
  resource category.
- **Acceptance:** one-command provisioning has proof, not only generated files.

## Verification

Commands depend on the implementation package; re-verify in the PR. Minimum:

```bash
pnpm typecheck
pnpm test
pnpm audit:imports
```

Run affected package build/typecheck/test plus any provisioning smoke added by
the PR.

## PR-PLAN reconciliation

- `pr1-plan-command-api` -> BBD1-001.
- `pr2-tenant-roots` -> BBD1-002.
- `pr3-secrets-runtime-config` -> BBD1-003.
- `pr4-demo-manifest` -> BBD1-004.
- `pr5-apply-smoke-runbook` -> BBD1-005.

## Review gates

- One command/API path covers tenant, workspace, runtime config, roots, secrets,
  demo endpoint config, and deployment manifest.
- No raw secrets in outputs.
- EU host/tier selection follows architecture 10.
- Idempotency and dry-run behavior tested.
- Factory-owned LP/GTM/pricing/CTA content is not built here.
