# D1-tenant-provisioning — Plan

Status: v1 dedicated-delivery gate.

## V1 dependency correction (2026-07-09)

D1 depends on A1, P5a, and P6-R. It consumes A1's self-contained
`CompiledAgentBundle` plus separate `AgentDeployment`. It uses the existing
HTTP/workspace endpoint surface; M2 is not a prerequisite. Every deployment
records definition, deployment, and resolved-snapshot digests and supports
rollback to the prior complete deployment snapshot.

**Owner amendment (2026-07-10):** v1 delivery includes one exact dedicated
hostname (for example `insurance-comparison.senecapp.ai`), a minimal
declarative landing page, and an authenticated handoff into the existing
workspace app. The hostname selects one dedicated app/tenant/workspace
deployment. Existing membership/invite authorization decides who may enter
that workspace; the landing page never grants membership. The workspace routes
v1 agent traffic to the deployed definition as its sole `default` agent. D1
does not become D2's many-tenant shared-host router.

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
default. D1 owns the generic dedicated-site delivery mechanism and a bounded
landing configuration; bespoke LP design, copy generation, GTM campaigns, and
pricing still belong to `boring-ui-factory`.

## Deliverables

- One command/API that plans and applies tenant provisioning.
- Creates tenant/workspace records and resolved runtime config.
- Creates DB/storage/session roots with the host-side session-history rule.
- Creates/seals required secrets without logging raw values.
- Creates an exact-host endpoint/deployment binding over the existing
  HTTP/workspace surface; MCP exposure remains optional M2 work.
- Serves a minimal deployment-configured landing page, sends its CTA through
  existing authentication, and routes the authenticated principal only to an
  authorized workspace for the dedicated app.
- Binds the provisioned workspace to the deployed definition as agent
  `default`; it does not create a second agent-selection mechanism.
- Enforces the one D1-managed workspace across every workspace-bearing server
  route and front selector. Dedicated mode disables create/switch/ordinary
  delete and rejects every non-bound hostname. Generic behavior remains only on
  its separately configured listener; a reserved D1 host without a complete
  pointer fails inactive, while a complete reserved host is served only by its
  dedicated composition and never falls through to generic routing.
- Publishes DNS/TLS and the active generation only after host readiness proves
  the fixed-workspace scope and landing/sign-in/default-agent surface are both
  installed for the current target/fence, staged desired state, exact site
  binding, and host-app/plugin snapshot. Readiness comes from an unexported
  in-process mint or P5a's authenticated nonce-bound worker response, never a
  caller record. First apply CAS selects the complete scoped generation before
  external exact-host activation; a reserved host without that pointer fails
  inactive before generic routing. Stale or replayed readiness cannot publish
  and partial D1 stacks remain unreachable.
- Runs one boot-time host/plugin generation per site in v1. No-op compares the
  complete desired-state digest and freshly reproduces the current P6-R digest;
  resolved fact drift transitions or fails closed. Desired-only changes with the
  same resolved digest still publish without process/session churn. A different
  resolved digest prepares a verified replacement, gates admission, bounded-
  drains, atomically commits pointer + `switch_pending`, switches ingress,
  retires prior sessions, and disables the old listener before reopening. Pre-
  CAS failure preserves the old generation; post-CAS recovery completes forward.
  This accepts bounded deployment downtime and avoids a multi-generation session
  router or boot-route hot reload.
- Uploads/materializes the immutable bundle, pinned host-app artifact, and
  activated-plugin snapshot; verifies their digests on the target; and records
  the rollback target. Mutable directory-only plugin sources are not production
  inputs.
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
  including host-app, activated-plugin snapshot, and static-host-prompt input
  identity, before side effects. Final P6-R resolution happens after
  materialization; its resolved/static-prompt/observed `completionDigest` is
  appended once before the complete pointer advances.
- Enforces a monotonic fence at every provider mutation. Pointer CAS alone is
  insufficient; an old generation resumed after takeover cannot create, update,
  or delete a target resource.

## Exit criteria

- A new tenant can be provisioned from one command/API invocation against a
  chosen EU host profile.
- The exact hostname serves the configured landing page. Its CTA completes
  member sign-in and enters an authorized workspace whose default agent is the
  deployed definition. Existing invite links remain the separate onboarding
  path. A member enters that workspace and a non-member is denied without
  leaking workspace or agent details.
- Direct API calls cannot list, create, switch to, delete, or route agent/file/
  session traffic through another workspace from the dedicated host.
- Account deletion and member ownership mutation cannot delete, transfer, or
  orphan the managed workspace outside the fenced D1 lifecycle.
- Missing, forged, stale, or replayed dedicated-site capability readiness
  produces no hostname publication and no active-pointer change.
- The generated manifest is sufficient for deployment/review and contains no raw secrets.
- The deployed host starts from materialized bundle content without access to
  the source checkout and reproduces the pinned host-app/plugin snapshot.
- Crash-at-every-step recovery and concurrent apply are deterministic; an
  incomplete generation never replaces the last complete pointer. Rollback
  creates a new generation from the immutable previous complete desired-state
  snapshot and verifies the same host-app/plugin snapshot and resolved digest.
- Restarting the unchanged active process preserves a completed session's exact
  generation. Changed apply/rollback terminalize replaced-generation sessions
  with readable history, disable the old listener before reopening, and require
  a new session on the active generation. Direct old-origin requests reject on
  immutable boot-digest mismatch before old routes.
- A paused old executor resumed after takeover is rejected before each provider
  side effect; unsupported providers cannot be used by D1.
- The generic landing/auth/workspace handoff ships. Arbitrary landing code,
  generated marketing copy, pricing, analytics funnels, and campaign tooling
  remain outside platform scope.
