# AR1-shareable-artifacts — Plan

Status: gap identified 2026-07-11 as an owner-priority need (priority 2) — no
existing workpackage covers it. Spec before build; this stub reserves the
workpackage and its open questions only.

> Phase: Phase AR1 — shareable artifacts (after M1 recuts, before M2/E2)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md)

## Goal

An artifact produced in one workspace gets a shareable link. An external or
consumer agent — including one consuming via MCP (owner priority 2) — can open
the link and have the artifact land in ITS workspace.

## Dependencies

- M1 (MCP surface) — the consumer-agent ingress this feature serves.
- The workspace contract ([`docs/WORKSPACE_CONTRACT.md`](../../../../../WORKSPACE_CONTRACT.md))
  — artifact landing must respect workspace authorization and identity.

## Open questions (resolve in spec)

- Auth/scope of links: who can open a link, for how long, revocation.
- Artifact immutability/versioning: does a link pin a digest or track updates.
- Landing semantics: copy into the consumer workspace vs reference/projection.

## Exit (to be specified)

A written spec answering the open questions, reviewed against decision 21's
workspace-first acceptance, before any implementation bead is created.
