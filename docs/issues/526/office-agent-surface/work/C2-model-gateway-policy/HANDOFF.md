# C2 — Handoff

Pick this package up only for wrapper model-gateway/policy work. Depends on C1 (login gate + wrapper shell) and the gateway server bead in boring-ui.

## Fresh-Agent Start

- Branches: `boring/526-c2-model-policy` (wrapper fork), `bclaw/526-c2-model-gateway` (boring-ui server bead).
- Read first:
  - `docs/issues/526/office-agent-surface/VISION.md` (Wrapper Boundary section)
  - `docs/issues/526/office-agent-surface/INDEX.md`
  - `docs/issues/526/office-agent-surface/work/C2-model-gateway-policy/PLAN.md` (including the OPEN GATEWAY DECISION)
  - wrapper fork: `src/taskpane/init.ts`, `src/compat/model-selector-patch.ts`, `src/taskpane/default-model.ts`, `src/auth/custom-gateways.ts`, `src/ui/provider-allowlist.ts`

## Bead Order

Execute beads in TODO.md order. INDEX.md is the only package-ordering authority. C2-006 (the OPEN GATEWAY DECISION + server bead) must be resolved before C2-002 ships its token path.

## Done Definition

- [ ] C2-001 — `src/wrapper/model-policy.ts` exists, fail-closed, single policy source.
- [ ] C2-002 — Boring gateway seeded after login; no key prompt in gateway-only mode; cleared on logout.
- [ ] C2-003 — selector, `/model`, status-bar picker, and default fallback enforce the policy.
- [ ] C2-004 — restored sessions coerced with a visible signal; `getApiKey()` fails closed for disallowed providers.
- [ ] C2-005 — provider settings/welcome overlay/custom-gateway affordances curated per policy; BYO explicit + tested.
- [ ] C2-006 — OPEN GATEWAY DECISION recorded; boring-ui gateway bead landed and consumed.
- [ ] `npm run test:models` passes; policy tests cover selector/default/session-restore paths.
- [ ] Upstream merged at PR start; drift for `src/compat/model-selector-patch.ts` recorded in PR descriptions.

## Review Notes

The existing `VITE_PI_ALLOWED_PROVIDERS` UI allowlist is fail-open by design — the wrapper policy must not inherit that posture. Every selection path goes through the one policy module; a path that "just filters the list" without the module is a regression.
