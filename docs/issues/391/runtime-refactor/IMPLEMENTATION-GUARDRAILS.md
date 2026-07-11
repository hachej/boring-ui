# Implementation Guardrails — per-workpackage build contracts

Written 2026-07-11 (Fable final session). Audience: every downstream agent or
human implementing a #391 workpackage. Purpose: **reduce the risk of bad or
over-engineered implementations** now that the strategic context holder is
gone. Each section states what to build, what NOT to build, the stop signs
that mean you are over-engineering, and the acceptance that means you are done.

## Global doctrine (applies to every WP)

1. **Reuse-first checklist.** Before writing a new mechanism, check the
   existing seams: governance `createMeteringSink` (metering/budgets),
   governance `filesystemBindings` (path-filtered readonly projections),
   T1 `eventStreamStore` (durable events), the workspace membership model
   (all authorization), pi session machinery (conversation state). If a seam
   does 80% of the job, extend it — do not build a sibling.
2. **Boring by default.** One process, one compose file, YAML/JSON config,
   env/file secrets. No queues, no brokers, no reconciler loops, no caches,
   no microservices — until a measured problem demands one, recorded in
   DECISIONS.md first.
3. **No new package until a second consumer exists** (standing invariant).
4. **Every error carries a stable code; every route receives a Workspace,
   never a raw path** (standing invariants — CI greps enforce).
5. **Vertical slices, small PRs.** Prefer a working end-to-end sliver
   (≤ ~400 net lines) over a complete layer. A slice that boots beats a
   framework that might.
6. **The universal stop sign:** if you are writing a scheduler, a retry
   framework, a plugin system, a config DSL, an abstraction with one
   implementation, or a cross-cutting "manager" class — stop, re-read this
   file, and ship the dumb version.

---

## P6-R — deployment resolver

- **Build:** a pure, deterministic function: deployment record (digest-pinned
  `AgentDeployment`) → composed runtime configuration, consumed in-process at
  server boot and workspace binding. Digest verification; refusal on mismatch.
- **Do NOT build:** a resolver service, a registry daemon, hot-reload
  watchers, bundle caches, remote fetch. Bundles are local files in v1.
- **Stop signs:** adding a network listener; adding a watch loop; "registry"
  appearing in a type name.
- **Accept:** boot resolves 3 distinct bundles; unknown/invalid/mismatched
  digest fails with a stable code before any workspace mutation; same input →
  byte-identical resolution (golden test).

## D1 — multi-agent Docker host (Decision 23)

- **Build:** one compose file (core app + identity server later + N resolved
  bundles); hostname→landing map in plain config (hostname grants nothing);
  per-workspace env/secret files; a short ops runbook (boot, add-agent,
  rotate-secret, rollback).
- **Do NOT build:** Kubernetes, Terraform modules, autoscaling, multi-region,
  a secrets service, an admin UI, tenant lifecycle automation (that is D2,
  explicitly post-v1).
- **Stop signs:** helm charts; a "provisioner" process; templating engines
  beyond envsubst-level.
- **Accept:** 3 distinct agents on 1 EU host, each bound to its workspace;
  golden-path timing recorded; rollback = previous compose file boots green;
  **adding agent N+1 does not restart or interrupt agents 1..N** (per-service
  compose granularity — this criterion exists so onboarding a client never
  bounces existing clients). (This IS phase-2 exit.)

## P5a — provisioning/secrets (narrow)

- **Build:** only what the D1 slice consumes: secret refs resolved from
  env/file mounts; readiness = boot-time check with stable failure codes.
- **Do NOT build:** Vault/KMS integration, rotation machinery, a provisioning
  API. "Zero P5a code" is a valid outcome if D1's slice needs none (per
  PR-PLAN).

## M1 — MCP managed agent (recut #549/#556 content)

- **Build:** delivery v0 payload exactly as scoped; stock-client smoke test
  as the proof. Keep the MCP tool surface minimal — the delegate server's
  existing shape.
- **Do NOT build:** new MCP tools "while we're here", resources beyond the
  agreed payload, sampling/elicitation features.
- **Accept:** an unmodified stock MCP client (Claude/ChatGPT) completes one
  task against a hosted agent, artifacts included.

## ID1 — agent-driven identity

- **Build:** BUY-not-build: evaluate Ory Hydra vs Keycloak (0.5-day bead;
  criteria: OAuth 2.1 + PKCE, RFC 8707/9728, CIMD or DCR, container footprint
  on the D1 host, EU self-host). Integrate via standard OIDC middleware.
  Idempotent auto-provision hook (subject claim → account + personal
  workspace). API keys issued from the same store.
