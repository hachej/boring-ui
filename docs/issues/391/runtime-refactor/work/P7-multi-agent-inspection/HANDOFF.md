# P7-multi-agent-inspection — Handoff checklist

Derived strictly from [TODO.md](./TODO.md) and [PLAN.md](./PLAN.md). Tick each before calling this package done. Invent nothing.

## Prerequisites (packages + gates)
- [ ] P6-plugin-child-app (P6a `AgentRegistry`) merged — [../P6-plugin-child-app/HANDOFF.md](../P6-plugin-child-app/HANDOFF.md)
- [ ] E1-environment-attachments merged — [../E1-environment-attachments/HANDOFF.md](../E1-environment-attachments/HANDOFF.md)
- [ ] T2-transport merged — [../T2-transport/HANDOFF.md](../T2-transport/HANDOFF.md)
- [ ] STOP+report if the Phase 6a `AgentRegistry` and the workspace `agents: [...]` declaration have not landed — do NOT invent a competing registry here

## Beads
- [ ] BBP7-001 — Thread `agentId` through `RuntimeScope`, the scope key, and `sessionNamespace`
- [ ] BBP7-002 — `agentId` request addressing against the Phase 6 `AgentRegistry`
- [ ] BBP7-003 — Per-agent tool catalog + per-agent readiness
- [ ] BBP7-004 — Derived `state.db` session index/search scoped by workspace + agent (#379)
- [ ] BBP7-005 — Agent list + inspection endpoints (the steering mechanism)
- [ ] BBP7-006 — External harness hook target resolution (#380)
- [ ] BBP7-007 — Surface adapters bind one `agentId` per addressing entry
- [ ] BBP7-008 — Subagent environment grant (first real consumer; lands E1 BBE1-005)
- [ ] BBP7-009 — Two surfaces × two agents no-collision integration test (Phase 7 exit)

## Verification commands
- [ ] `pnpm --filter @hachej/boring-agent run test`
- [ ] `pnpm --filter @hachej/boring-agent run typecheck`
- [ ] `pnpm --filter @hachej/boring-agent run lint:invariants`
- [ ] `pnpm --filter @hachej/boring-agent run check:isolation`
- [ ] `pnpm --filter @hachej/boring-bash run test`
- [ ] `pnpm --filter @hachej/boring-bash run typecheck`
- [ ] `pnpm --filter @hachej/boring-bash run check:invariants`
- [ ] `pnpm --filter @hachej/boring-workspace run typecheck`
- [ ] `pnpm --filter @hachej/boring-workspace run test`
- [ ] `pnpm lint:invariants`
- [ ] `pnpm audit:imports`
- [ ] `pnpm typecheck`

## Review gates
- [ ] Phase 6 `AgentRegistry` present and scoped against (not a competing registry), else STOP+report.
- [ ] `agentId` in the `RuntimeScope.key` array for all agents; `sessionNamespace` carries `agentId` only for non-default agents, and default-agent sessions load unchanged (on-disk JSONL compat).
- [ ] Per-agent tool catalog + readiness with zero cross-agent bleed (`05` Tests reproduced).
- [ ] Session search scoped by `workspace+agent`, served from a rebuildable derived `state.db` table, no fs requirement, redaction enforced.
- [ ] External hook routes onto the single T1 approval channel; boring-bash-free; authenticates/validates/redacts/audits.
- [ ] `/api/v1/agents` and `/api/v1/agents/:agentId/info` are public, private-hook-free, and leak no secret/key material (assert in test).
- [ ] One addressing entry ↔ one `agentId`; T2 platform-addressing guard stays green (`agentId`/`sessionId`/`SessionCtx` only in core signatures).
- [ ] Subagent grant is minimal, explicit-attachment-only, `execPolicy:'none'`, isolated by `agentId`.
- [ ] Two-surfaces × two-agents no-collision test present and green.
- [ ] Any transitional code carries `TODO(remove:<bead-id>)` naming its deletion-owner bead; a later owner is allowed only when explicitly named per [INDEX.md](../../INDEX.md), and no marker outlives its named owner's phase.

## Exit criteria
- [ ] Agent addressing resolves an `agentId` per request via the canonical `/api/v1/agents/:agentId/...` path prefix against the Phase 6 `AgentRegistry`; unknown/undeclared `agentId` fails closed.
- [ ] `agentId` is in the binding scope `key` for all agents; `sessionNamespace` carries it only for non-default agents; `sessionId` remains runtime-owned/globally unique and event-store/replay stays keyed by `sessionId` only; the two-agent collision test proves namespace/scope isolation (bindings, tool catalog, transcripts, readiness, approvals), not per-agent store keys.
- [ ] Per-agent tool catalog and per-agent readiness (reviewer readonly/no-exec; coding agent has bash; pure concierge has no boring-bash).
- [ ] Session index/search scoped by `workspaceId` + `agentId` (+ title/content/operational events, redacted), served from a rebuildable derived `state.db` table, no filesystem requirement.
- [ ] External harness hook target resolution: authenticate caller, validate `(workspace, agent, session)`, redact, route to the HITL channel, audit attribution, no boring-bash dep.
- [ ] `GET /api/v1/agents` returns a scrubbed declared-agent list, and `GET /api/v1/agents/:agentId/info` returns `{ agentId, model, tools, readiness, channels, environments }` — public contracts, no private core hooks.
- [ ] Surface adapters each bind exactly one `agentId` per addressing entry.
- [ ] First real subagent consumer: `SubagentEnvironmentGrant` / `deriveSubagentAttachment` lands, jailed by `agentId` scope + `scope.subpath`, minimal.
- [ ] Two surfaces × two agents in one workspace do not collide by namespace/scope/metadata (the Phase 7 exit test); no implementation relies on duplicate `sessionId` strings across agents.

## Closeout
- [ ] Zero unowned `TODO(remove:*)` markers for this phase
- [ ] PRs merged per [PR-PLAN.md](../../PR-PLAN.md) (this package's section)
