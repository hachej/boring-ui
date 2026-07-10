# C1 — Handoff

Pick this package up only for wrapper shell + login gate work in the #551 wrapper soft fork.

## Fresh-Agent Start

- Branch: `boring/526-c1-wrapper-login-gate` (wrapper fork).
- Read first:
  - `docs/issues/526/office-agent-surface/VISION.md` (Wrapper Boundary section)
  - `docs/issues/526/office-agent-surface/INDEX.md`
  - `docs/issues/526/office-agent-surface/work/C1-wrapper-shell-login-gate/PLAN.md`
  - `docs/issues/526/office-agent-surface/work/A1-external-token-auth/PLAN.md` (the login/token contract C1 consumes)
  - wrapper fork: `src/taskpane/init.ts`, `src/extensions/boring-demo-default.ts`, `src/connections/manager.ts`

## Bead Order

Execute beads in TODO.md order. INDEX.md is the only package-ordering authority.

## Done Definition

- [ ] C1-001 — wrapper soft fork exists; upstream remote tracked; merge cadence + `docs/upstream-divergences.md` documented.
- [ ] C1-002 — `src/wrapper/**` config shell in place; `builtin.boring` generalized; permissions minimal.
- [ ] C1-003 — login gate blocks runtime creation, model credential restore, and provider prompts until Boring login succeeds.
- [ ] C1-004 — login writes `{baseUrl, token, workspaceId}` into connection secrets; baked demo bearer token deleted from source and dist; 401/403 → re-auth gate.
- [ ] C1-005 — logout revokes/clears token material and blocks the agent until re-login.
- [ ] Tests cover startup with valid token, missing token, expired token, logout, and connector 401/403 recovery.
- [ ] Every C-lane PR merged upstream first and recorded drift for `src/taskpane/init.ts`, `src/compat/model-selector-patch.ts`, `src/prompt/system-prompt.ts`.
- [ ] Verification commands in `TODO.md` pass.

## Review Notes

Scope-fence: reuse A1 — do not redesign boring-ui external auth and do not invent a second bearer-token format. Keep pi-for-excel source edits as import/wiring seams only; product code stays in `src/wrapper/**`.
