# D1-tenant-provisioning - Handoff checklist

Derived strictly from [TODO.md](./TODO.md) and [PLAN.md](./PLAN.md). Tick each
before calling D1 done. Invent nothing.

## Prerequisites

- [ ] P5 provisioning/secrets seams merged.
- [ ] P6a `AgentDefinitionDeclaration` merged.
- [ ] M2 exposure config merged; demo endpoint config is required for D1 closeout.
- [ ] Chosen EU host profile is supported by architecture 10 or owner-approved.

## Beads

- [ ] BBD1-001 - Provisioning plan schema + CLI/API entry.
- [ ] BBD1-002 - Tenant/workspace + DB/storage/session roots.
- [ ] BBD1-003 - Secrets and runtime config materialization.
- [ ] BBD1-004 - Demo endpoint config + deployment manifest.
- [ ] BBD1-005 - Apply smoke + rollback notes.

## Verification commands

- [ ] Affected package build/typecheck/test commands.
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm audit:imports`
- [ ] Provisioning smoke added by this package.

## PR-PLAN reconciliation

- [ ] `pr1-plan-command-api` completed BBD1-001.
- [ ] `pr2-tenant-roots` completed BBD1-002.
- [ ] `pr3-secrets-runtime-config` completed BBD1-003.
- [ ] `pr4-demo-manifest` completed BBD1-004.
- [ ] `pr5-apply-smoke-runbook` completed BBD1-005.

## Review gates

- [ ] One command/API creates every required provisioning artifact.
- [ ] Dry-run and idempotent rerun are tested.
- [ ] No raw secrets in generated outputs, logs, or docs.
- [ ] Session roots are durable host-volume roots, not container home/root.
- [ ] Deployment manifest follows architecture 10 EU host constraints.

## Exit criteria

- [ ] A tenant/workspace can be provisioned from one invocation.
- [ ] Runtime config, roots, secrets refs, demo endpoint config, and deployment manifest exist.
- [ ] Smoke proof confirms the provisioned shape is usable.

## Closeout

- [ ] Zero unowned `TODO(remove:*)` markers for this package.
- [ ] PRs merged per [PR-PLAN.md](../../PR-PLAN.md).
