# P6-plugin-child-app — Handoff checklist

Derived strictly from [TODO.md](./TODO.md) and [PLAN.md](./PLAN.md). Tick the P6a closeout before calling the epic package done. The P6b section is a blocked follow-up checklist outside the epic/P8 gate. Invent nothing.

## Prerequisites (packages + gates)
- [ ] (P6a) P5-provisioning-secrets merged — [../P5-provisioning-secrets/HANDOFF.md](../P5-provisioning-secrets/HANDOFF.md)
- [ ] (P6b follow-up only) P6a beads landed (this package's P6a slice complete)
- [ ] (P6b follow-up only) Shared child-app platform code export landed (expected type name `ResolvedChildAppContext`, #376; `docs/issues/376/plan.md` is only the plan today) — **HARD BLOCKED / STOP-and-report until it exists; no local fallback shape**

## Owner questions / verdict
- OWNER-QUESTIONS: none.
- GO/NO-GO: GO for P6a after P5; NO-GO for P6b until #376 exports the shared resolved child-app context type. P6b remains outside the #391 epic/P8 gate.

## Beads
### P6a (dispatchable after P5)
- [ ] BBP6-002 — [P6a] Extend plugin manifest validation import-free for `boring.requires` + `bash`; reserve skill capability filters
- [ ] BBP6-003 — [P6a] Introduce `AgentRegistry` (minimal, Map-backed)
- [ ] BBP6-004 — [P6a] Runtime plugin context (`RuntimePluginContext`) on the gateway
- [ ] BBP6-005 — [P6a] Hosted external plugin fail-closed in remote mode
- [ ] BBP6-007 — [P6a] Shared per-workspace plugin runtime compatibility (#254)
- [ ] BBP6-008 — [P6a] Multi-tenant full-app reload (#41)
- [ ] BBP6-009 — [P6a] Workspace `agents: [...]` declaration + default-agent composition (seeds `AgentRegistry`)

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
### P6a
- [ ] `pr1-agent-registry` completed BBP6-003
- [ ] `pr2-agents-declaration` completed BBP6-009
- [ ] `pr3-manifest-requires-bash-skill-filters` completed BBP6-002
- [ ] `pr4-runtime-plugin-context` completed BBP6-004
- [ ] `pr5-hosted-fail-closed` completed BBP6-005
- [ ] `pr6-shared-workspace-runtime` completed BBP6-007
- [ ] `pr7-multitenant-reload` completed BBP6-008

### P6b follow-up
- [ ] `pr8-childapp-context` completed BBP6-001 only after #376 exports the shared resolved context type
- [ ] `pr9-macro-scoping` completed BBP6-006 only after BBP6-001 is unblocked

## P6a review gates
- [ ] P6a/P6b split (blocking): P5 precondition confirmed for P6a (or STOP+report); the shared child-app platform code export (expected `ResolvedChildAppContext`, #376) is the HARD prerequisite for P6b — if absent, BBP6-001/006 STOP-and-report with no local fallback shape; P6a proceeds independently.
- [ ] P6a grep-gate (blocking): each named P6a contract contains ZERO child-app fields/types — `! rg -n "childAppId|workspaceKind|ChildApp"` on each created file (manifest validator, `AgentRegistry.ts`, `workspaceAgentsDeclaration.ts`, `runtimePluginContext.ts`) exits 0.
- [ ] No competing child-app registry / manifest scanner / plugin route family introduced.
- [ ] `pnpm lint:invariants` + `pnpm audit:imports` + `lint:plugin-invariants` green; zero agent→bash value imports.
- [ ] Import-free manifest validation proven (side-effecting plugin fixture not executed).
- [ ] Skill capability filter proven where skills are loaded: filesystem/bash-required skills are absent from Pi resources, `/api/v1/agent/skills`, slash suggestions, and the generated skills-index prompt fragment in pure mode, then visible when bash is attached.
- [ ] Hosted plugin fail-closed covered; iframe sandbox/CSP constraints asserted.
- [ ] Secrets are status-only in every plugin/browser/model context (P5 brokering); no raw values in manifests/logs/transcripts/artifacts.
- [ ] `/api/v1/plugins/:pluginId/*` dispatch unchanged; `AgentRegistry` minimal and Map-backed (no framework creep).
- [ ] Full-app reload resolves per workspace/agent/plugin runtime; trusted server routes diagnosed not hot-registered.
- [ ] EU-sovereign: no US-hosted default/hard dependency introduced (invariant 15).
- [ ] Zero `// TODO(remove:*)` markers left dangling; any transitional code has a deletion bead in this file.

## P6b follow-up review gates (not P6a closeout)
- [ ] Macro requirements do not leak into a generic workspace.
- [ ] Child-app policy narrows, never widens; unknown id → stable diagnostic.

## Exit criteria
### P6a closeout (epic/P8 gate)
- [ ] Import-free manifest validation runs **before** any plugin code executes.
- [ ] Skills with `boring.requires`-style capability requirements are filtered by attached capabilities at the loader boundary, and the prompt-visible skills index is generated from that filtered set.
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
- [ ] PRs merged per [PR-PLAN.md](../../PR-PLAN.md) (this package's section)
