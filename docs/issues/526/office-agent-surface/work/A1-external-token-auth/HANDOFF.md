# A1 — Handoff

Pick this package up only for boring-ui token auth work.

## Fresh-Agent Start

- Branch: `bclaw/526-a1-token-auth`.
- Read first:
  - `docs/issues/526/office-agent-surface/VISION.md`
  - `docs/issues/526/office-agent-surface/INDEX.md`
  - `docs/issues/526/office-agent-surface/work/A1-external-token-auth/PLAN.md`
  - `packages/core/src/server/auth/authHook.ts`
  - `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts`
  - `packages/agent/src/server/registerAgentRoutes.ts`

## Bead Order

Execute beads in TODO.md order. INDEX.md is the only package-ordering authority.

## Done Definition

- Browser Better Auth still works.
- Workspace bearer tokens work for approved file/agent routes.
- Bearer tokens do not grant admin, member, invite, settings, or token CRUD access.
- Raw tokens are never stored, listed, logged, snapshotted, or written into refs.
- Verification commands in `TODO.md` pass.

## Review Notes

Keep the auth change small. The purpose is to unblock external surfaces, not to add a broad admin API-token system.
