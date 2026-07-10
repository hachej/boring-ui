# C3 — Handoff

Pick this package up only for wrapper branding/persona + packaging/release work. Depends on C1 (wrapper shell + login gate).

## Fresh-Agent Start

- Branch: `boring/526-c3-branding-release` (wrapper fork).
- Read first:
  - `docs/issues/526/office-agent-surface/VISION.md` (Wrapper Boundary section)
  - `docs/issues/526/office-agent-surface/INDEX.md`
  - `docs/issues/526/office-agent-surface/work/C3-branding-packaging-release/PLAN.md`
  - wrapper fork: `src/prompt/system-prompt.ts`, `src/ui/disclosure-bar.ts`, `src/taskpane/status-bar.ts`, `manifest.prod.xml`, `HOSTED-BUILD-REPORT.md`

## Bead Order

Execute beads in TODO.md order. INDEX.md is the only package-ordering authority.

## Done Definition

- [ ] C3-001 — `src/wrapper/branding.ts` owns all product strings/tokens/persona config.
- [ ] C3-002 — taskpane/welcome/status/loading surfaces read from the branding seam.
- [ ] C3-003 — theme lands as one CSS-variable partial; UI gallery covers taskpane, login gate, disclosure/status bar, settings.
- [ ] C3-004 — disclosure bar matches Boring capabilities or is disabled; system-prompt IDENTITY is config-driven with a stable prefix.
- [ ] C3-005 — `manifest.boring.xml` generated from config, validates, and sideloads with Boring branding.
- [ ] C3-006 — production CSP has no demo tailnet/localhost entries; build smoke proves no demo token/workspace id/tailnet host in built assets.
- [ ] C3-007 — release proof executed and recorded: sideload, Boring login, workspace-scoped token, four tools, model switching only within policy, logout blocks the agent.
- [ ] `npm run build`, `npm run check`, `npm run test:models`, `npm run test:security`, and Boring connector tests pass.
- [ ] Upstream merged at PR start; drift for `src/prompt/system-prompt.ts` recorded in PR descriptions.

## Review Notes

Prefer config/data changes over source edits — every shared-file edit is upstream-merge debt. The system prompt must keep Excel safety/workflow instructions intact; only the identity/persona section is wrapper-owned.
