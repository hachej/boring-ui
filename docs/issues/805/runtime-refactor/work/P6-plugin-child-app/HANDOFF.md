> **Work-package status:** follow this package’s linked Bead/GitHub tracker. It is
> not part of Decision 25’s static P0→N1 critical path, but Decision 25 does not
> cancel it. AgentHost/D1-dependent passages must be recut before dispatch.

# P6-plugin-child-app — Aggregate handoff checklist

> **Superseded for v1 (updated 2026-07-11).** This aggregate checklist is post-v1.
> P6 v1 uses the corrected [P6-V1-HANDOFF.md](P6-V1-HANDOFF.md); do not gate it
> on E1, full P3, generic P5, or durable generation routing.

This file includes post-v1 plugin and child-app expansion. P8 uses the narrower
[`P6-V1-HANDOFF.md`](P6-V1-HANDOFF.md), not this aggregate closeout.

Derived from the binding 2026-07-09 v1 slice in [TODO.md](TODO.md) and
[PLAN.md](PLAN.md). P3 snapshot consumption is the narrow v1 plugin
integration; the plugin-policy/child-app sections are post-v1.

## Prerequisites (packages + gates)
- [ ] (Historical P6-D/P6-R rows only; not v1 authority) Use
      `P6-V1-HANDOFF.md` for the landed P6-D and next stateless P6-R contract.
