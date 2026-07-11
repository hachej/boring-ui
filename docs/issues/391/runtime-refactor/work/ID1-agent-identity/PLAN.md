# ID1-agent-identity — Plan

Status: spec settled — not started. Owner decision 2026-07-11,
research-backed. Gates [AR1](../AR1-shareable-artifacts/PLAN.md) and owner
priority 2 (external agent consumption) generally; pulls part of S4
(onboarding) forward.

> Phase: Phase ID1 — agent-driven identity (signup/signin via MCP)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md)

## Goal

Let an external consumer agent sign up and sign in via MCP without human
email hops, landing with an account and a personal workspace on the
deployment.

## Settled decisions (owner, 2026-07-11)

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

## Dependencies

- M1 (MCP surface) — the ingress the identity flow authenticates.
- Existing membership/auth model — auto-provisioned accounts enter the same
  workspace authorization path; no parallel identity system.

## Exit (to be specified in beads)

A stock MCP client completes OAuth 2.1 + PKCE against the EU-hosted
authorization server, receives a token scoped to the deployment, and lands
in an auto-provisioned personal workspace; the same identity issues API keys.
