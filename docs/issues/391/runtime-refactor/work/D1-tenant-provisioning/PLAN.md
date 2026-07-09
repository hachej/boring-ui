# D1-tenant-provisioning — Plan

Status: v1 dedicated-delivery gate.

## V1 dependency correction (2026-07-09)

D1 depends on A1, P5a, and P6-R. It consumes A1's self-contained
`CompiledAgentBundle` plus separate `AgentDeployment`. It uses the existing
HTTP/workspace endpoint surface; M2 is not a prerequisite. Every deployment
records definition, deployment, and resolved-snapshot digests and supports
rollback to the prior complete deployment snapshot.

> Phase: Phase D1 - tenant provisioning command/API · Work order: [TODO.md](./TODO.md) · Handoff: [HANDOFF.md](./HANDOFF.md)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md) · PR plan: [PR-PLAN.md](../../PR-PLAN.md)

## Governing architecture

- [10-sandbox-deployment-eu.md](../../architecture/10-sandbox-deployment-eu.md) - EU host tiers, self-host default, runtime image and deployment constraints.
- [P5-provisioning-secrets](../P5-provisioning-secrets/TODO.md) - provisioning, readiness, managed services, and secrets brokering.
- [P6-plugin-child-app](../P6-plugin-child-app/TODO.md) - canonical agent definitions.
- [A1-agent-authoring](../A1-agent-authoring/TODO.md) - compiled definition and local proof.

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
- Creates an endpoint/deployment binding over the existing HTTP/workspace surface; MCP exposure remains optional M2 work.
- Uploads/materializes the immutable bundle, verifies every asset and the
  definition digest on the target, and records the rollback target.
- Runs the timed v1 golden path with preconfigured infrastructure.
- Emits a deployment manifest for the chosen EU host/tier from architecture 10.
- Provides dry-run/plan output and idempotent apply behavior.
- Persists append-only fenced `DeploymentApplyGeneration`s plus one atomic
  `currentCompleteGeneration` pointer, so crashes and concurrent apply/reapply
  cannot overwrite history, duplicate resources, or select a partial snapshot.
- Uses one publication/fence chain per `(tenantId, agentId)`. Deployment id and
  resolved immutable host-identity digest are bound metadata, not alternate
  keys; a mutable profile name is insufficient. V1 rejects replacement/
  relocation, including same-id profile retargeting, instead of creating
  competing live pointers.
- Computes `desiredStateDigest` over the complete redacted desired snapshot,
  not only the deployment contract, before side effects. Final P6-R resolution
  happens after materialization; its resolved/observed `completionDigest` is
  appended once before the complete pointer advances.
- Enforces a monotonic fence at every provider mutation. Pointer CAS alone is
  insufficient; an old generation resumed after takeover cannot create, update,
  or delete a target resource.

## Exit criteria

- A new tenant can be provisioned from one command/API invocation against a
  chosen EU host profile.
- The generated manifest is sufficient for deployment/review and contains no raw secrets.
- The deployed host starts from materialized bundle content without access to
  the source checkout.
- Crash-at-every-step recovery and concurrent apply are deterministic; an
  incomplete generation never replaces the last complete pointer. Rollback
  creates a new generation from the immutable previous complete desired-state
  snapshot and verifies the resolved digest.
- A paused old executor resumed after takeover is rejected before each provider
  side effect; unsupported providers cannot be used by D1.
- Endpoint config is produced but LP/CTA generation remains outside platform scope.