- **Do NOT build:** hand-rolled token/JWT code, a user-admin UI beyond
  minimum, roles/permissions beyond the existing admin|user + membership
  model, SSO federation.
- **Stop signs:** writing JWT validation by hand; a `permissions` table.
- **Tripwire (blocking):** per-workspace spend budgets ship BEFORE or WITH
  ID1's public exposure (decorate `createMeteringSink`; do not build a
  billing system for this — a hard cap + stable refusal code suffices).
- **Accept:** stock MCP client completes OAuth against a fresh email; account
  + workspace exist; second connect is a no-op; capped workspace refuses
  over-budget calls with a stable code.

## AR1 — shareable artifacts (v1 lane, post-#640 lane split)

- **Build (4 beads, in order):** (1) share-entry store
  `{id, workspaceId, path, provenance}`; (2) deep-link route `/a/<id>` with
  membership auth + tombstone rendering; (3) MCP resource exposing the same
  entry; (4) NOTHING ELSE.
- **Do NOT build:** the cross-workspace `ArtifactTransferHandle` blob lane
  until the first contracted-mode engagement exists (#640 spec is ready when
  needed); expiry/revocation machinery (membership IS revocation); preview
  renderers per file type.
- **Accept:** agent returns a link; owner opens it logged-in and lands
  focused on the file; deleted file shows provenance tombstone, never a bare
  404; non-member gets a clean denial.

## AC1 — agent consumption contract (issue #636)

- **Build:** the types (Task/Message/Part, `contextId`, `input-required`,
  versioned schema — sketch in FABLE-FINAL-REVIEW Part 2) in the contracts
  layer; an in-process dispatcher for SUBAGENT mode reusing pi session
  machinery for the loop and T1's event store if durability is needed.
  Guards: depth ≤ 3, same-pair cycle refusal, 24h input-required timeout →
  canceled (resumable context).
- **Do NOT build:** a task queue/broker, contracted mode before a real
  contracting consumer exists, A2A wire transport, persistence beyond
  existing stores.
- **Stop signs:** a `TaskScheduler`; a state machine library; retry policies.
- **Accept:** agent A delegates to subagent B in A's workspace; B asks back
  via input-required; A answers; task completes with artifacts; depth-4
  attempt refused with stable code.

## P8 — verification (pull-forward slice)

- **Build now (cheap):** golden-path timing script (idea → deployed agent,
  wall-clock, recorded in repo); CI greps for `runtime:'none'` residue and
  the standing invariants.
- **Do NOT build:** a test platform, dashboards, synthetic monitoring.
- **Accept:** golden-path number exists in-repo and updates per release.

## Ops beads (paper-first; the vault claim demands them)

- **Backup/restore:** nightly workspace-volume snapshot (borgmatic/rsync
  level — NOT a backup platform) + a restore runbook that has been executed
  once for real. "Your data is backed up and restorable" is B2B table stakes
  if the workspace vault is the moat.
- **Support playbook (doc only):** log locations, event-store query
  one-liners, per-agent restart, compose rollback. The 2am answer sheet.
  Do NOT build dashboards for this (P8 guardrail stands).
- **Upgrade discipline:** backward-compatible migrations rule for the core
  app while tenant workspaces are live + an upgrade/rollback runbook.

## Vertical-GTM beads (only if Motion 5 is activated)

- **Public agent landing page:** ONE static page per deployed agent rendered
  from AgentDefinition presentation metadata + a signup link. Do NOT build a
  CMS, theming, or a page builder. Stop sign: a `templates/` directory with
  more than one layout.
- **Template workspaces:** provisioning may seed a new workspace by copying
  one template directory. Do NOT build a template registry or versioning.
- **Freemium gating = budget caps only** (the ID1 tripwire machinery). A
  feature-flag system is the over-engineering trap here — refuse it.
- **Regulated-domain gate (BLOCKING):** before any insurance/accounting/legal
  vertical launches publicly: disclaimers in the agent definition,
  human-in-loop default for advice-shaped outputs, and an owner review of
  the regulatory exposure. Record the review in DECISIONS.md.

## Deferred WPs — do not start

BL1 / MK1 / CH1 / M2 / E2 / T2 / X1 / P3 / P4 / P5b / D2 / S3 / S4: demand-
gated or post-v1. Starting any of these without a named consumer recorded in
INDEX.md is itself an over-engineering failure. P2 (#641) finishes review
then merges after P1-era conflicts resolve — no scope growth during rebase.
