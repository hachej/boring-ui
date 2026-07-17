> **Work-package status:** retained research and non-dispatchable until this
> child issue’s canonical plan and Bead graph are recut under Decision 26.
> Stale readiness, Decision 25 P0→N1, and AgentHost/D1 passages have no authority.

# ID1-agent-identity — Plan

Status: spec settled — not started. Owner decision 2026-07-11,
research-backed. Gates public self-service and AC1 contracted marketplace mode,
not the M1-authenticated AR1 tracer; pulls part of S4 (onboarding) forward.

> Phase: Phase ID1 — agent-driven identity (signup/signin via MCP)
> Ordering authority: [INDEX.md](../../../../391/runtime-refactor/INDEX.md) · Vision: [VISION.md](../../../../391/runtime-refactor/VISION.md)

## Goal

Let an external consumer agent sign up and sign in via MCP without human
email hops, landing with an account and a personal workspace on the
deployment.

## Settled decisions (owner, 2026-07-11)

- **Identity server:** Ory Hydra + a boring-owned adapter layer
  ([DECISIONS.md #24](../../../../../DECISIONS.md#24-identity-server-ory-hydra--boring-owned-adapter-layer),
  Accepted 2026-07-12 via #670).
- **Protocol:** MCP OAuth 2.1 + PKCE per the June-2025+ MCP authorization
  spec — Protected Resource Metadata (RFC 9728) and Resource Indicators
  (RFC 8707).
- **Client registration:** Client ID Metadata Documents (CIMD) primary;
  Dynamic Client Registration (RFC 7591) as fallback (Cursor).
- **Magic links explicitly rejected** — agents cannot complete email hops.
- **Auto-provision:** account + personal workspace created on first
  successful token exchange.
- **One identity layer:** the same layer backs API keys and the future CLI.
- **EU hosting:** the identity/auth server must be EU-sovereign
  (00 invariant 15).

## Owner rulings (2026-07-11)

- **Principle: MCP consumers are REGULAR USERS.** No special class anywhere
  in the design.
- **Signup:** open, same as any user signup — no invite gate or manual
  activation for MCP-originated accounts.
- **Isolation:** existing app-level workspace isolation applies unchanged;
  no new isolation tier for external consumers.
- **Cost/credits:** LLM token/spend budgeting is a regular per-workspace
  concern, deliberately deferred — NOT part of ID1 scope.
- **Recorded risk (known-unknown with trigger):** open signup +
  operator-funded keys + no workspace budget = unbounded spend exposure the
  day ID1 ships to the public internet. The deferred workspace-budget work
  must land BEFORE or WITH ID1's public exposure; revisit at ID1 build start.

## Dependencies

- M1 (MCP surface) — the ingress the identity flow authenticates.
- Existing membership/auth model — auto-provisioned accounts enter the same
  workspace authorization path; no parallel identity system.

## Exit (to be specified in beads)

A stock MCP client completes OAuth 2.1 + PKCE against the EU-hosted
authorization server, receives a token scoped to the deployment, and lands
in an auto-provisioned personal workspace; the same identity issues API keys.
