# P6-plugin-child-app — Handoff checklist

Derived strictly from [TODO.md](./TODO.md) and [PLAN.md](./PLAN.md). Tick each before calling this package done. Invent nothing.

## Prerequisites (packages + gates)
- [ ] (P6a) P5-provisioning-secrets merged — [../P5-provisioning-secrets/HANDOFF.md](../P5-provisioning-secrets/HANDOFF.md)
- [ ] (P6b) P6a beads landed (this package's P6a slice complete)
- [ ] (P6b) Shared child-app platform type `ResolvedChildAppContext` (#376, `docs/issues/376/plan.md`) landed — **HARD BLOCKED / STOP-and-report until it exists; no local fallback shape**

## Beads
### P6a (dispatchable after P5)
- [ ] BBP6-002 — [P6a] Extend plugin manifest validation import-free for `boring.requires` + `bash`
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

## Review gates
- [ ] P6a/P6b split (blocking): P5 precondition confirmed for P6a (or STOP+report); `ResolvedChildAppContext` (#376) HARD prerequisite for P6b — if absent, BBP6-001/006 STOP-and-report with no local fallback shape; P6a proceeds independently.
- [ ] P6a grep-gate (blocking): each named P6a contract contains ZERO child-app fields/types — `grep -rn "childAppId\|workspaceKind\|ChildApp"` on each created file (manifest validator, `AgentRegistry.ts`, `workspaceAgentsDeclaration.ts`, `runtimePluginContext.ts`) returns no matches.
- [ ] No competing child-app registry / manifest scanner / plugin route family introduced.
- [ ] `pnpm lint:invariants` + `pnpm audit:imports` + `lint:plugin-invariants` green; zero agent→bash value imports.
- [ ] Import-free manifest validation proven (side-effecting plugin fixture not executed).
- [ ] Hosted plugin fail-closed covered; iframe sandbox/CSP constraints asserted.
- [ ] Macro requirements do not leak into a generic workspace; child-app policy narrows, never widens; unknown id → stable diagnostic.
- [ ] Secrets are status-only in every plugin/browser/model context (P5 brokering); no raw values in manifests/logs/transcripts/artifacts.
- [ ] `/api/v1/plugins/:pluginId/*` dispatch unchanged; `AgentRegistry` minimal and Map-backed (no framework creep).
- [ ] Full-app reload resolves per workspace/agent/plugin runtime; trusted server routes diagnosed not hot-registered.
- [ ] EU-sovereign: no US-hosted default/hard dependency introduced (invariant 15).
- [ ] Zero `// TODO(remove:*)` markers left dangling; any transitional code has a deletion bead in this file.

## Exit criteria
- [ ] Import-free manifest validation runs **before** any plugin code executes.
- [ ] Hosted plugin fails closed in remote mode for unsupported front/server/tool/bash/service/secret requirements.
- [ ] (P6b) Child-app-scoped default plugins/prompts/provisioning apply only in the matching workspace kind.
- [ ] (P6b) Macro requirements do not leak into a generic workspace.
- [ ] A plugin requiring bash is skipped/diagnosed when bash is disabled.
- [ ] A plugin requiring secrets receives status only (P5 brokering; no raw values).
- [ ] Trusted service plugin lifecycle works (via P5 managed services).
- [ ] Runtime backend RPC still dispatches after bash extraction (`/api/v1/plugins/:pluginId/*` unchanged).
- [ ] Full-app reload route resolves per workspace/agent/plugin runtime.
- [ ] (P6b) Child-app policy narrows but never widens workspace max policy (invariant 8); unknown `childAppId`/`workspaceKind` → stable diagnostic, never a silent fallback to Macro.
- [ ] EU-sovereign (invariant 15): no bead introduces a US-hosted service as a default or hard dependency.

## Closeout
- [ ] Zero unowned `TODO(remove:*)` markers for this phase
- [ ] PRs merged per [PR-PLAN.md](../../PR-PLAN.md) (this package's section)
