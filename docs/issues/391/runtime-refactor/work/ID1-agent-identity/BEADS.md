> **#391 status (2026-07-17): historical reference / non-dispatchable.**
>
> Active authority: `docs/issues/391/plan.md` and Decision 25 in
> `docs/DECISIONS.md`. Where this file conflicts, the active authority wins.

# ID1-agent-identity — implementation beads

Status: **bead enumeration from settled evidence — not started**. Derived from
[PLAN.md](./PLAN.md) (owner decision 2026-07-11), the
[SPIKE-EVIDENCE-2026-07-11.md](../../SPIKE-EVIDENCE-2026-07-11.md) §3/§5
identity-server selection (Ory Hydra selected), and the
[IMPLEMENTATION-GUARDRAILS.md](../../IMPLEMENTATION-GUARDRAILS.md) ID1 section.

> Phase: Phase ID1 — agent-driven identity (signup/signin via MCP)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md)
> Binding decisions: [DECISIONS.md](../../../../DECISIONS.md) #21, #22

## Settled selection (do not re-litigate)

Ory Hydra + a boring-owned adapter layer is selected (SPIKE-EVIDENCE §5). Hydra
proved auth-code + PKCE live (§3: 41.8 MB image, ~21 MiB idle RSS, trivially
hostable in the D1 compose). Keycloak merged initial experimental RFC 8707
support on 2026-03-17 (#46763); #41526 is closed and follow-up #47117 remains
open. Hydra remains selected on the verified PKCE spike and footprint (Ory's
documented 5–15 MB Go binary range versus a 750 MB+ JVM footprint). Boring
implements the RFC 9728 endpoint, resource-vs-audience validation, and CIMD
**regardless of server** — those are boring beads, not server config.
Re-evaluate only if Keycloak's RFC 8707 support becomes stable **and** CIMD
becomes required.

## Global do-NOT-build (Guardrails ID1)

- **No hand-rolled token/JWT code.** Validate via standard OIDC middleware and
  Hydra introspection. Writing JWT validation by hand is a stop sign.
- **No `permissions` table / no roles beyond `admin|user` + membership.** The
  existing membership model is the only authorization system (PLAN: MCP
  consumers are REGULAR USERS; no special class).
- **No user-admin UI beyond the minimum** login/consent screens.
- **No SSO federation.**
- Reuse the D1 compose conventions (one compose file, Postgres, env/file
  secrets) — do not stand up a second infra pattern.

## Bead sequence

### ID1-001 — Hydra compose service + migrate init + Postgres

- **Depends on:** D1-003 (`deploy/d1/compose.yml` exists).
- **Scope:** Add Ory Hydra as one service in the D1 compose (per D1-R0 /
  Decision 23 conventions), backed by **Postgres, not sqlite** (D1 uses an
  external already-provisioned database; Hydra gets a Postgres backing per its
  prod requirement, SPIKE §3). Add the required one-shot `hydra migrate sql`
  **init job** that runs before Hydra boots. Pin the Hydra image digest; keep
  admin API on the internal-only network (never ingress-exposed).
- **Acceptance:** Hydra boots in the D1 compose against Postgres; the migrate
  job is one-shot and idempotent on re-apply; admin API is unreachable from
  outside the internal network; footprint matches the spike (~42 MB image).
- **Do NOT:** use sqlite; expose the admin API through ingress; add a
  dedicated Hydra Postgres compose service. **Ruling (Fable, 2026-07-12,
  owner-overridable):** Hydra's schema lives in the same EXTERNAL database D1
  already requires — no compose DB service. A separate external instance is
  used only if schema isolation is demanded. This conflicted with D1-003's
  acceptance ("no database service is created") and D1-R0 §2/§10; the
  dedicated-Hydra-Postgres-service default above is superseded by this
  ruling. D1-003's no-compose-DB acceptance is unaffected.

### ID1-002 — login/consent UI (minimal, reuse app auth)

- **Scope:** Implement the login + consent endpoints Hydra delegates to
  (SPIKE §3: prod needs a real login/consent UI). Reuse the existing app auth
  (session/credential) rather than a parallel login stack; the UI is the
  minimum two screens (authenticate, grant consent).
- **Acceptance:** A browser completes Hydra's login+consent handoff using the
  existing app account; consent accept/deny works; no new user store is
  introduced (accounts remain the app's).
- **Do NOT:** build a user-admin UI, account settings, or theming beyond the two
  required screens; introduce a second identity store.

### ID1-003 — auto-provision hook (idempotent by subject claim)

- **Scope:** On first successful token exchange, create an account + a personal
  workspace, keyed idempotently by the subject claim (PLAN: auto-provision;
  Guardrails: idempotent subject-claim hook). Enter the same workspace
  authorization path as any regular signup (no invite gate, no special class).
- **Acceptance:** First connect creates account + personal workspace; **second
  connect is a no-op** (same subject → same account/workspace, no duplicate);
  the provisioned account is an ordinary member with no elevated role.
- **Do NOT:** create a parallel identity system; add an activation/approval gate;
  branch behavior for "MCP-originated" accounts.

### ID1-004 — RFC 9728 protected-resource-metadata endpoint (boring-owned)

- **Scope:** Serve the RFC 9728 protected-resource-metadata document from the
  **MCP resource server** (boring-owned), not from Hydra (SPIKE §4/§5: 9728 is
  absent from Hydra by design — the resource server serves it). Advertise the
  authorization server, supported scopes, and resource identifier.
- **Acceptance:** A stock MCP client discovers the auth server via the boring MCP
  endpoint's 9728 metadata; the document points at the Hydra issuer and the
  correct resource identifier.
- **Do NOT:** expect Hydra to serve 9728; hardcode client-specific metadata.

### ID1-005 — resource-vs-audience validation adapter

- **Scope:** Validate the RFC 8707 resource indicator against the token
  `audience` on every MCP request, rejecting cross-resource token reuse
  (SPIKE §5: Hydra exposes 8707 as `aud` binding, partial). A token minted for
  resource X must not be accepted at resource Y.
- **Acceptance:** A token whose audience does not match this resource is rejected
  with a stable code; a matching-audience token is accepted; the check runs on
  every authenticated MCP call, not just at issuance.
- **Do NOT:** hand-roll JWT parsing (use introspection/standard middleware);
  trust `resource=` conformance without the audience check.

### ID1-006 — DCR enablement + verification

- **Scope:** Enable Dynamic Client Registration (RFC 7591) as the CIMD fallback
  for clients that require it (e.g. Cursor). **Default-state discrepancy
  recorded (verify at build):** research says DCR default-on; the live spike
  found the endpoint disabled (SPIKE §3/§5). Explicitly verify Hydra's DCR
  default state and set it deliberately.
- **Acceptance:** DCR endpoint is reachable and registers a client; the default
  state is verified against the spike discrepancy and documented; registration
  is scoped/bounded (not an open relay).
- **Do NOT:** assume the default; leave DCR unbounded/open without a recorded
  decision.

### ID1-007 — API-key issuance from the same identity store

- **Scope:** Issue API keys from the same identity layer that backs OAuth (PLAN:
  one identity layer backs API keys and the future CLI). Keys map to the same
  regular principal + workspace membership; no separate key ACL.
- **Acceptance:** An API key issued for an account authorizes the same workspace
  access as its OAuth token; revoking the key does not affect the OAuth session
  and vice-versa; keys carry no elevated role.
- **Do NOT:** build a second credential store or a key-specific permission model.

### ID1-008 — per-workspace budget caps (BLOCKING tripwire before public exposure)

- **Scope:** Decorate boring-governance's existing `createMeteringSink` with a
  per-workspace hard spend cap + stable refusal code (Guardrails tripwire; PLAN
  recorded risk: open signup + operator-funded keys + no budget = unbounded
  spend the day ID1 hits the public internet). This is **BLOCKING**: it must
  land BEFORE or WITH ID1's public exposure.
- **Acceptance:** A capped workspace refuses over-budget LLM calls with a stable
  code; the cap is per-workspace; the decoration reuses the existing metering
  seam (no new billing system).
- **Do NOT:** build a billing system, invoicing, or a credits ledger (that is
  BL1, deferred); build a feature-flag/entitlement framework. A hard cap +
  stable refusal code suffices.

### ID1-009 — CIMD fetch/validation (later; when stock clients require)

- **Scope:** Implement Client ID Metadata Documents fetch + validation as the
  primary client-registration path (PLAN: CIMD primary, DCR fallback), pulled in
  only when a stock client in use requires CIMD. Boring owns CIMD validation
  regardless of server (SPIKE §5).
- **Acceptance:** A CIMD client-id URL is fetched, validated, and used to
  authorize the OAuth flow; a malformed/untrusted CIMD document is rejected with
  a stable code.
- **Do NOT:** build CIMD before a stock client requires it; fetch arbitrary
  client-metadata URLs without validation/allowlisting (SSRF guard).

## Sequencing notes

- ID1-001..003 are the boot spine (server + login + provisioning). ID1-004..005
  are the boring-owned protocol conformance that Hydra does not supply.
- **ID1-008 is a blocking gate on public exposure** — no public/open self-service
  ships without it (PLAN recorded risk; Guardrails tripwire).
- ID1-006 (DCR) and ID1-009 (CIMD) are client-registration paths; ID1-009 is
  deferred until a stock client requires CIMD.
- Every account provisioned by these beads is a REGULAR USER on the existing
  membership/authorization path (PLAN owner ruling). No bead introduces a
  special external-consumer class.