- [ ] (P6b follow-up only) P6a beads landed (this package's P6a slice complete)
- [ ] (P6b follow-up only) Shared child-app platform code export landed (expected type name `ResolvedChildAppContext`, #376; `docs/issues/376/plan.md` is only the plan today) — **HARD BLOCKED / STOP-and-report until it exists; no local fallback shape**

## Owner questions / verdict
- OWNER-QUESTIONS: none.
- GO/NO-GO: GO for P6a after P5; NO-GO for P6b until #376 exports the shared resolved child-app context type. P6b remains outside the #391 epic/P8 gate.

## Beads
### Historical v1 rows — superseded by `P6-V1-HANDOFF.md`
- [ ] Do not dispatch or use these rows for closeout.

### Post-v1 plugin expansion
- [ ] BBP6-002 — Import-free manifest requirements + skill filters
- [ ] BBP6-004 — [P6a] Runtime plugin context (`RuntimePluginContext`) on the gateway
- [ ] BBP6-005 — [P6a] Hosted external plugin fail-closed in remote mode
- [ ] BBP6-007 — [P6a] Shared per-workspace plugin runtime compatibility (#254)
- [ ] BBP6-008 — [P6a] Multi-tenant full-app reload (#41)
- [ ] BBP6-010 — Per-agent plugin composition after P7 routing

### P6b (HARD BLOCKED on #376 `ResolvedChildAppContext`)
- [ ] BBP6-001 — [P6b · HARD BLOCKED] Consume resolved child-app/workspace-kind context
- [ ] BBP6-006 — [P6b · HARD BLOCKED] Macro child-app requirement scoping

## Verification commands
- [ ] `pnpm --filter @hachej/boring-workspace run typecheck`
- [ ] `pnpm --filter @hachej/boring-workspace run test`
- [ ] `pnpm --filter @hachej/boring-workspace run lint:plugin-invariants`
- [ ] `pnpm --filter @hachej/boring-agent run build`
- [ ] `pnpm --filter @hachej/boring-agent run typecheck`
- [ ] `pnpm --filter @hachej/boring-agent run test`
- [ ] `pnpm --filter @hachej/boring-agent run lint:invariants`
- [ ] `pnpm --filter @hachej/boring-core run test`
- [ ] `pnpm --filter @hachej/boring-ui-cli run test`
- [ ] `pnpm --filter full-app run typecheck`
- [ ] `pnpm --filter full-app run test`
- [ ] `pnpm lint:invariants`
- [ ] `pnpm audit:imports`
- [ ] `pnpm typecheck`

## PR-PLAN reconciliation
### V1 (use `P6-V1-HANDOFF.md` as closeout authority)
- [ ] `pr1-definition-deployment-schema` completed BBP6-009
- [ ] `pr2-definition-registry` completed BBP6-003
- [ ] `pr3-resolved-agent` completed BBP6-011

### Post-v1 plugin/runtime expansion
- [ ] `pr2b-remote-worker-image-support` completed BBP6-009b
- [ ] `pr4-manifest-requires-bash-skill-filters` completed BBP6-002
- [ ] `pr4-runtime-plugin-context` completed BBP6-004
- [ ] `pr5-hosted-fail-closed` completed BBP6-005
- [ ] `pr6-shared-workspace-runtime` completed BBP6-007
- [ ] `pr7-multitenant-reload` completed BBP6-008
- [ ] `pr8-per-agent-plugin-composition` completed BBP6-010

### P6b follow-up
- [ ] `pr9-childapp-context` completed BBP6-001 only after #376 exports the shared resolved context type
- [ ] `pr10-macro-scoping` completed BBP6-006 only after BBP6-001 is unblocked

## Aggregate review gates
- [ ] P6a/P6b split (blocking): P5 precondition confirmed for P6a (or STOP+report); the shared child-app platform code export (expected `ResolvedChildAppContext`, #376) is the HARD prerequisite for P6b — if absent, BBP6-001/006 STOP-and-report with no local fallback shape; P6a proceeds independently.
- [ ] Child-app grep-gate: bundle registry, resolved registry, manifest
      validator, BBP6-010 contracts, and runtime plugin context contain zero
      child-app fields/types.
- [ ] No competing child-app registry / manifest scanner / plugin route family introduced.
- [ ] `pnpm lint:invariants` + `pnpm audit:imports` + `lint:plugin-invariants` green; zero agent→bash value imports.
- [ ] Import-free manifest validation proven (side-effecting plugin fixture not executed).
- [ ] Skill filter proven where skills are loaded: filesystem/bash-required skills are absent from Pi resources, `/api/v1/agent/skills`, slash suggestions, and the generated skills-index prompt fragment when resolved environment facts do not satisfy them, then visible when those facts are present.
- [ ] Hosted plugin fail-closed covered; iframe sandbox/CSP constraints asserted.
- [ ] Secrets are status-only in every plugin/browser/model context (P5 brokering); no raw values in manifests/logs/transcripts/artifacts.
- [ ] `/api/v1/plugins/:pluginId/*` dispatch unchanged; the bundle registry
      stores only verified definition/digest/assets (no framework creep).
- [ ] Full-app reload resolves per workspace/agent/plugin runtime; trusted server routes diagnosed not hot-registered.
- [ ] EU-sovereign: no US-hosted default/hard dependency introduced (invariant 15).
- [ ] Zero `// TODO(remove:*)` markers left dangling; any transitional code has a deletion bead in this file.

## P6b follow-up review gates (not P6a closeout)
- [ ] Macro requirements do not leak into a generic workspace.
- [ ] Child-app policy narrows, never widens; unknown id → stable diagnostic.

## Exit criteria
### Post-v1 P6a closeout (not a P8 gate)
- [ ] Import-free manifest validation runs **before** any plugin code executes.
- [ ] Skills with `boring.requires`-style requirements are filtered by resolved environment facts at the loader boundary, and the prompt-visible skills index is generated from that filtered set.
- [ ] Hosted plugin fails closed in remote mode for unsupported front/server/tool/bash/service/secret requirements.
- [ ] A plugin requiring bash is skipped/diagnosed when bash is disabled.
- [ ] A plugin requiring secrets receives status only (P5 brokering; no raw values).
- [ ] Trusted service plugin lifecycle works (via P5 managed services).
- [ ] Runtime backend RPC still dispatches after bash extraction (`/api/v1/plugins/:pluginId/*` unchanged).
- [ ] Full-app reload route resolves per workspace/agent/plugin runtime.
- [ ] EU-sovereign (invariant 15): no bead introduces a US-hosted service as a default or hard dependency.

### P6b follow-up (blocked outside epic exit)
- [ ] Child-app-scoped default plugins/prompts/provisioning apply only in the matching workspace kind.
- [ ] Macro requirements do not leak into a generic workspace.
- [ ] Child-app policy narrows but never widens workspace max policy (invariant 8); unknown `childAppId`/`workspaceKind` → stable diagnostic, never a silent fallback to Macro.

## Closeout
- [ ] Zero unowned `TODO(remove:*)` markers for this phase
- [ ] P6b follow-up issue for BBP6-001/BBP6-006 is filed/referenced; P6a/P8 do not wait on P6b landing
- [ ] PRs merged per [PR-PLAN.md](../../../../391/runtime-refactor/PR-PLAN.md) (this package's section)
