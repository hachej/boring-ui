# D1-tenant-provisioning - Plan

> Phase: Phase D1 - tenant provisioning command/API · Work order: [TODO.md](./TODO.md) · Handoff: [HANDOFF.md](./HANDOFF.md)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md) · PR plan: [PR-PLAN.md](../../PR-PLAN.md)

## Governing architecture

- [10-sandbox-deployment-eu.md](../../architecture/10-sandbox-deployment-eu.md) - EU host tiers, self-host default, runtime image and deployment constraints.
- [P5-provisioning-secrets](../P5-provisioning-secrets/TODO.md) - provisioning, readiness, managed services, and secrets brokering.
- [P6-plugin-child-app](../P6-plugin-child-app/TODO.md) - canonical agent definitions.
- [M2-mcp-agent-surface](../M2-mcp-agent-surface/TODO.md) - demo endpoint exposure config.

## Design context

D1 is the missing factory/platform bridge: a repeatable command/API that turns an
approved agent definition and tenant choice into a deployed EU-hosted tenant
workspace. Architecture 10 makes self-hosted EU infrastructure the viable
default. D1 captures the operational shape without adding LP/GTM/pricing content,
which belongs to `boring-ui-factory`.

## Deliverables

- One command/API that plans and applies tenant provisioning.
- Creates tenant/workspace records and resolved runtime config.
- Creates DB/storage/session roots with the host-side session-history rule.
- Creates/seals required secrets without logging raw values.
- Creates demo endpoint config from M2 exposure policy.
- Emits a deployment manifest for the chosen EU host/tier from architecture 10.
- Provides dry-run/plan output and idempotent apply behavior.

## Exit criteria

- A new tenant can be provisioned from one command/API invocation against a
  chosen EU host profile.
- The generated manifest is sufficient for deployment/review and contains no raw secrets.
- Demo endpoint config is produced but LP/CTA generation remains outside platform scope.
