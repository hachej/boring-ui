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

- **Build:** a pure, deterministic function per BBP6-011 (PR-PLAN.md is the
  binding contract): input = bundle + deployment + authorized binding; output
  = composed runtime configuration with NO runtime handles. One call resolves
  ONE binding; D1 gets N agents by N independent calls. Digest verification;
  refusal on mismatch.
- **Do NOT build:** a resolver service, a registry daemon, hot-reload
  watchers, bundle caches, remote fetch. Bundles are local files in v1.
- **Stop signs:** adding a network listener; adding a watch loop; "registry"
  appearing in a type name.
- **Accept:** one call resolves one authorized binding; unknown/invalid/
  mismatched digest fails with a stable code before any workspace mutation;
  same input → deep-equal output (golden test). The 3-bundle/boot proof
  belongs to D1, not here.

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
- **Gate:** D1 is non-dispatchable until D1-R0 (atomic active-collection
  publication, immutable rollback-as-new-revision) is accepted in PR-PLAN.md.
- **Accept:** 3 distinct agents on 1 EU host, each bound to its workspace;
  golden-path timing recorded; rollback = reapply a prior COMPLETE immutable
  revision snapshot (never just an old compose file over new volumes/secrets),
  published only after all bindings report ready; **applying revision N+1
  must not interrupt in-flight sessions of agents 1..N** — via D1-R0's atomic
  immutable-revision apply with graceful cutover. The mechanism (in-process
  rebind vs process granularity) is D1-R0's decision, NOT this file's; do not
  assume one-container-per-agent. (This IS phase-2 exit.)

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
  task against a hosted agent, receiving COMPLETE authorized artifact bytes
  (no host paths, no truncation) within the documented size caps, with stable
  rejection codes for path-shaped and oversize outputs (per PR-PLAN's M1
  contract).

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

- **Spec gate:** AR1 stays spec-blocked until AR1-001 is accepted
  (PR-PLAN.md). The beads below are the SAME-WORKSPACE lane sketch as input
  to that spec — not a dispatch contract. The cross-workspace pinned-copy
  exit in INDEX.md remains the authoritative AR1 exit criterion.
- **Same-workspace lane beads (post-AR1-001):** (1) share-entry store
  `{id, workspaceId, path, provenance}`; (2) deep-link route `/a/<id>` with
  membership auth + tombstone rendering; (3) MCP resource exposing the same
  entry; (4) nothing else in this lane.
- **Do NOT build:** the cross-workspace `ArtifactTransferHandle` blob lane
  until the first contracted-mode engagement exists (#640 spec is ready when
  needed); expiry/revocation machinery (membership IS revocation); preview
  renderers per file type.
- **Accept (same-workspace lane):** agent returns a link; owner opens it
  logged-in and lands focused on the file; deleted file shows provenance
  tombstone, never a bare 404; non-member gets a clean denial.
- **Accept (workpackage exit):** AR1 as a whole is done only when INDEX.md's
  authoritative cross-workspace exit also holds — a consumer materializes a
  pinned immutable copy in its authorized destination workspace per the
  AR1-001 spec. The deferral above delays that lane's build, not the exit.

## AC1 — agent consumption contract (issue #636)

- **Build:** the types (Task/Message/Part, `contextId`, `input-required`,
  versioned schema — sketch in FABLE-FINAL-REVIEW Part 2) in the contracts
  layer; an in-process dispatcher for SUBAGENT mode reusing pi session
  machinery for the loop and T1's event store if durability is needed.
  Guards REQUIRED, values NOT frozen here: consumption depth limit,
  same-pair cycle refusal, input-required timeout → canceled (resumable
  context). Concrete numbers (suggested: depth 3, 24h) are ratified in the
  AC1 consumer-backed spec, not in this file.
- **Do NOT build:** a task queue/broker, contracted mode before a real
  contracting consumer exists, A2A wire transport, persistence beyond
  existing stores.
- **Stop signs:** a `TaskScheduler`; a state machine library; retry policies.
- **Accept:** agent A delegates to subagent B in A's workspace; B asks back
  via input-required; A answers; task completes with artifacts; exceeding
  the ratified depth limit is refused with a stable code.

## P8 — verification (pull-forward slice)

- **Build now (cheap):** golden-path timing script (idea → deployed agent,
  wall-clock, recorded in repo); CI greps for `runtime:'none'` residue and
  the standing invariants.
- **Do NOT build:** a test platform, dashboards, synthetic monitoring.
- **Accept:** `scripts/golden-path-timing.mjs` (this exact path) writes
  `docs/issues/391/runtime-refactor/golden-path.json` {version, seconds, date};
  version source of truth = root `package.json` version at the release tag;
  a CI job fails when golden-path.json's version differs from it —
  staleness is machine-detected, not remembered.

## Ops beads (paper-first; the vault claim demands them)

- **Backup/restore:** nightly encrypted OFF-HOST snapshot of ONE defined
  consistent set: workspace volumes + `BORING_AGENT_SESSION_ROOT` +
  membership/app state (`agent.db`) + D1 revision store + config/secret refs
  (borgmatic-level — NOT a backup platform), plus a restore runbook executed
  for real on a recurring schedule. A workspace-volumes-only backup is a
  false sense of safety — sessions and membership are part of the vault.
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
- **Template workspaces:** provisioning may seed a new workspace from ONE
  sanitized, immutable template (digest + provenance + licensing note
  recorded — a frozen snapshot, never a live directory that can drift or
  leak customer material). Do NOT build a template registry.
- **Freemium gating = budget caps only** for features (no feature-flag
  system) — but PUBLIC exposure additionally requires authenticated
  abuse/rate admission controls (per-principal request limits at the door;
  caps alone do not stop abuse), and regulated-domain launches require a
  VERSIONED legal/risk sign-off document (kept outside DECISIONS.md — it is
  a compliance record, not an architecture decision).
- **Regulated-domain gate (BLOCKING):** before any insurance/accounting/legal
  vertical launches publicly: disclaimers in the agent definition,
  human-in-loop default for advice-shaped outputs, and an owner review of
  the regulatory exposure. Record the review in DECISIONS.md.

## Deferred WPs — do not start

BL1 / MK1 / CH1 / M2 / E2 / T2 / X1 / P3 / P4 / P5b / D2 / S3 / S4: demand-
gated or post-v1. Starting any of these without a named consumer recorded in
INDEX.md is itself an over-engineering failure. P2 (#641) may finish
review and stay rebased in isolation, but per INDEX.md it merges LAST — after
the priority-1..3 proofs — and grows no scope during rebases.
